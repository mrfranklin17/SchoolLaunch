-- Phase 6b (ROADMAP.md): change log for plan changes applied from Ask SchoolLaunch.
--
-- Each row is one Apply: the proposed changes, the lines the Owner confirmed, and the
-- touched parts of the plan before and after (src/lib/chatEdits.ts PlanState). Undo restores
-- `before_state` only while the plan still matches `after_state`, then stamps undone_at.
--
-- Writes come from /api/plan-changes/{apply,undo} with the caller's own session, so these
-- policies are the backstop: only the school's Owner (school_ceo) or a super_admin inserts or
-- marks a row undone; every role linked to the school can read its log. No delete policy:
-- the log is append-only. school_id / applied_by carry no foreign keys so deleting a school
-- or a user is never blocked by its history.

BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  applied_by uuid NOT NULL DEFAULT auth.uid(),
  source text NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'manual')),
  changes jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by uuid
);

CREATE INDEX IF NOT EXISTS plan_changes_school_created_idx
  ON public.plan_changes (school_id, created_at DESC);

ALTER TABLE public.plan_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_changes_select_school_roles"
ON public.plan_changes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role IN ('school_ceo', 'school_editor', 'school_viewer') AND ur.school_id = plan_changes.school_id)
        OR (ur.role = 'org_admin' AND ur.organization_id = (
          SELECT s.organization_id FROM public.schools s WHERE s.id = plan_changes.school_id
        ))
        OR ur.role = 'super_admin'
      )
  )
);

CREATE POLICY "plan_changes_insert_owner"
ON public.plan_changes
FOR INSERT
WITH CHECK (
  applied_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role = 'school_ceo' AND ur.school_id = plan_changes.school_id)
        OR ur.role = 'super_admin'
      )
  )
);

CREATE POLICY "plan_changes_update_owner"
ON public.plan_changes
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role = 'school_ceo' AND ur.school_id = plan_changes.school_id)
        OR ur.role = 'super_admin'
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role = 'school_ceo' AND ur.school_id = plan_changes.school_id)
        OR ur.role = 'super_admin'
      )
  )
);

COMMIT;
