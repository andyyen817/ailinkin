BEGIN;
CREATE TABLE IF NOT EXISTS research_contact_link(
 tenant_id text NOT NULL,provider_person_id text NOT NULL,organization_id text NOT NULL,contact_id text NOT NULL,
 observations jsonb NOT NULL CHECK(jsonb_typeof(observations)='object'),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,provider_person_id),
 FOREIGN KEY(tenant_id,organization_id) REFERENCES organization_asset(tenant_id,id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contact(tenant_id,id)
);
ALTER TABLE research_contact_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_contact_link FORCE ROW LEVEL SECURITY;
REVOKE ALL ON research_contact_link FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON research_contact_link TO ai_business;
CREATE POLICY research_contact_read ON research_contact_link FOR SELECT TO ai_business
 USING(tenant_id=current_setting('app.tenant_id',true) AND profile_can_access(false));
CREATE POLICY research_contact_write ON research_contact_link FOR INSERT TO ai_business
 WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND profile_can_access(true));
CREATE POLICY research_contact_update ON research_contact_link FOR UPDATE TO ai_business
 USING(tenant_id=current_setting('app.tenant_id',true) AND profile_can_access(true))
 WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND profile_can_access(true));
COMMIT;
