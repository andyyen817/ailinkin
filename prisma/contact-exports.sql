BEGIN;
ALTER TABLE tenant_job DROP CONSTRAINT IF EXISTS tenant_job_kind_check;
ALTER TABLE tenant_job ADD CONSTRAINT tenant_job_kind_check CHECK(kind IN ('audit_export','contact_export'));
CREATE OR REPLACE FUNCTION queue_contact_export(p_key text,p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE jid text;
BEGIN
 jid:=public.queue_export(p_key,p_hash);
 UPDATE public.tenant_job SET kind='contact_export' WHERE id=jid AND state='pending';
 RETURN jid;
END $$;
CREATE OR REPLACE FUNCTION export_contact_rows(p_id text,p_token text) RETURNS TABLE(data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.tenant_job;
BEGIN
 SELECT * INTO job FROM public.tenant_job WHERE id=p_id AND kind='contact_export' AND state='running' AND lease_token=p_token AND lease_until>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'EXPORT_UNAVAILABLE';END IF;
 PERFORM set_config('app.tenant_id',job.tenant_id,true);PERFORM set_config('app.user_id',job.actor_id,true);
 PERFORM public.require_tenant_owner();
 IF (SELECT count(*) FROM public.contact WHERE tenant_id=job.tenant_id)>10000 THEN RAISE EXCEPTION 'EXPORT_ROW_LIMIT';END IF;
 RETURN QUERY SELECT c.data FROM public.contact c WHERE c.tenant_id=job.tenant_id ORDER BY c.id;
END $$;
CREATE OR REPLACE FUNCTION name_contact_export() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_job WHERE id=NEW.job_id AND tenant_id=NEW.tenant_id AND kind='contact_export') THEN NEW.file_name:='contacts.csv';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS name_contact_export ON export_file;
CREATE TRIGGER name_contact_export BEFORE INSERT ON export_file FOR EACH ROW EXECUTE FUNCTION name_contact_export();
REVOKE ALL ON FUNCTION queue_contact_export(text,text),export_contact_rows(text,text),name_contact_export() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_contact_export(text,text) TO ai_business;
GRANT EXECUTE ON FUNCTION export_contact_rows(text,text) TO ai_worker;
-- Deterministic object paths only; cleanup cannot enumerate or delete arbitrary objects.
CREATE OR REPLACE FUNCTION expired_export_objects() RETURNS TABLE(id text,object_key text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT id,object_key FROM public.export_file WHERE expires_at<=now() AND object_key='tenants/'||tenant_id||'/exports/'||id LIMIT 100;
$$;
CREATE OR REPLACE FUNCTION finish_export_cleanup(p_id text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DELETE FROM public.export_file WHERE id=p_id AND expires_at<=now();
$$;
CREATE OR REPLACE FUNCTION clean_expired_import_payloads() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.contact_import SET payload='[]',report=NULL,state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END WHERE expires_at<=now() AND (payload<>'[]'::jsonb OR report IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION expired_export_objects(),finish_export_cleanup(text),clean_expired_import_payloads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expired_export_objects(),finish_export_cleanup(text),clean_expired_import_payloads() TO ai_worker;
COMMIT;
