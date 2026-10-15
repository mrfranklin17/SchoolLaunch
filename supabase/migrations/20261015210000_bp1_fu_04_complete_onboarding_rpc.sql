-- BP1-FU-04: onboarding completion in one transaction.
--
-- BEFORE THIS MIGRATION:
-- /api/onboarding/complete saved Year-1 staffing, the Year-1 budget lines, the base
-- scenario and the onboarding_complete flag as separate requests. Each was safe on its
-- own and a retry converged, but a failure partway left them out of step until the
-- founder retried; a failure on the last step was logged and reported as success, so the
-- founder reached the dashboard with onboarding_complete still false. The staffing step
-- also resent Years 2-5 through replace_staffing_positions, which resets funding_source
-- and notes on those rows.
--
-- AFTER THIS MIGRATION:
-- complete_onboarding performs all four writes in one function call, i.e. one
-- transaction: any error rolls back every step. Years 2-5 of staffing are not touched.
-- Caller: src/app/api/onboarding/complete/route.ts. Until this migration is applied the
-- route keeps its step-by-step path (it detects the missing function via PGRST202).
--
-- SECURITY: SECURITY INVOKER, executable by service_role only. The route authenticates
-- the caller as the school's CEO before calling it with the service-role client.
-- school_id and year on every inserted row are forced from the arguments.
--
-- COLUMNS: as the route's existing writes. A key missing from a row falls back to the
-- column's default (COALESCE with the live defaults as of 2026-10-15).

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_school_id uuid,
  p_staffing jsonb,
  p_projections jsonb,
  p_scenario_assumptions jsonb,
  p_financial_assumptions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'complete_onboarding: p_school_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_staffing IS NULL OR jsonb_typeof(p_staffing) <> 'array'
     OR p_projections IS NULL OR jsonb_typeof(p_projections) <> 'array' THEN
    RAISE EXCEPTION 'complete_onboarding: p_staffing and p_projections must be JSON arrays' USING ERRCODE = '22023';
  END IF;
  IF p_scenario_assumptions IS NULL OR jsonb_typeof(p_scenario_assumptions) <> 'object'
     OR p_financial_assumptions IS NULL OR jsonb_typeof(p_financial_assumptions) <> 'object' THEN
    RAISE EXCEPTION 'complete_onboarding: assumptions must be JSON objects' USING ERRCODE = '22023';
  END IF;

  -- 1. Year-1 staffing. Years 2-5 stay as they are.
  DELETE FROM public.staffing_positions WHERE school_id = p_school_id AND year = 1;
  INSERT INTO public.staffing_positions (
    school_id, year, title, category, fte, annual_salary, funding_source, notes, position_type,
    driver, classification, benchmark_salary, students_per_position, sort_order, manual_override
  )
  SELECT
    p_school_id, 1, r.title, r.category, COALESCE(r.fte, 1.0), r.annual_salary,
    COALESCE(r.funding_source, 'general'), r.notes, COALESCE(r.position_type, 'custom'),
    COALESCE(r.driver, 'fixed'), COALESCE(r.classification, 'Administrative'),
    COALESCE(r.benchmark_salary, 0), COALESCE(r.students_per_position, 24),
    COALESCE(r.sort_order, 0), COALESCE(r.manual_override, false)
  FROM jsonb_populate_recordset(NULL::public.staffing_positions, p_staffing) AS r;

  -- 2. Year-1 budget lines: write the plan's lines, then remove Year-1 lines it no longer has.
  INSERT INTO public.budget_projections (school_id, year, category, subcategory, amount, is_revenue)
  SELECT p_school_id, 1, r.category, r.subcategory, COALESCE(r.amount, 0), COALESCE(r.is_revenue, false)
  FROM jsonb_populate_recordset(NULL::public.budget_projections, p_projections) AS r
  ON CONFLICT (school_id, year, category, subcategory)
  DO UPDATE SET amount = EXCLUDED.amount, is_revenue = EXCLUDED.is_revenue, updated_at = now();

  DELETE FROM public.budget_projections AS b
  WHERE b.school_id = p_school_id AND b.year = 1
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_populate_recordset(NULL::public.budget_projections, p_projections) AS r
      WHERE r.category = b.category AND r.subcategory IS NOT DISTINCT FROM b.subcategory
    );

  -- 3. Base scenario: replace every previous one.
  DELETE FROM public.scenarios WHERE school_id = p_school_id AND is_base_case = true;
  INSERT INTO public.scenarios (school_id, name, is_base_case, assumptions)
  VALUES (p_school_id, 'Base Case', true, p_scenario_assumptions);

  -- 4. Mark onboarding complete.
  UPDATE public.school_profiles
  SET onboarding_complete = true, financial_assumptions = p_financial_assumptions
  WHERE school_id = p_school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_onboarding: no school profile for %', p_school_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Supabase grants EXECUTE on new public functions to anon (and authenticated) by default;
-- the route's service-role client is the only legitimate caller.
REVOKE ALL ON FUNCTION public.complete_onboarding(uuid, jsonb, jsonb, jsonb, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(uuid, jsonb, jsonb, jsonb, jsonb) TO service_role;

COMMIT;

-- Make the new function visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
