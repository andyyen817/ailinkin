BEGIN;
CREATE TABLE IF NOT EXISTS public.research_campaign(
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES public.tenant(id), actor_id text NOT NULL REFERENCES public.auth_user(id),
 input_hash text NOT NULL, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','running','blocked','partial','complete')),
 message text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 lease_token text, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,input_hash), CHECK(data->'project'->>'tenantId'=tenant_id)
);
ALTER TABLE public.research_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_campaign FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.research_campaign FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.research_campaign TO ai_business;
CREATE POLICY research_read ON public.research_campaign FOR SELECT TO ai_business
 USING(tenant_id=current_setting('app.tenant_id',true) AND public.profile_can_access(false));
CREATE POLICY research_insert ON public.research_campaign FOR INSERT TO ai_business
 WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.user_id',true) AND public.profile_can_access(true));
CREATE POLICY research_update ON public.research_campaign FOR UPDATE TO ai_business
 USING(tenant_id=current_setting('app.tenant_id',true) AND public.profile_can_access(true))
 WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND public.profile_can_access(true));
COMMIT;
