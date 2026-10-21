-- T02 base policies, exercised in the isolated local test database. Run after schema creation,
-- in an explicitly selected development/staging database as its migration owner.
-- Authentication and business connections must use separate login roles.
-- The login roles must be NOSUPERUSER NOBYPASSRLS and must not own tables.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_identity') THEN
    CREATE ROLE ai_identity NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_business') THEN
    CREATE ROLE ai_business NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ai_identity, ai_business;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_session, auth_account,
  auth_verification, auth_two_factor, auth_rate_limit TO ai_identity;
GRANT SELECT ON tenant, membership TO ai_business;
GRANT SELECT, INSERT ON audit_log TO ai_business;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_self_read ON membership FOR SELECT TO ai_business
  USING (tenant_id = current_setting('app.tenant_id', true)
     AND user_id = current_setting('app.user_id', true) AND active);

CREATE POLICY tenant_member_read ON tenant FOR SELECT TO ai_business
  USING (id = current_setting('app.tenant_id', true) AND status = 'active'
     AND EXISTS (SELECT 1 FROM membership m WHERE m.tenant_id = tenant.id
       AND m.user_id = current_setting('app.user_id', true) AND m.active));

CREATE POLICY audit_member_read ON audit_log FOR SELECT TO ai_business
  USING (tenant_id = current_setting('app.tenant_id', true)
    AND EXISTS (SELECT 1 FROM tenant t WHERE t.id = audit_log.tenant_id));

CREATE POLICY audit_actor_insert ON audit_log FOR INSERT TO ai_business
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
    AND "actorId" = current_setting('app.user_id', true)
    AND EXISTS (SELECT 1 FROM tenant t WHERE t.id = audit_log.tenant_id));

-- Invitations intentionally have no application grants/policies until the
-- token consumption + provisioning transaction is implemented and verified.
COMMIT;
