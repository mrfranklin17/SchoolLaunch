import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/apiAuth'
import { undoPlanChange } from '@/lib/planChangeStore'
import { markRequestUndone } from '@/lib/changeRequestStore'

/**
 * Phase 6b: undo a change applied from chat. Owners only. Refused when the plan has been
 * edited since, so Undo never overwrites later work. Body: { schoolId, changeId }.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { schoolId?: unknown; changeId?: unknown } | null
  const schoolId = typeof body?.schoolId === 'string' ? body.schoolId : undefined
  const auth = await authenticateRequest(req, { schoolId, requireRoles: ['school_ceo'] })
  if (auth instanceof NextResponse) return auth
  if (typeof body?.changeId !== 'string') return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })

  const result = await undoPlanChange(auth.supabase, schoolId!, auth.user.id, body.changeId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  // A change that came from an Editor's request: the request reads "undone" too.
  await markRequestUndone(auth.supabase, schoolId!, body.changeId)
  return NextResponse.json({ ok: true })
}
