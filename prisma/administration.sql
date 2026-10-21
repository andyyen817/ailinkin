-- T02 administration operations; identity role is privileged only through
-- these narrow functions. Caller identity comes from the server-side session.
BEGIN;
CREATE TABLE IF NOT EXISTS public.support_grant (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES public.tenant(id),
 admin_id text NOT NULL REFERENCES public.auth_user(id), granted_by text NOT NULL REFERENCES public.auth_user(id),
 reason text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tenant_pause_request (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES public.tenant(id),
 status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_grant FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_pause_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_pause_request FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_grant, public.tenant_pause_request FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.require_platform_admin(p_user text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.auth_user WHERE id=p_user AND "platformRole"='platform_admin'
  AND "twoFactorEnabled" AND NOT disabled) THEN RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_platform_admin(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_tenants(p_user text)
RETURNS TABLE(id text,name text,status text,member_count bigint,pause_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.require_platform_admin(p_user);
 RETURN QUERY SELECT t.id,t.name,t.status,(SELECT count(*) FROM public.membership m WHERE m.tenant_id=t.id AND active),
  (SELECT pr.status FROM public.tenant_pause_request pr WHERE pr.tenant_id=t.id ORDER BY pr.created_at DESC LIMIT 1)
 FROM public.tenant t ORDER BY t."createdAt" DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_tenants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_tenants(text) TO ai_identity;

CREATE OR REPLACE FUNCTION public.create_tenant(p_user text,p_name text,p_email text,p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text := gen_random_uuid()::text;
BEGIN
 PERFORM public.require_platform_admin(p_user);
 IF length(trim(p_name)) NOT BETWEEN 1 AND 100 OR length(p_email)>254 OR p_email NOT LIKE '%@%'
  OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_TENANT'; END IF;
 INSERT INTO public.tenant(id,name,"updatedAt") VALUES(tid,trim(p_name),now());
 INSERT INTO public.invitation(id,tenant_id,email,role,"tokenHash","expiresAt","inviterId")
 VALUES(gen_random_uuid()::text,tid,lower(p_email),'owner',p_hash,now()+interval '48 hours',p_user);
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,metadata)
 VALUES(gen_random_uuid()::text,tid,p_user,'tenant.created','{}');
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION public.create_tenant(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant(text,text,text,text) TO ai_identity;

CREATE OR REPLACE FUNCTION public.suspend_tenant(p_user text,p_tenant text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.require_platform_admin(p_user);
 PERFORM 1 FROM public.tenant WHERE id=p_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TENANT_UNAVAILABLE'; END IF;
 IF (SELECT status FROM public.tenant WHERE id=p_tenant)='suspended' THEN RETURN; END IF;
 UPDATE public.tenant SET status='suspended',"updatedAt"=now() WHERE id=p_tenant;
 INSERT INTO public.tenant_pause_request(id,tenant_id) VALUES(gen_random_uuid()::text,p_tenant);
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,metadata)
 VALUES(gen_random_uuid()::text,p_tenant,p_user,'tenant.suspended','{"providerPause":"pending"}');
END $$;
REVOKE ALL ON FUNCTION public.suspend_tenant(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suspend_tenant(text,text) TO ai_identity;

CREATE OR REPLACE FUNCTION public.require_tenant_owner() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text:=current_setting('app.tenant_id',true); uid text:=current_setting('app.user_id',true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.membership m JOIN public.tenant t ON t.id=m.tenant_id
  JOIN public.auth_user u ON u.id=m.user_id WHERE m.tenant_id=tid AND m.user_id=uid
  AND m.role='owner' AND m.active AND t.status='active' AND NOT u.disabled AND (u."platformRole"<>'platform_admin' OR u."twoFactorEnabled"))
  THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION public.require_tenant_owner() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.tenant_members()
RETURNS TABLE(id text,name text,email text,role text,active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text;
BEGIN
 tid:=public.require_tenant_owner();
 RETURN QUERY SELECT m.id,u.name,u.email,m.role,m.active FROM public.membership m
 JOIN public.auth_user u ON u.id=m.user_id WHERE m.tenant_id=tid ORDER BY m."createdAt";
END $$;
REVOKE ALL ON FUNCTION public.tenant_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_members() TO ai_business;

CREATE OR REPLACE FUNCTION public.disable_member(p_membership text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text; target public.membership;
BEGIN
 tid:=public.require_tenant_owner();
 SELECT * INTO target FROM public.membership WHERE id=p_membership AND tenant_id=tid FOR UPDATE;
 IF NOT FOUND OR target.role<>'member' THEN RAISE EXCEPTION 'MEMBER_UNAVAILABLE'; END IF;
 UPDATE public.membership SET active=false WHERE id=target.id;
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
 VALUES(gen_random_uuid()::text,tid,current_setting('app.user_id',true),'membership.disabled',target.id,'{}');
END $$;
REVOKE ALL ON FUNCTION public.disable_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disable_member(text) TO ai_business;

CREATE OR REPLACE FUNCTION public.grant_support(p_email text,p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text; aid text; gid text:=gen_random_uuid()::text;
BEGIN
 tid:=public.require_tenant_owner();
 SELECT id INTO aid FROM public.auth_user WHERE lower(email)=lower(p_email)
  AND "platformRole"='platform_admin' AND "twoFactorEnabled" AND NOT disabled;
 IF NOT FOUND OR length(trim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'INVALID_SUPPORT_GRANT'; END IF;
 INSERT INTO public.support_grant(id,tenant_id,admin_id,granted_by,reason,expires_at)
 VALUES(gid,tid,aid,current_setting('app.user_id',true),trim(p_reason),now()+interval '1 hour');
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
 VALUES(gen_random_uuid()::text,tid,current_setting('app.user_id',true),'support.granted',gid,'{"hours":1,"mode":"read-only"}');
 RETURN gid;
END $$;
REVOKE ALL ON FUNCTION public.grant_support(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_support(text,text) TO ai_business;

CREATE OR REPLACE FUNCTION public.revoke_support(p_grant text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text;
BEGIN
 tid:=public.require_tenant_owner();
 UPDATE public.support_grant SET revoked_at=now() WHERE id=p_grant AND tenant_id=tid;
 IF NOT FOUND THEN RAISE EXCEPTION 'GRANT_UNAVAILABLE'; END IF;
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
 VALUES(gen_random_uuid()::text,tid,current_setting('app.user_id',true),'support.revoked',p_grant,'{}');
END $$;
REVOKE ALL ON FUNCTION public.revoke_support(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_support(text) TO ai_business;

CREATE OR REPLACE FUNCTION public.support_audit(p_user text,p_tenant text,p_grant text)
RETURNS TABLE(action text,created_at timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.require_platform_admin(p_user);
 PERFORM 1 FROM public.support_grant g JOIN public.tenant t ON t.id=g.tenant_id
  JOIN public.membership m ON m.tenant_id=g.tenant_id AND m.user_id=g.granted_by
  JOIN public.auth_user u ON u.id=g.granted_by
 WHERE g.id=p_grant AND g.tenant_id=p_tenant AND g.admin_id=p_user
  AND g.revoked_at IS NULL AND g.expires_at>now() AND t.status='active'
  AND m.role='owner' AND m.active AND NOT u.disabled FOR SHARE OF g;
 IF NOT FOUND THEN RAISE EXCEPTION 'SUPPORT_ACCESS_DENIED'; END IF;
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
 VALUES(gen_random_uuid()::text,p_tenant,p_user,'support.audit_read',p_grant,'{}');
 RETURN QUERY SELECT a.action,a."createdAt" FROM public.audit_log a WHERE a.tenant_id=p_tenant ORDER BY a."createdAt" DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.support_audit(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_audit(text,text,text) TO ai_identity;
CREATE OR REPLACE FUNCTION public.tenant_support_grants()
RETURNS TABLE(id text,admin_email text,reason text,expires_at timestamptz,revoked_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid text;
BEGIN
 tid:=public.require_tenant_owner();
 RETURN QUERY SELECT g.id,u.email,g.reason,g.expires_at,g.revoked_at FROM public.support_grant g
 JOIN public.auth_user u ON u.id=g.admin_id WHERE g.tenant_id=tid ORDER BY g.created_at DESC LIMIT 50;
END $$;
REVOKE ALL ON FUNCTION public.tenant_support_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_support_grants() TO ai_business;
COMMIT;
