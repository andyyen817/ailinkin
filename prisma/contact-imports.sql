BEGIN;
CREATE TABLE IF NOT EXISTS contact_import(
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenant(id),actor_id text NOT NULL REFERENCES auth_user(id),
 request_key text NOT NULL,request_hash text NOT NULL,payload jsonb NOT NULL,
 mode text NOT NULL CHECK(mode IN ('skip','fill_empty')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','succeeded','partial','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,report jsonb,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 UNIQUE(tenant_id,request_key),CHECK(jsonb_typeof(payload)='array' AND jsonb_array_length(payload)<=10000)
);
ALTER TABLE contact_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_import FORCE ROW LEVEL SECURITY;
REVOKE ALL ON contact_import FROM PUBLIC;
GRANT SELECT ON contact_import TO ai_business;
DROP POLICY IF EXISTS contact_import_scope ON contact_import;
CREATE POLICY contact_import_scope ON contact_import FOR SELECT TO ai_business USING(tenant_id=current_setting('app.tenant_id',true) AND contact_can_access());
CREATE OR REPLACE FUNCTION queue_contact_import(p_key text,p_hash text,p_mode text,p_rows jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text:=current_setting('app.tenant_id',true);existing public.contact_import;jid text:=gen_random_uuid()::text;
BEGIN
 IF NOT public.contact_can_access() THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_key !~ '^[a-zA-Z0-9_-]{16,100}$' OR p_hash !~ '^[a-f0-9]{64}$' OR p_mode NOT IN ('skip','fill_empty') OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>10000 OR jsonb_array_length(p_rows)<1 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
 PERFORM 1 FROM public.tenant WHERE id=tid FOR UPDATE;
 SELECT * INTO existing FROM public.contact_import WHERE tenant_id=tid AND request_key=p_key;
 IF FOUND THEN IF existing.request_hash<>p_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN existing.id;END IF;
 IF (SELECT count(*) FROM public.contact_import WHERE tenant_id=tid AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'IMPORT_LIMIT'; END IF;
 INSERT INTO public.contact_import(id,tenant_id,actor_id,request_key,request_hash,payload,mode) VALUES(jid,tid,current_setting('app.user_id',true),p_key,p_hash,p_rows,p_mode);
 RETURN jid;
END $$;
CREATE OR REPLACE FUNCTION pending_contact_imports() RETURNS TABLE(id text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT id FROM public.contact_import WHERE state='pending' AND attempts<5 AND expires_at>now() ORDER BY created_at LIMIT 100;
$$;
CREATE OR REPLACE FUNCTION run_contact_import(p_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.contact_import; item jsonb; d jsonb; existing public.contact; matched integer; outcome text; result jsonb:='[]'; errors integer:=0;k text;
BEGIN
 SELECT * INTO job FROM public.contact_import WHERE id=p_id AND state='pending' AND attempts<5 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM set_config('app.tenant_id',job.tenant_id,true);PERFORM set_config('app.user_id',job.actor_id,true);
 IF NOT public.contact_can_access() OR job.expires_at<=now() THEN UPDATE public.contact_import SET state='cancelled' WHERE id=p_id;RETURN;END IF;
 UPDATE public.contact_import SET attempts=attempts+1 WHERE id=p_id;
 BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(job.tenant_id,0));
  FOR item IN SELECT value FROM jsonb_array_elements(job.payload) LOOP
   IF item ? 'error' THEN result:=result||jsonb_build_array(jsonb_build_object('row',item->'row','error',item->'error'));errors:=errors+1;CONTINUE;END IF;
   d:=item->'data';
   BEGIN
    SELECT count(*) INTO matched FROM public.contact WHERE tenant_id=job.tenant_id AND ((NULLIF(d->>'email','') IS NOT NULL AND email=lower(d->>'email')) OR (NULLIF(d->>'linkedin','') IS NOT NULL AND linkedin=d->>'linkedin'));
    IF matched>1 THEN RAISE EXCEPTION 'CONFLICTING_CONTACT_IDENTITIES'; END IF;
    IF matched=0 THEN
     INSERT INTO public.contact(id,tenant_id,data) VALUES(gen_random_uuid()::text,job.tenant_id,d);outcome:='created';
    ELSE
     SELECT * INTO existing FROM public.contact WHERE tenant_id=job.tenant_id AND ((NULLIF(d->>'email','') IS NOT NULL AND email=lower(d->>'email')) OR (NULLIF(d->>'linkedin','') IS NOT NULL AND linkedin=d->>'linkedin')) FOR UPDATE;
     IF job.mode='fill_empty' THEN
      FOREACH k IN ARRAY ARRAY['title','country','email','linkedin','notes'] LOOP
       IF COALESCE(existing.data->>k,'')='' THEN existing.data:=jsonb_set(existing.data,ARRAY[k],d->k); END IF;
      END LOOP;
     END IF;
     IF COALESCE((d->>'doNotContact')::boolean,false) THEN existing.data:=jsonb_set(existing.data,'{doNotContact}','true'); END IF;
     UPDATE public.contact SET data=existing.data WHERE id=existing.id;outcome:='duplicate_processed';
    END IF;
    result:=result||jsonb_build_array(jsonb_build_object('row',item->'row','outcome',outcome));
   EXCEPTION WHEN OTHERS THEN
    errors:=errors+1;result:=result||jsonb_build_array(jsonb_build_object('row',item->'row','error',CASE WHEN SQLERRM='CONFLICTING_CONTACT_IDENTITIES' THEN SQLERRM ELSE 'ROW_REJECTED' END));
   END;
  END LOOP;
  UPDATE public.contact_import SET state=CASE WHEN errors=jsonb_array_length(job.payload) THEN 'failed' WHEN errors>0 THEN 'partial' ELSE 'succeeded' END,report=result WHERE id=p_id;
  INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata) VALUES(gen_random_uuid()::text,job.tenant_id,job.actor_id,'contacts.imported',p_id,jsonb_build_object('rows',jsonb_array_length(job.payload),'errors',errors));
 EXCEPTION WHEN OTHERS THEN
  UPDATE public.contact_import SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,report='[{"error":"EXECUTION_FAILED"}]' WHERE id=p_id;
 END;
END $$;
REVOKE ALL ON FUNCTION queue_contact_import(text,text,text,jsonb),pending_contact_imports(),run_contact_import(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_contact_import(text,text,text,jsonb) TO ai_business;
GRANT EXECUTE ON FUNCTION pending_contact_imports(),run_contact_import(text) TO ai_worker;
COMMIT;
