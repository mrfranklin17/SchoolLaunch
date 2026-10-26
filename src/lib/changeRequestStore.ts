/**
 * Phase 6c: change requests. An Editor sends a change proposed in Ask SchoolLaunch to the
 * Owner; the Owner applies it (applyPlanChanges with the request) or declines it; the Editor
 * can withdraw it while it is pending. Server-side only, with the caller's own session (RLS
 * applies; the change_requests policies are the backstop for every write here).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { canApplyFromChat, describeChange, validateChange, type PlanChange } from './chatEdits'
import { loadPlanSnapshot } from './planChangeStore'

export type RequestStatus = 'pending' | 'applied' | 'declined' | 'withdrawn' | 'undone'

export interface ChangeRequestRow {
  id: string
  school_id: string
  requested_by: string
  requester_name: string
  changes: PlanChange[]
  summary: { label: string; before: string; after: string }[]
  note: string
  status: RequestStatus
  decline_reason: string
  plan_change_id: string | null
  owner_read_at: string | null
  created_at: string
  resolved_at: string | null
}

/** Longest note or decline reason kept. */
export const MAX_NOTE_LENGTH = 1000

export type StoreOutcome<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string }

const clean = (text: unknown) => (typeof text === 'string' ? text.trim().slice(0, MAX_NOTE_LENGTH) : '')

/** File a pending request for the Owner. The changes must be ones an Owner could apply today. */
export async function createChangeRequest(
  supabase: SupabaseClient,
  schoolId: string,
  user: { id: string; email: string | null },
  changes: PlanChange[],
  note: unknown,
): Promise<StoreOutcome<{ id: string }>> {
  if (!canApplyFromChat(changes)) {
    return { ok: false, status: 400, error: 'Only staffing, operations and grade plan changes can be sent to the Owner.' }
  }
  const snapshot = await loadPlanSnapshot(supabase, schoolId)
  if (!snapshot) return { ok: false, status: 500, error: 'Could not read the school plan.' }
  const invalid = changes.map((c) => validateChange(c, snapshot)).find((e) => e)
  if (invalid) return { ok: false, status: 409, error: `This change no longer fits the plan: ${invalid}` }

  const { data: roleRows } = await supabase
    .from('user_roles').select('display_name').eq('user_id', user.id).eq('school_id', schoolId)
  const name = (roleRows ?? []).map((r) => (r.display_name as string | null)?.trim()).find((n) => n) || user.email || 'A team member'

  const { data, error } = await supabase
    .from('change_requests')
    .insert({
      school_id: schoolId,
      requested_by: user.id,
      requester_name: name,
      changes,
      summary: changes.flatMap((c) => describeChange(c, snapshot)),
      note: clean(note),
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, status: 500, error: error?.message ?? 'Could not send the request.' }
  return { ok: true, id: data.id as string }
}

/** The pending request `id` at the school, or an outcome explaining why it can't be acted on. */
export async function loadPendingRequest(supabase: SupabaseClient, schoolId: string, id: string): Promise<StoreOutcome<{ request: ChangeRequestRow }>> {
  const { data, error } = await supabase.from('change_requests').select('*').eq('id', id).eq('school_id', schoolId).maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!data) return { ok: false, status: 404, error: 'Request not found.' }
  const request = data as ChangeRequestRow
  if (request.status !== 'pending') return { ok: false, status: 409, error: `This request was already ${request.status}.` }
  return { ok: true, request }
}

async function resolve(
  supabase: SupabaseClient,
  schoolId: string,
  id: string,
  fields: Record<string, unknown>,
  extraFilter?: { column: string; value: string },
): Promise<StoreOutcome> {
  let query = supabase.from('change_requests').update(fields).eq('id', id).eq('school_id', schoolId).eq('status', 'pending')
  if (extraFilter) query = query.eq(extraFilter.column, extraFilter.value)
  const { data, error } = await query.select('id')
  if (error) return { ok: false, status: 500, error: error.message }
  // Zero rows: gone, already resolved, or not this caller's to change (RLS).
  if (!data || data.length === 0) return { ok: false, status: 409, error: 'This request is no longer pending.' }
  return { ok: true }
}

/** Owner: decline a pending request, with an optional reason the Editor sees. */
export function declineChangeRequest(supabase: SupabaseClient, schoolId: string, userId: string, id: string, reason: unknown): Promise<StoreOutcome> {
  const now = new Date().toISOString()
  return resolve(supabase, schoolId, id, {
    status: 'declined', decline_reason: clean(reason), resolved_at: now, resolved_by: userId, owner_read_at: now,
  })
}

/** Requester: withdraw their own pending request. */
export function withdrawChangeRequest(supabase: SupabaseClient, schoolId: string, userId: string, id: string): Promise<StoreOutcome> {
  return resolve(supabase, schoolId, id, { status: 'withdrawn', resolved_at: new Date().toISOString(), resolved_by: userId }, { column: 'requested_by', value: userId })
}

/** Owner: mark every unread pending request at the school read (opening the Inbox). */
export async function markRequestsRead(supabase: SupabaseClient, schoolId: string): Promise<StoreOutcome> {
  const { error } = await supabase
    .from('change_requests').update({ owner_read_at: new Date().toISOString() })
    .eq('school_id', schoolId).eq('status', 'pending').is('owner_read_at', null)
  return error ? { ok: false, status: 500, error: error.message } : { ok: true }
}

/** Owner: record that a pending request was applied as plan change `planChangeId`. */
export function markRequestApplied(supabase: SupabaseClient, schoolId: string, userId: string, id: string, planChangeId: string): Promise<StoreOutcome> {
  const now = new Date().toISOString()
  return resolve(supabase, schoolId, id, {
    status: 'applied', plan_change_id: planChangeId, resolved_at: now, resolved_by: userId, owner_read_at: now,
  })
}

/** Owner: a plan change that came from a request was undone; the request says so too. */
export async function markRequestUndone(supabase: SupabaseClient, schoolId: string, planChangeId: string): Promise<void> {
  await supabase.from('change_requests').update({ status: 'undone' })
    .eq('school_id', schoolId).eq('plan_change_id', planChangeId).eq('status', 'applied')
}
