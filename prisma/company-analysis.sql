BEGIN;
CREATE TABLE IF NOT EXISTS public.company_analysis(
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES public.tenant(id),
 actor_id text NOT NULL REFERENCES public.auth_user(id), input_hash text NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','running','complete','blocked','unknown')),
 message text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,input_hash)
);
ALTER TABLE public.company_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_analysis FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_analysis FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.company_analysis TO ai_business;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_analysis' AND policyname='analysis_read') THEN
  CREATE POLICY analysis_read ON public.company_analysis FOR SELECT TO ai_business
   USING(tenant_id=current_setting('app.tenant_id',true) AND public.profile_can_access(false));
  CREATE POLICY analysis_insert ON public.company_analysis FOR INSERT TO ai_business
   WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.user_id',true) AND public.profile_can_access(true));
  CREATE POLICY analysis_update ON public.company_analysis FOR UPDATE TO ai_business
   USING(tenant_id=current_setting('app.tenant_id',true) AND public.profile_can_access(true))
   WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND public.profile_can_access(true));
 END IF;
END $$;
COMMIT;
