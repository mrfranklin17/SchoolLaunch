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

  // A single DELETE statement is atomic: on error nothing was removed.
  const { error: deleteError } = await supabase.from(table).delete().eq('school_id', schoolId)
  if (deleteError) return { ok: false, message: deleteError.message, previousDataIntact: true }

  if (rows.length === 0) return { ok: true }

  const { error: insertError } = await supabase.from(table).insert(rows)
  if (!insertError) return { ok: true }

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
