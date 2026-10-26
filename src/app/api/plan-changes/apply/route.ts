import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/apiAuth'
import { parsePlanChange, type ChangeLine, type PlanChange } from '@/lib/chatEdits'
import { applyPlanChanges } from '@/lib/planChangeStore'

/**
 * Phase 6b: apply changes proposed in Ask SchoolLaunch to the live plan. Owners only (a
 * super_admin passes too); the founder has confirmed the before → after lines in `expected`.
 * Body: { schoolId, changes: PlanChange[], expected: ChangeLine[] }.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { schoolId?: unknown; changes?: unknown; expected?: unknown } | null
  const schoolId = typeof body?.schoolId === 'string' ? body.schoolId : undefined
  const auth = await authenticateRequest(req, { schoolId, requireRoles: ['school_ceo'] })
  if (auth instanceof NextResponse) return auth

  const changes = Array.isArray(body?.changes) ? body.changes.map(parsePlanChange) : []
  if (changes.length === 0 || changes.some((c) => c === null) || !Array.isArray(body?.expected)) {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })
  }

  // Chat edits cover the WA charter engine only.
  const { data: school } = await auth.supabase.from('schools').select('pathway').eq('id', schoolId!).maybeSingle()
  if (school?.pathway && school.pathway !== 'wa_charter') {
    return NextResponse.json({ error: 'Applying changes from chat is available for WA charter schools only.' }, { status: 400 })
  }

  const result = await applyPlanChanges(auth.supabase, schoolId!, auth.user.id, changes as PlanChange[], body!.expected as ChangeLine[])
  return result.ok
    ? NextResponse.json({ changeId: result.changeId })
    : NextResponse.json({ error: result.error }, { status: result.status })
}
