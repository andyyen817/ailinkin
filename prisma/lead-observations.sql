BEGIN;
CREATE TABLE IF NOT EXISTS source_observation(
 id text PRIMARY KEY,tenant_id text NOT NULL,organization_id text NOT NULL,
 provider text NOT NULL,source_url text NOT NULL,content_hash text NOT NULL CHECK(length(content_hash)=64),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 kind text NOT NULL CHECK(kind IN ('organization_fact','person_data','private_note','communication')),
 reuse_policy text NOT NULL DEFAULT 'tenant_only' CHECK(reuse_policy IN ('tenant_only','public_company','licensed_platform')),
 retrieved_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,
 FOREIGN KEY(tenant_id,organization_id) REFERENCES organization_asset(tenant_id,id),
 UNIQUE(tenant_id,organization_id,provider,source_url,content_hash),
 CHECK(kind='organization_fact' OR reuse_policy='tenant_only')
);
CREATE TABLE IF NOT EXISTS tenant_organization(
 tenant_id text NOT NULL,organization_id text NOT NULL,
 notes text NOT NULL DEFAULT '',do_not_contact boolean NOT NULL DEFAULT false,
 qualification jsonb,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,organization_id),
 FOREIGN KEY(tenant_id,organization_id) REFERENCES organization_asset(tenant_id,id)
);
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['source_observation','tenant_organization'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',target);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO ai_business',target);
  EXECUTE format('CREATE POLICY observation_read ON %I FOR SELECT TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(false))',target);
  EXECUTE format('CREATE POLICY observation_insert ON %I FOR INSERT TO ai_business WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(true))',target);
 END LOOP;
END $$;
GRANT UPDATE ON tenant_organization TO ai_business;
CREATE POLICY assessment_update ON tenant_organization FOR UPDATE TO ai_business
 USING(tenant_id=current_setting('app.tenant_id',true) AND profile_can_access(true))
 WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND profile_can_access(true));
COMMIT;
