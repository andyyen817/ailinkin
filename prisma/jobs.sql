BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='ai_worker') THEN CREATE ROLE ai_worker NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA public TO ai_worker;
CREATE TABLE IF NOT EXISTS public.tenant_job(
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES public.tenant(id), actor_id text NOT NULL REFERENCES public.auth_user(id),
 kind text NOT NULL CHECK(kind IN ('audit_export')), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','succeeded','failed','cancelled')),
 request_hash text NOT NULL, idempotency_key text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 lease_token text, lease_until timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.export_file(
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES public.tenant(id), job_id text NOT NULL UNIQUE REFERENCES public.tenant_job(id),
 object_key text NOT NULL UNIQUE, file_name text NOT NULL, mime text NOT NULL, size integer NOT NULL, sha256 text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_job FORCE ROW LEVEL SECURITY;
ALTER TABLE public.export_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_file FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_job,public.export_file FROM PUBLIC;
GRANT SELECT ON public.tenant_job,public.export_file TO ai_business;
DROP POLICY IF EXISTS scoped_job_read ON public.tenant_job;
CREATE POLICY scoped_job_read ON public.tenant_job FOR SELECT TO ai_business USING(tenant_id=current_setting('app.tenant_id',true) AND EXISTS(SELECT 1 FROM public.tenant t WHERE t.id=tenant_job.tenant_id));
DROP POLICY IF EXISTS scoped_export_read ON public.export_file;
CREATE POLICY scoped_export_read ON public.export_file FOR SELECT TO ai_business USING(tenant_id=current_setting('app.tenant_id',true) AND EXISTS(SELECT 1 FROM public.tenant t WHERE t.id=export_file.tenant_id));

CREATE OR REPLACE FUNCTION public.queue_export(p_key text,p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text; existing public.tenant_job; jid text:=gen_random_uuid()::text;
BEGIN
 tid:=public.require_tenant_owner();
 IF p_key !~ '^[a-zA-Z0-9_-]{16,100}$' OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_JOB'; END IF;
 PERFORM 1 FROM public.tenant WHERE id=tid FOR UPDATE;
 SELECT * INTO existing FROM public.tenant_job WHERE tenant_id=tid AND idempotency_key=p_key;
 IF FOUND THEN IF existing.request_hash<>p_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN existing.id; END IF;
 IF(SELECT count(*) FROM public.tenant_job WHERE tenant_id=tid AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'JOB_LIMIT'; END IF;
 INSERT INTO public.tenant_job(id,tenant_id,actor_id,kind,request_hash,idempotency_key)
 VALUES(jid,tid,current_setting('app.user_id',true),'audit_export',p_hash,p_key);
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
 VALUES(gen_random_uuid()::text,tid,current_setting('app.user_id',true),'export.requested',jid,'{}');
 RETURN jid;
END $$;
REVOKE ALL ON FUNCTION public.queue_export(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_export(text,text) TO ai_business;

-- The persisted task is also the outbox. Redis contains only its ID; tenant and
-- actor identity are always loaded from this database by the trusted worker.
CREATE OR REPLACE FUNCTION public.pending_jobs() RETURNS TABLE(id text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT j.id FROM public.tenant_job j WHERE (j.state='pending' AND j.attempts<5) OR (j.state='running' AND j.lease_until<now()) ORDER BY j.created_at LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.pending_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pending_jobs() TO ai_worker;

CREATE OR REPLACE FUNCTION public.claim_job(p_id text) RETURNS TABLE(id text,tenant_id text,actor_id text,kind text,lease_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.tenant_job; token text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO job FROM public.tenant_job j WHERE j.id=p_id FOR UPDATE;
 IF NOT FOUND OR job.state IN ('succeeded','failed','cancelled') OR (job.state='running' AND job.lease_until>now()) THEN RETURN; END IF;
 IF job.attempts>=5 THEN UPDATE public.tenant_job SET state='failed',last_error='RETRY_LIMIT',updated_at=now() WHERE tenant_job.id=p_id; RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant t JOIN public.membership m ON m.tenant_id=t.id JOIN public.auth_user u ON u.id=m.user_id
 WHERE t.id=job.tenant_id AND t.status='active' AND m.user_id=job.actor_id AND m.active AND m.role='owner' AND (u."platformRole"<>'platform_admin' OR u."twoFactorEnabled") AND NOT u.disabled) THEN
 UPDATE public.tenant_job SET state='cancelled',last_error='ACCESS_REVOKED',updated_at=now() WHERE tenant_job.id=p_id; RETURN; END IF;
 UPDATE public.tenant_job SET state='running',attempts=attempts+1,lease_token=token,lease_until=now()+interval '60 seconds',updated_at=now() WHERE tenant_job.id=p_id;
 RETURN QUERY SELECT job.id,job.tenant_id,job.actor_id,job.kind,token;
END $$;
REVOKE ALL ON FUNCTION public.claim_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_job(text) TO ai_worker;

CREATE OR REPLACE FUNCTION public.export_audit_rows(p_id text,p_token text) RETURNS TABLE(action text,created_at timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.tenant_job;
BEGIN
 SELECT * INTO job FROM public.tenant_job WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_until>now();
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.tenant t JOIN public.membership m ON m.tenant_id=t.id JOIN public.auth_user u ON u.id=m.user_id
 WHERE t.id=job.tenant_id AND t.status='active' AND m.user_id=job.actor_id AND m.active AND m.role='owner' AND (u."platformRole"<>'platform_admin' OR u."twoFactorEnabled") AND NOT u.disabled) THEN RAISE EXCEPTION 'JOB_ACCESS_REVOKED'; END IF;
 RETURN QUERY SELECT a.action,a."createdAt" FROM public.audit_log a WHERE a.tenant_id=job.tenant_id ORDER BY a."createdAt" DESC LIMIT 1000;
END $$;
REVOKE ALL ON FUNCTION public.export_audit_rows(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_audit_rows(text,text) TO ai_worker;

CREATE OR REPLACE FUNCTION public.complete_export(p_id text,p_token text,p_size integer,p_sha text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.tenant_job;
BEGIN
 SELECT * INTO job FROM public.tenant_job WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.state<>'running' OR job.lease_token<>p_token OR job.lease_until<=now() THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant t JOIN public.membership m ON m.tenant_id=t.id JOIN public.auth_user u ON u.id=m.user_id
 WHERE t.id=job.tenant_id AND t.status='active' AND m.user_id=job.actor_id AND m.active AND m.role='owner' AND (u."platformRole"<>'platform_admin' OR u."twoFactorEnabled") AND NOT u.disabled) THEN
 UPDATE public.tenant_job SET state='cancelled',last_error='ACCESS_REVOKED',updated_at=now() WHERE id=p_id; RETURN false; END IF;
 IF p_size<0 OR p_size>1048576 OR p_sha !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_EXPORT'; END IF;
 INSERT INTO public.export_file(id,tenant_id,job_id,object_key,file_name,mime,size,sha256,expires_at)
 VALUES(p_id,job.tenant_id,p_id,'tenants/'||job.tenant_id||'/exports/'||p_id,'audit.csv','text/csv; charset=utf-8',p_size,p_sha,now()+interval '7 days');
 UPDATE public.tenant_job SET state='succeeded',lease_until=NULL,updated_at=now() WHERE id=p_id;
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
 VALUES(gen_random_uuid()::text,job.tenant_id,job.actor_id,'export.completed',p_id,'{}');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_export(text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_export(text,text,integer,text) TO ai_worker;

CREATE OR REPLACE FUNCTION public.fail_job(p_id text,p_token text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.tenant_job SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,last_error='EXECUTION_FAILED',lease_until=NULL,updated_at=now()
 WHERE id=p_id AND lease_token=p_token AND state='running';
$$;
REVOKE ALL ON FUNCTION public.fail_job(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_job(text,text) TO ai_worker;
COMMIT;
