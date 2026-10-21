BEGIN;
CREATE TABLE IF NOT EXISTS search_scope(
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenant(id),scope_key text NOT NULL,
 facets jsonb NOT NULL CHECK(jsonb_typeof(facets)='object'),analysis_id text NOT NULL,
 analysis_version integer NOT NULL CHECK(analysis_version>0),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,scope_key)
);
CREATE TABLE IF NOT EXISTS scope_relation(
 tenant_id text NOT NULL,left_scope text NOT NULL,right_scope text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>0),verified boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,left_scope,right_scope),CHECK(left_scope<>right_scope),
 FOREIGN KEY(tenant_id,left_scope) REFERENCES search_scope(tenant_id,id),
 FOREIGN KEY(tenant_id,right_scope) REFERENCES search_scope(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS query_checkpoint(
 tenant_id text NOT NULL,request_key text NOT NULL,scope_id text NOT NULL,provider text NOT NULL,
 parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object'),
 state text NOT NULL CHECK(state IN ('pending','done','unknown','failed','exhausted')),
 response jsonb,exclusion_hash text NOT NULL,generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 reserved_units integer NOT NULL DEFAULT 0 CHECK(reserved_units>=0),expires_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,request_key),
 FOREIGN KEY(tenant_id,scope_id) REFERENCES search_scope(tenant_id,id)
);
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['search_scope','scope_relation','query_checkpoint'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',target);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO ai_business',target);
  EXECUTE format('CREATE POLICY search_control_read ON %I FOR SELECT TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(false))',target);
  EXECUTE format('CREATE POLICY search_control_insert ON %I FOR INSERT TO ai_business WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(true))',target);
  EXECUTE format('CREATE POLICY search_control_update ON %I FOR UPDATE TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(true)) WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND profile_can_access(true))',target);
 END LOOP;
END $$;
COMMIT;
