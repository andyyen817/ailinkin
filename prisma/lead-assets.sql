BEGIN;
CREATE TABLE IF NOT EXISTS organization_asset(
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenant(id),
 canonical_key text NOT NULL CHECK(length(canonical_key) BETWEEN 1 AND 800),
 name text NOT NULL CHECK(length(btrim(name))>0),website text NOT NULL DEFAULT '',
 identity_state text NOT NULL DEFAULT 'pending' CHECK(identity_state IN ('pending','verified')),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,canonical_key)
);
CREATE TABLE IF NOT EXISTS organization_alias(
 tenant_id text NOT NULL,organization_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('domain','apollo_id','registry_id')),
 value text NOT NULL CHECK(length(btrim(value))>0),verified boolean NOT NULL DEFAULT false,
 source_ref text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,kind,value),
 FOREIGN KEY(tenant_id,organization_id) REFERENCES organization_asset(tenant_id,id),
 CHECK(NOT verified OR length(btrim(source_ref))>0)
);
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['organization_asset','organization_alias'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',target);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO ai_business',target);
  EXECUTE format('CREATE POLICY asset_read ON %I FOR SELECT TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(false))',target);
  EXECUTE format('CREATE POLICY asset_insert ON %I FOR INSERT TO ai_business WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(true))',target);
  EXECUTE format('CREATE POLICY asset_update ON %I FOR UPDATE TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(true)) WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(true))',target);
 END LOOP;
END $$;
COMMIT;
