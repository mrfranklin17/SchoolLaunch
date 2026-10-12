-- Phase 1 data safety: atomic "replace all rows for a school" for staffing_positions
-- and grade_expansion_plan.
--
-- BEFORE THIS MIGRATION:
-- The Staffing tab, Settings (grade expansion) and onboarding Step 2 saved by issuing
-- a DELETE of every row for the school and then a separate INSERT of the new set.
-- PostgREST runs each request in its own transaction, so a failed INSERT (network
-- drop, bad value, RLS) left the school with ZERO rows — all five years of staffing
-- or the whole grade plan gone — while the UI reported "changes not saved".
--
-- AFTER THIS MIGRATION:
-- One RPC per table performs the DELETE and INSERT inside a single function call,
-- i.e. a single transaction. Any error rolls back both statements, so the previously
-- saved rows survive. Callers: src/lib/atomicReplace.ts. Until this migration is
-- applied, that helper falls back to delete -> insert -> restore-snapshot-on-failure
-- (it detects the missing function via PostgREST error PGRST202).
--
-- SECURITY: SECURITY INVOKER (the default) — RLS on both tables still applies to the
-- caller, so viewers and users from other schools cannot replace rows (the INSERT
-- fails the policy check and the DELETE rolls back with it). school_id on every
-- inserted row is forced to p_school_id; any school_id in p_rows is ignored.
--
-- COLUMNS: exactly the columns the existing client inserts already write, so stored
-- values are byte-identical to the pre-migration save path.

BEGIN;

CREATE OR REPLACE FUNCTION public.replace_staffing_positions(p_school_id uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'replace_staffing_positions: p_school_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'replace_staffing_positions: p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.staffing_positions WHERE school_id = p_school_id;

  INSERT INTO public.staffing_positions (
    school_id, year, title, category, fte, annual_salary, position_type, driver,
    classification, benchmark_salary, students_per_position, sort_order, manual_override
  )
  SELECT
    p_school_id, r.year, r.title, r.category, r.fte, r.annual_salary, r.position_type, r.driver,
    r.classification, r.benchmark_salary, r.students_per_position, r.sort_order,
    COALESCE(r.manual_override, false)
  FROM jsonb_populate_recordset(NULL::public.staffing_positions, p_rows) AS r;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_grade_expansion_plan(p_school_id uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'replace_grade_expansion_plan: p_school_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'replace_grade_expansion_plan: p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.grade_expansion_plan WHERE school_id = p_school_id;

  INSERT INTO public.grade_expansion_plan (
    school_id, year, grade_level, sections, students_per_section, is_new_grade
  )
  SELECT p_school_id, r.year, r.grade_level, r.sections, r.students_per_section, r.is_new_grade
  FROM jsonb_populate_recordset(NULL::public.grade_expansion_plan, p_rows) AS r;
END;
$$;

-- Supabase grants EXECUTE on new public functions to anon by default; signed-in
-- users (and the service role) are the only legitimate callers.
REVOKE ALL ON FUNCTION public.replace_staffing_positions(uuid, jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.replace_grade_expansion_plan(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.replace_staffing_positions(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_grade_expansion_plan(uuid, jsonb) TO authenticated, service_role;

COMMIT;

-- Make the new functions visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
