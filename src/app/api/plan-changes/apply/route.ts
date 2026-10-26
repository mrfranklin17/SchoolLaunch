import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/apiAuth'
import { parsePlanChange, type ChangeLine, type PlanChange } from '@/lib/chatEdits'
import { applyPlanChanges } from '@/lib/planChangeStore'
import { loadPendingRequest, markRequestApplied } from '@/lib/changeRequestStore'

/**
 * Phase 6b: apply changes proposed in Ask SchoolLaunch to the live plan. Owners only (a
 * super_admin passes too); the founder has confirmed the before → after lines in `expected`.
 * Body: { schoolId, changes: PlanChange[], expected: ChangeLine[] } or, for an Editor's request
 * (6c), { schoolId, requestId, expected } — the request's own changes are applied.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { schoolId?: unknown; changes?: unknown; expected?: unknown; requestId?: unknown } | null
  const schoolId = typeof body?.schoolId === 'string' ? body.schoolId : undefined
  const auth = await authenticateRequest(req, { schoolId, requireRoles: ['school_ceo'] })
  if (auth instanceof NextResponse) return auth
  if (!Array.isArray(body?.expected)) return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })

  // Chat edits cover the WA charter engine only.
  const { data: school } = await auth.supabase.from('schools').select('pathway').eq('id', schoolId!).maybeSingle()
  if (school?.pathway && school.pathway !== 'wa_charter') {
    return NextResponse.json({ error: 'Applying changes from chat is available for WA charter schools only.' }, { status: 400 })
  }

  const requestId = typeof body?.requestId === 'string' ? body.requestId : null
  let changes: (PlanChange | null)[]
  if (requestId) {
    const pending = await loadPendingRequest(auth.supabase, schoolId!, requestId)
    if (!pending.ok) return NextResponse.json({ error: pending.error }, { status: pending.status })
    changes = (Array.isArray(pending.request.changes) ? pending.request.changes : []).map(parsePlanChange)
  } else {
    changes = Array.isArray(body?.changes) ? body.changes.map(parsePlanChange) : []
  }
  if (changes.length === 0 || changes.some((c) => c === null)) {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })
  }

  const result = await applyPlanChanges(auth.supabase, schoolId!, auth.user.id, changes as PlanChange[], body!.expected as ChangeLine[])
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  if (requestId) {
    const marked = await markRequestApplied(auth.supabase, schoolId!, auth.user.id, requestId, result.changeId)
    if (!marked.ok) console.error('[plan-changes/apply] applied, but the request could not be marked applied:', marked.error)
  }
  return NextResponse.json({ changeId: result.changeId })
}
