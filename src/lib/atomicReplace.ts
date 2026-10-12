import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

/**
 * Replace every row a school owns in staffing_positions / grade_expansion_plan.
 *
 * The old save paths issued DELETE then INSERT as two separate requests; a failed
 * INSERT left the school with zero rows (Phase 1 data-safety fix). The primary path
 * here is one RPC that does both inside a single transaction
 * (supabase/migrations/20261012120000_p1_atomic_replace_rpcs.sql). If that migration
 * has not been applied yet, PostgREST reports the function as missing and we fall
 * back to delete -> insert, restoring a snapshot of the previous rows if the insert
 * fails. Either way a failed save never silently wipes the school's data.
 */

export type ReplaceResult =
  | { ok: true }
  | {
      ok: false
      message: string
      /** False only when the old rows were deleted and could not be restored. */
      previousDataIntact: boolean
    }

type ReplaceTable = 'staffing_positions' | 'grade_expansion_plan'

const RPC_FOR_TABLE: Record<ReplaceTable, string> = {
  staffing_positions: 'replace_staffing_positions',
  grade_expansion_plan: 'replace_grade_expansion_plan',
}

// PGRST202: function not in PostgREST's schema cache. 42883: Postgres undefined_function.
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883'])

function isMissingFunction(error: PostgrestError): boolean {
  return MISSING_FUNCTION_CODES.has(error.code)
}

// postgrest-js reports a rejected fetch (connection dropped, offline) as status 0 with an
// empty code. The request may still have committed server-side, so its outcome is unknown —
// unlike a PostgREST rejection, which carries an HTTP status >= 400 and an error code.
function isTransportFailure(status: number, error: PostgrestError): boolean {
  return status === 0 || !error.code
}

/** Number of rows the school currently has in `table`, or null if it can't be read. */
async function countSchoolRows(supabase: SupabaseClient, table: ReplaceTable, schoolId: string): Promise<number | null> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('school_id', schoolId)
  return error ? null : count ?? 0
}

async function replaceSchoolRows(
  supabase: SupabaseClient,
  table: ReplaceTable,
  schoolId: string,
  rows: Record<string, unknown>[],
): Promise<ReplaceResult> {
  const { error: rpcError } = await supabase.rpc(RPC_FOR_TABLE[table], {
    p_school_id: schoolId,
    p_rows: rows,
  })
  if (!rpcError) return { ok: true }
  if (!isMissingFunction(rpcError)) {
    // The RPC runs in one transaction, so a failure rolled back the delete too.
    return { ok: false, message: rpcError.message, previousDataIntact: true }
  }
  return replaceWithRestore(supabase, table, schoolId, rows)
}

async function replaceWithRestore(
  supabase: SupabaseClient,
  table: ReplaceTable,
  schoolId: string,
  rows: Record<string, unknown>[],
): Promise<ReplaceResult> {
  const { data: snapshot, error: readError } = await supabase.from(table).select('*').eq('school_id', schoolId)
  if (readError) return { ok: false, message: readError.message, previousDataIntact: true }

  // A single DELETE statement is atomic: a rejected delete removed nothing.
  const { error: deleteError, status: deleteStatus } = await supabase.from(table).delete().eq('school_id', schoolId)
  if (deleteError) {
    if (!isTransportFailure(deleteStatus, deleteError)) {
      return { ok: false, message: deleteError.message, previousDataIntact: true }
    }
    // Response lost: carry on only if the delete is confirmed to have committed.
    const remaining = await countSchoolRows(supabase, table, schoolId)
    if (remaining === null) return { ok: false, message: deleteError.message, previousDataIntact: false }
    if (remaining > 0) return { ok: false, message: deleteError.message, previousDataIntact: true }
  }

  if (rows.length === 0) return { ok: true }

  const { error: insertError, status: insertStatus } = await supabase.from(table).insert(rows)
  if (!insertError) return { ok: true }

  if (isTransportFailure(insertStatus, insertError)) {
    // The school's rows were just deleted and a bulk INSERT is atomic, so any rows present now
    // are the new set — restoring the snapshot on top of them would duplicate every row.
    const present = await countSchoolRows(supabase, table, schoolId)
    if (present === null) return { ok: false, message: insertError.message, previousDataIntact: false }
    if (present > 0) return { ok: true }
  }

  if (snapshot && snapshot.length > 0) {
    const { error: restoreError } = await supabase.from(table).insert(snapshot)
    if (restoreError) {
      console.error(`[atomicReplace] restore of ${table} failed after insert error:`, restoreError)
      return { ok: false, message: insertError.message, previousDataIntact: false }
    }
  }
  return { ok: false, message: insertError.message, previousDataIntact: true }
}

export function replaceStaffingPositions(
  supabase: SupabaseClient,
  schoolId: string,
  rows: Record<string, unknown>[],
): Promise<ReplaceResult> {
  return replaceSchoolRows(supabase, 'staffing_positions', schoolId, rows)
}

export function replaceGradeExpansionPlan(
  supabase: SupabaseClient,
  schoolId: string,
  rows: Record<string, unknown>[],
): Promise<ReplaceResult> {
  return replaceSchoolRows(supabase, 'grade_expansion_plan', schoolId, rows)
}

/** Founder-facing toast copy for a failed replace. */
export function replaceFailureMessage(what: string, result: Extract<ReplaceResult, { ok: false }>): string {
  return result.previousDataIntact
    ? `Save failed — your previously saved ${what} is unchanged. ${result.message}`
    : `Save failed and your previously saved ${what} could not be restored. Keep this page open and click Save again. ${result.message}`
}
