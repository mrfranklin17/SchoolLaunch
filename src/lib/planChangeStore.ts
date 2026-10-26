/**
 * Phase 6b: reading and writing the plan for changes applied from chat. Server-side only
 * (the /api/plan-changes routes), always with the caller's own Supabase session, so RLS
 * applies to every read and write.
 *
 * Writes go through the same paths the editor tabs use: the transactional replace RPCs for
 * staffing and the grade plan (atomicReplace.ts), and the Operations tab's row update/insert
 * plus its rate in financial_assumptions. A multi-part change writes its parts in turn and,
 * if a later part fails, puts the earlier parts back.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BudgetProjection, GradeExpansionEntry, SchoolProfile, StaffingPosition } from './types'
import { replaceGradeExpansionPlan, replaceStaffingPositions } from './atomicReplace'
import {
  applyChanges,
  canApplyFromChat,
  describeChange,
  planState,
  scopeOfChanges,
  scopeOfState,
  statesMatch,
  validateChange,
  type ChangeLine,
  type OperationsState,
  type PlanChange,
  type PlanSnapshot,
  type PlanState,
} from './chatEdits'

/**
 * The school's saved plan, as useSchoolData loads it (Year 1 budget rows). Null when any part
 * cannot be read.
 */
export async function loadPlanSnapshot(supabase: SupabaseClient, schoolId: string): Promise<PlanSnapshot | null> {
  const [profileRes, posRes, projRes, gepRes] = await Promise.all([
    supabase.from('school_profiles').select('*').eq('school_id', schoolId).maybeSingle(),
    supabase.from('staffing_positions').select('*').eq('school_id', schoolId).order('year'),
    supabase.from('budget_projections').select('*').eq('school_id', schoolId).eq('year', 1),
    supabase.from('grade_expansion_plan').select('*').eq('school_id', schoolId).order('year').order('grade_level'),
  ])
  if (profileRes.error || !profileRes.data || posRes.error || projRes.error || gepRes.error) return null
  return {
    profile: profileRes.data as SchoolProfile,
    allPositions: (posRes.data ?? []) as StaffingPosition[],
    projections: (projRes.data ?? []) as BudgetProjection[],
    gradeExpansionPlan: (gepRes.data ?? []) as GradeExpansionEntry[],
  }
}

type StepResult = { ok: true } | { ok: false; message: string }

async function writeOperations(supabase: SupabaseClient, schoolId: string, ops: OperationsState): Promise<StepResult> {
  for (const [line, amount] of Object.entries(ops.lines)) {
    // As the Operations tab saves: update the school's Year 1 row for the line, or add one.
    const { data: existing, error: readError } = await supabase
      .from('budget_projections').select('id')
      .eq('school_id', schoolId).eq('year', 1).eq('subcategory', line).eq('is_revenue', false)
    if (readError) return { ok: false, message: readError.message }
    const { error } = existing && existing.length > 0
      ? await supabase.from('budget_projections').update({ amount })
        .eq('school_id', schoolId).eq('year', 1).eq('subcategory', line).eq('is_revenue', false)
      : await supabase.from('budget_projections').insert({ school_id: schoolId, year: 1, category: 'Operations', subcategory: line, amount, is_revenue: false })
    if (error) return { ok: false, message: error.message }
  }
  if (Object.keys(ops.rates).length === 0) return { ok: true }
  const { data: profile, error: readError } = await supabase
    .from('school_profiles').select('financial_assumptions').eq('school_id', schoolId).maybeSingle()
  if (readError || !profile) return { ok: false, message: readError?.message ?? 'School profile not found.' }
  const merged: Record<string, unknown> = { ...((profile.financial_assumptions as Record<string, unknown> | null) ?? {}) }
  for (const [key, value] of Object.entries(ops.rates)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  const { error } = await supabase.from('school_profiles').update({ financial_assumptions: merged }).eq('school_id', schoolId)
  return error ? { ok: false, message: error.message } : { ok: true }
}

function writePart(supabase: SupabaseClient, schoolId: string, part: keyof PlanState, state: PlanState): Promise<StepResult> {
  switch (part) {
    case 'staffing': return replaceStaffingPositions(supabase, schoolId, state.staffing ?? [])
    case 'gradePlan': return replaceGradeExpansionPlan(supabase, schoolId, state.gradePlan ?? [])
    case 'operations': return writeOperations(supabase, schoolId, state.operations ?? { lines: {}, rates: {} })
  }
}

export type WriteResult = { ok: true } | { ok: false; message: string; previousDataIntact: boolean }

/**
 * Write `target` over the saved plan. `current` is what the plan holds now (same parts); if a
 * part fails, the parts already written are put back to it.
 */
export async function writePlanState(supabase: SupabaseClient, schoolId: string, target: PlanState, current: PlanState): Promise<WriteResult> {
  const parts = (['staffing', 'gradePlan', 'operations'] as const).filter((p) => target[p] !== undefined)
  const written: (keyof PlanState)[] = []
  for (const part of parts) {
    const result = await writePart(supabase, schoolId, part, target)
    if (!result.ok) {
      let intact = !('previousDataIntact' in result) || result.previousDataIntact !== false
      for (const done of written.reverse()) {
        const restored = await writePart(supabase, schoolId, done, current)
        if (!restored.ok) intact = false
      }
      return { ok: false, message: result.message, previousDataIntact: intact }
    }
    written.push(part)
  }
  return { ok: true }
}

export type ApplyOutcome =
  | { ok: true; changeId: string; lines: ChangeLine[] }
  | { ok: false; status: number; error: string }

/**
 * Apply proposed changes to the live plan and log them. `expected` is what the founder saw
 * and confirmed (the card's before → after lines); if the saved plan no longer reads the same,
 * nothing is written.
 */
export async function applyPlanChanges(
  supabase: SupabaseClient,
  schoolId: string,
  userId: string,
  changes: PlanChange[],
  expected: ChangeLine[],
): Promise<ApplyOutcome> {
  if (!canApplyFromChat(changes)) {
    return { ok: false, status: 400, error: 'Only staffing, operations and grade plan changes can be applied from chat.' }
  }
  const snapshot = await loadPlanSnapshot(supabase, schoolId)
  if (!snapshot) return { ok: false, status: 500, error: 'Could not read the school plan.' }
  const invalid = changes.map((c) => validateChange(c, snapshot)).find((e) => e)
  if (invalid) return { ok: false, status: 409, error: `This change no longer fits the plan: ${invalid}` }
  const lines = changes.flatMap((c) => describeChange(c, snapshot))
  if (JSON.stringify(lines) !== JSON.stringify(expected)) {
    return { ok: false, status: 409, error: 'The plan changed since this preview, so nothing was applied. Ask again for a fresh preview.' }
  }

  const scope = scopeOfChanges(changes)
  const before = planState(snapshot, scope)
  const after = planState(applyChanges(snapshot, changes), scope)
  const written = await writePlanState(supabase, schoolId, after, before)
  if (!written.ok) {
    return {
      ok: false,
      status: 500,
      error: written.previousDataIntact
        ? `Nothing was changed: ${written.message}`
        : `The change failed partway and the plan could not be fully restored. Check the Staffing, Operations and Settings tabs. ${written.message}`,
    }
  }

  const { data: logged, error: logError } = await supabase
    .from('plan_changes')
    .insert({ school_id: schoolId, applied_by: userId, source: 'chat', changes, summary: lines, before_state: before, after_state: after })
    .select('id')
    .single()
  if (logError || !logged) {
    // A change without a log entry could not be undone: put the plan back.
    const restored = await writePlanState(supabase, schoolId, before, after)
    return {
      ok: false,
      status: 500,
      error: restored.ok
        ? `Nothing was changed: the change could not be recorded. ${logError?.message ?? ''}`.trim()
        : 'The change was saved but could not be recorded or reversed. Check the Staffing, Operations and Settings tabs.',
    }
  }
  return { ok: true, changeId: logged.id as string, lines }
}

export type UndoOutcome = { ok: true } | { ok: false; status: number; error: string }

/** Put back what a logged change replaced, if the plan still holds what it left. */
export async function undoPlanChange(supabase: SupabaseClient, schoolId: string, userId: string, changeId: string): Promise<UndoOutcome> {
  const { data: row, error } = await supabase
    .from('plan_changes').select('id, before_state, after_state, undone_at')
    .eq('id', changeId).eq('school_id', schoolId).maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!row) return { ok: false, status: 404, error: 'Change not found.' }
  if (row.undone_at) return { ok: false, status: 409, error: 'This change was already undone.' }

  const after = row.after_state as PlanState
  const before = row.before_state as PlanState
  const snapshot = await loadPlanSnapshot(supabase, schoolId)
  if (!snapshot) return { ok: false, status: 500, error: 'Could not read the school plan.' }
  if (!statesMatch(planState(snapshot, scopeOfState(after)), after)) {
    return { ok: false, status: 409, error: 'The plan has been edited since this change, so undoing it would overwrite those edits. Make the change on the tab instead.' }
  }

  const written = await writePlanState(supabase, schoolId, before, after)
  if (!written.ok) return { ok: false, status: 500, error: `Undo failed: ${written.message}` }
  const { error: markError } = await supabase
    .from('plan_changes').update({ undone_at: new Date().toISOString(), undone_by: userId }).eq('id', changeId)
  if (markError) {
    await writePlanState(supabase, schoolId, after, before)
    return { ok: false, status: 500, error: `Undo failed: ${markError.message}` }
  }
  return { ok: true }
}
