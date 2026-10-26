-- Phase 6c (ROADMAP.md): Editors send plan changes proposed in Ask SchoolLaunch to the Owner.
--
-- A request holds the proposed changes (src/lib/chatEdits.ts PlanChange[]), the before → after
-- lines the Editor saw, and an optional note. The Owner reviews it in the Inbox and applies it
-- (through /api/plan-changes/apply, which links plan_change_id) or declines it; the Editor can
-- withdraw it while it is pending. owner_read_at drives the Owner's unread indicator.
--
-- Writes come from the /api/change-requests and /api/plan-changes routes with the caller's own
-- session; these policies are the backstop. No delete policy: requests are a record. No foreign
-- keys, so deleting a school or a user is never blocked by its history.

BEGIN;

CREATE TABLE IF NOT EXISTS public.change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  requested_by uuid NOT NULL DEFAULT auth.uid(),
  requester_name text NOT NULL DEFAULT '',
  changes jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'declined', 'withdrawn', 'undone')),
  decline_reason text NOT NULL DEFAULT '',
  plan_change_id uuid,
  owner_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

CREATE INDEX IF NOT EXISTS change_requests_school_status_idx
  ON public.change_requests (school_id, status, created_at DESC);

ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;

-- The school's Owner and Editors (and admins) see the school's requests. Viewers can't propose.
CREATE POLICY "change_requests_select_school_editors"
ON public.change_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role IN ('school_ceo', 'school_editor') AND ur.school_id = change_requests.school_id)
        OR (ur.role = 'org_admin' AND ur.organization_id = (
          SELECT s.organization_id FROM public.schools s WHERE s.id = change_requests.school_id
        ))
        OR ur.role = 'super_admin'
      )
  )
);

-- An Editor (or the Owner) files a pending request as themselves.
CREATE POLICY "change_requests_insert_editor"
ON public.change_requests
FOR INSERT
WITH CHECK (
  requested_by = auth.uid()
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role IN ('school_ceo', 'school_editor') AND ur.school_id = change_requests.school_id)
        OR ur.role = 'super_admin'
      )
  )
);

-- The Owner resolves requests and marks them read.
CREATE POLICY "change_requests_update_owner"
ON public.change_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role = 'school_ceo' AND ur.school_id = change_requests.school_id)
        OR ur.role = 'super_admin'
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.role = 'school_ceo' AND ur.school_id = change_requests.school_id)
        OR ur.role = 'super_admin'
      )
  )
);

-- The requester can only withdraw their own pending request.
CREATE POLICY "change_requests_withdraw_own"
ON public.change_requests
FOR UPDATE
USING (requested_by = auth.uid() AND status = 'pending')
WITH CHECK (requested_by = auth.uid() AND status = 'withdrawn');

COMMIT;
