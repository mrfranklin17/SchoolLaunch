import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/apiAuth'
import { canApplyFromChat, parsePlanChange, type PlanChange } from '@/lib/chatEdits'
import {
  createChangeRequest,
  declineChangeRequest,
  markRequestsRead,
  withdrawChangeRequest,
  type StoreOutcome,
} from '@/lib/changeRequestStore'

/**
 * Phase 6c: change requests from Editors to the Owner. Applying one goes through
 * /api/plan-changes/apply with its requestId. Body: { schoolId, action, ... }:
 *   create   — Owner or Editor: { changes: PlanChange[], note? }
 *   decline  — Owner: { requestId, reason? }
 *   withdraw — the requester: { requestId }
 *   mark_read — Owner: marks the school's unread pending requests read
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const schoolId = typeof body?.schoolId === 'string' ? body.schoolId : undefined
  const action = body?.action
  const ownerOnly = action === 'decline' || action === 'mark_read'
  const auth = await authenticateRequest(req, {
    schoolId,
    requireRoles: ownerOnly ? ['school_ceo'] : ['school_ceo', 'school_editor'],
  })
  if (auth instanceof NextResponse) return auth
  const requestId = typeof body?.requestId === 'string' ? body.requestId : null

  let result: StoreOutcome<{ id?: string }>
  switch (action) {
    case 'create': {
      const changes = Array.isArray(body?.changes) ? body.changes.map(parsePlanChange) : []
      if (changes.length === 0 || changes.some((c) => c === null) || !canApplyFromChat(changes as PlanChange[])) {
        return NextResponse.json({ error: 'Only staffing, operations and grade plan changes can be sent to the Owner.' }, { status: 400 })
      }
      result = await createChangeRequest(auth.supabase, schoolId!, auth.user, changes as PlanChange[], body?.note)
      break
    }
    case 'decline':
      if (!requestId) return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })
      result = await declineChangeRequest(auth.supabase, schoolId!, auth.user.id, requestId, body?.reason)
      break
    case 'withdraw':
      if (!requestId) return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })
      result = await withdrawChangeRequest(auth.supabase, schoolId!, auth.user.id, requestId)
      break
    case 'mark_read':
      result = await markRequestsRead(auth.supabase, schoolId!)
      break
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, ...('id' in result && result.id ? { requestId: result.id } : {}) })
}
