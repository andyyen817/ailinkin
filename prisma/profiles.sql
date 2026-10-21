BEGIN;
CREATE TABLE IF NOT EXISTS company_profile(
 tenant_id text PRIMARY KEY REFERENCES tenant(id), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product(
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS product_fact(
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), product_id text NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES product(tenant_id,id),
 CHECK(COALESCE(data->>'status','') IN ('pending','confirmed','expired')),
 CHECK(data->>'status'<>'confirmed' OR length(btrim(COALESCE(data->>'source','')))>0)
);
CREATE TABLE IF NOT EXISTS icp(
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), product_id text NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES product(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS profile_revision(
 tenant_id text NOT NULL REFERENCES tenant(id), kind text NOT NULL CHECK(kind IN ('company_profile','product','product_fact','icp')),
 record_id text NOT NULL, version integer NOT NULL CHECK(version>0), data jsonb NOT NULL, actor_id text NOT NULL REFERENCES auth_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,kind,record_id,version)
);

CREATE OR REPLACE FUNCTION profile_can_access(p_owner boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant t JOIN public.membership m ON m.tenant_id=t.id JOIN public.auth_user u ON u.id=m.user_id
 WHERE t.id=current_setting('app.tenant_id',true) AND t.status='active' AND m.user_id=current_setting('app.user_id',true)
 AND m.active AND NOT u.disabled AND (u."platformRole"<>'platform_admin' OR u."twoFactorEnabled") AND (NOT p_owner OR m.role='owner'));
$$;
REVOKE ALL ON FUNCTION profile_can_access(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION profile_can_access(boolean) TO ai_business;

DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['company_profile','product','product_fact','icp','profile_revision'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',name);
  EXECUTE format('GRANT SELECT ON public.%I TO ai_business',name);
  EXECUTE format('DROP POLICY IF EXISTS profile_read ON public.%I',name);
  EXECUTE format('CREATE POLICY profile_read ON public.%I FOR SELECT TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND public.profile_can_access(false))',name);
  IF name<>'profile_revision' THEN
   EXECUTE format('GRANT INSERT,UPDATE ON public.%I TO ai_business',name);
   EXECUTE format('DROP POLICY IF EXISTS profile_insert ON public.%I',name);
   EXECUTE format('DROP POLICY IF EXISTS profile_update ON public.%I',name);
   EXECUTE format('CREATE POLICY profile_insert ON public.%I FOR INSERT TO ai_business WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND public.profile_can_access(%L))',name,name<>'icp');
   EXECUTE format('CREATE POLICY profile_update ON public.%I FOR UPDATE TO ai_business USING(tenant_id=current_setting(''app.tenant_id'',true) AND public.profile_can_access(%L)) WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true) AND public.profile_can_access(%L))',name,name<>'icp',name<>'icp');
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION profile_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.tenant_id<>OLD.tenant_id OR (to_jsonb(NEW)->>'id') IS DISTINCT FROM (to_jsonb(OLD)->>'id') OR (to_jsonb(NEW)->>'product_id') IS DISTINCT FROM (to_jsonb(OLD)->>'product_id') THEN RAISE EXCEPTION 'IMMUTABLE_PROFILE_ID'; END IF;
  NEW.version:=OLD.version+1;
 ELSE NEW.version:=1; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION profile_save_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rid text:=COALESCE(to_jsonb(NEW)->>'id',NEW.tenant_id); BEGIN
 INSERT INTO public.profile_revision(tenant_id,kind,record_id,version,data,actor_id)
 VALUES(NEW.tenant_id,TG_TABLE_NAME,rid,NEW.version,NEW.data||jsonb_build_object('productId',to_jsonb(NEW)->'product_id'),current_setting('app.user_id',true));
 INSERT INTO public.audit_log(id,tenant_id,"actorId",action,"targetId",metadata)
 VALUES(gen_random_uuid()::text,NEW.tenant_id,current_setting('app.user_id',true),TG_TABLE_NAME||'.saved',rid,jsonb_build_object('version',NEW.version));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION profile_version_guard(),profile_save_revision() FROM PUBLIC;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['company_profile','product','product_fact','icp'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS version_guard ON public.%I',name);
  EXECUTE format('DROP TRIGGER IF EXISTS save_revision ON public.%I',name);
  EXECUTE format('CREATE TRIGGER version_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.profile_version_guard()',name);
  EXECUTE format('CREATE TRIGGER save_revision AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.profile_save_revision()',name);
 END LOOP;
END $$;
COMMIT;
