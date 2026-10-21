BEGIN;
CREATE TABLE IF NOT EXISTS contact(
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenant(id),data jsonb NOT NULL,
 email text GENERATED ALWAYS AS (NULLIF(lower(data->>'email'),'')) STORED,
 linkedin text GENERATED ALWAYS AS (NULLIF(data->>'linkedin','')) STORED,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,email),UNIQUE(tenant_id,linkedin),
 CHECK(jsonb_typeof(data)='object' AND length(btrim(data->>'name'))>0 AND length(btrim(data->>'company'))>0),
 CHECK(data->>'stage' IN ('待筛选','已入选','待联系','联系中','已回复','有意向','已约会议','已关闭')),
 CHECK(data->>'emailStatus' IN ('verified','unverified','catch_all','invalid','unavailable','unknown')),
 CHECK(jsonb_typeof(data->'doNotContact')='boolean')
);
CREATE TABLE IF NOT EXISTS contact_suppression(
 tenant_id text NOT NULL REFERENCES tenant(id),identity_kind text NOT NULL CHECK(identity_kind IN ('email','linkedin')),
 identity_value text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,identity_kind,identity_value)
);
CREATE TABLE IF NOT EXISTS lead_list(
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenant(id),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,name)
);
CREATE TABLE IF NOT EXISTS list_member(
 tenant_id text NOT NULL,list_id text NOT NULL,contact_id text NOT NULL,
 PRIMARY KEY(tenant_id,list_id,contact_id),
 FOREIGN KEY(tenant_id,list_id) REFERENCES lead_list(tenant_id,id),FOREIGN KEY(tenant_id,contact_id) REFERENCES contact(tenant_id,id)
);
CREATE OR REPLACE FUNCTION contact_can_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant t JOIN public.membership m ON m.tenant_id=t.id JOIN public.auth_user u ON u.id=m.user_id
 WHERE t.id=current_setting('app.tenant_id',true) AND t.status='active' AND m.user_id=current_setting('app.user_id',true)
 AND m.active AND NOT u.disabled AND (u."platformRole"<>'platform_admin' OR u."twoFactorEnabled"));
$$;
REVOKE ALL ON FUNCTION contact_can_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contact_can_access() TO ai_business;
CREATE OR REPLACE FUNCTION contact_assignees() RETURNS TABLE(id text,name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id,u.name FROM public.membership m JOIN public.auth_user u ON u.id=m.user_id
 WHERE public.contact_can_access() AND m.tenant_id=current_setting('app.tenant_id',true) AND m.active AND NOT u.disabled
 AND (u.id=current_setting('app.user_id',true) OR EXISTS(SELECT 1 FROM public.membership own WHERE own.tenant_id=m.tenant_id AND own.user_id=current_setting('app.user_id',true) AND own.role='owner' AND own.active));
$$;
REVOKE ALL ON FUNCTION contact_assignees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contact_assignees() TO ai_business;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['contact','contact_suppression','lead_list','list_member'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',name);
  EXECUTE format('GRANT SELECT ON %I TO ai_business',name);
  EXECUTE format('DROP POLICY IF EXISTS contacts_scope ON %I',name);
  EXECUTE format('CREATE POLICY contacts_scope ON %I TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND public.contact_can_access()) WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND public.contact_can_access())',name);
  IF name<>'contact_suppression' THEN EXECUTE format('GRANT INSERT,UPDATE ON %I TO ai_business',name); END IF;
 END LOOP;
END $$;
GRANT DELETE ON list_member TO ai_business;
CREATE OR REPLACE FUNCTION contact_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text:=current_setting('app.user_id',true); assigned text:=NEW.data->>'ownerId'; k text; v text;
BEGIN
 IF NOT public.contact_can_access() OR NEW.tenant_id<>current_setting('app.tenant_id',true) THEN RAISE EXCEPTION 'CONTACT_ACCESS_DENIED'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id THEN RAISE EXCEPTION 'IMMUTABLE_CONTACT_ID'; END IF;
  NEW.version:=OLD.version+1;NEW.created_at:=OLD.created_at;
  IF (OLD.data->>'doNotContact')::boolean THEN NEW.data:=jsonb_set(NEW.data,'{doNotContact}','true'); END IF;
 ELSE NEW.version:=1;NEW.created_at:=now(); END IF;
 IF assigned IS NOT NULL AND (TG_OP='INSERT' OR assigned IS DISTINCT FROM OLD.data->>'ownerId') THEN
  IF NOT EXISTS(SELECT 1 FROM public.membership m JOIN public.auth_user u ON u.id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND m.user_id=assigned AND m.active AND NOT u.disabled)
   OR (assigned<>actor AND NOT EXISTS(SELECT 1 FROM public.membership WHERE tenant_id=NEW.tenant_id AND user_id=actor AND role='owner' AND active)) THEN RAISE EXCEPTION 'CONTACT_OWNER_INVALID'; END IF;
 END IF;
 FOREACH k IN ARRAY ARRAY['email','linkedin'] LOOP
  v:=NULLIF(NEW.data->>k,'');IF k='email' THEN v:=lower(v); END IF;
  IF v IS NOT NULL AND EXISTS(SELECT 1 FROM public.contact_suppression WHERE tenant_id=NEW.tenant_id AND identity_kind=k AND identity_value=v) THEN NEW.data:=jsonb_set(NEW.data,'{doNotContact}','true'); END IF;
 END LOOP;
 IF (NEW.data->>'doNotContact')::boolean THEN
  FOREACH k IN ARRAY ARRAY['email','linkedin'] LOOP
   v:=NULLIF(NEW.data->>k,'');IF k='email' THEN v:=lower(v); END IF;
   IF v IS NOT NULL THEN INSERT INTO public.contact_suppression(tenant_id,identity_kind,identity_value) VALUES(NEW.tenant_id,k,v) ON CONFLICT DO NOTHING; END IF;
  END LOOP;
 END IF;
 NEW.updated_at:=now();
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata) VALUES(gen_random_uuid()::text,NEW.tenant_id,actor,'contact.saved',NEW.id,jsonb_build_object('version',NEW.version));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION contact_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS contact_guard ON contact;
CREATE TRIGGER contact_guard BEFORE INSERT OR UPDATE ON contact FOR EACH ROW EXECUTE FUNCTION contact_guard();
COMMIT;
