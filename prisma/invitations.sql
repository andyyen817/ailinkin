-- Incremental T02 invitation functions. Apply as the schema owner.
BEGIN;
CREATE OR REPLACE FUNCTION public.accept_invitation(p_hash text, p_name text,
  p_password text, p_existing_user text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE inv public.invitation; company public.tenant; account public.auth_user; uid text;
BEGIN
  SELECT * INTO inv FROM public.invitation WHERE "tokenHash" = p_hash FOR UPDATE;
  IF NOT FOUND OR inv."acceptedAt" IS NOT NULL OR inv."revokedAt" IS NOT NULL
     OR inv."expiresAt" <= now() THEN RAISE EXCEPTION 'INVITATION_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
  SELECT * INTO company FROM public.tenant WHERE id = inv.tenant_id FOR UPDATE;
  IF company.status <> 'active' THEN RAISE EXCEPTION 'INVITATION_UNAVAILABLE'; END IF;
  IF (SELECT count(*) FROM public.membership WHERE tenant_id=company.id AND active) >= company."memberLimit"
    THEN RAISE EXCEPTION 'MEMBER_LIMIT'; END IF;
  IF inv.role NOT IN ('owner','member') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  SELECT * INTO account FROM public.auth_user WHERE lower(email)=lower(inv.email);
  IF FOUND THEN
    IF p_existing_user IS DISTINCT FROM account.id OR account.disabled THEN RAISE EXCEPTION 'EXISTING_ACCOUNT_LOGIN_REQUIRED'; END IF;
    uid := account.id;
  ELSE
    IF length(trim(p_name)) NOT BETWEEN 1 AND 100 OR length(p_password) < 64 THEN RAISE EXCEPTION 'INVALID_ACCOUNT'; END IF;
    uid := gen_random_uuid()::text;
    INSERT INTO public.auth_user(id,name,email,"emailVerified","updatedAt") VALUES(uid,trim(p_name),lower(inv.email),true,now());
    INSERT INTO public.auth_account(id,"accountId","providerId","userId",password,"updatedAt")
      VALUES(gen_random_uuid()::text,uid,'credential',uid,p_password,now());
  END IF;
  IF EXISTS (SELECT 1 FROM public.membership WHERE tenant_id=company.id AND user_id=uid) THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
  INSERT INTO public.membership(id,tenant_id,user_id,role) VALUES(gen_random_uuid()::text,company.id,uid,inv.role);
  UPDATE public.invitation SET "acceptedAt"=now() WHERE id=inv.id;
  INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
    VALUES(gen_random_uuid()::text,company.id,uid,'invitation.accepted',inv.id,'{}');
  RETURN uid;
END $$;
REVOKE ALL ON FUNCTION public.accept_invitation(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text,text,text,text) TO ai_identity;

CREATE OR REPLACE FUNCTION public.issue_invitation(p_email text, p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE company public.tenant; uid text := current_setting('app.user_id',true); iid text;
BEGIN
  SELECT * INTO company FROM public.tenant WHERE id=current_setting('app.tenant_id',true) FOR UPDATE;
  IF NOT FOUND OR company.status <> 'active' OR NOT EXISTS (
    SELECT 1 FROM public.membership m JOIN public.auth_user u ON u.id=m.user_id
    WHERE m.tenant_id=company.id AND m.user_id=uid AND m.role='owner' AND m.active
    AND NOT u.disabled AND (u."platformRole"<>'platform_admin' OR u."twoFactorEnabled")) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF length(p_email) > 254 OR p_email NOT LIKE '%@%' OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_INVITATION'; END IF;
  IF (SELECT count(*) FROM public.membership WHERE tenant_id=company.id AND active)
   + (SELECT count(*) FROM public.invitation WHERE tenant_id=company.id AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">now())
   >= company."memberLimit" THEN RAISE EXCEPTION 'MEMBER_LIMIT'; END IF;
  IF EXISTS (SELECT 1 FROM public.invitation WHERE tenant_id=company.id AND lower(email)=lower(p_email)
    AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">now()) THEN RAISE EXCEPTION 'INVITATION_EXISTS'; END IF;
  iid := gen_random_uuid()::text;
  INSERT INTO public.invitation(id,tenant_id,email,role,"tokenHash","expiresAt","inviterId")
    VALUES(iid,company.id,lower(p_email),'member',p_hash,now()+interval '48 hours',uid);
  INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
    VALUES(gen_random_uuid()::text,company.id,uid,'invitation.created',iid,'{}');
  RETURN iid;
END $$;
REVOKE ALL ON FUNCTION public.issue_invitation(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_invitation(text,text) TO ai_business;

-- Discovery returns only the authenticated account's memberships, not customer data.
CREATE OR REPLACE FUNCTION public.my_memberships(p_user text)
RETURNS TABLE(tenant_id text, name text, role text, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT t.id,t.name,m.role,t.status FROM public.tenant t
  JOIN public.membership m ON m.tenant_id=t.id JOIN public.auth_user u ON u.id=m.user_id
  WHERE m.user_id=p_user AND m.active AND NOT u.disabled ORDER BY t.name;
$$;
REVOKE ALL ON FUNCTION public.my_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_memberships(text) TO ai_identity;
COMMIT;
