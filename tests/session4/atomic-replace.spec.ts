import { test, expect } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  replaceStaffingPositions,
  replaceGradeExpansionPlan,
  replaceFailureMessage,
} from '../../src/lib/atomicReplace'

/**
 * Phase 1 data safety — atomic replace of a school's staffing_positions /
 * grade_expansion_plan rows (src/lib/atomicReplace.ts).
 *
 * The old save paths deleted every row and then inserted the new set in a separate
 * request, so a failed insert wiped the school's data. These tests drive the helper
 * against an in-memory fake Supabase client and assert that no failure path loses
 * the previously saved rows:
 *   - RPC path (migration applied): success replaces; any RPC error leaves data as-is
 *   - Fallback path (PGRST202 / 42883 — migration not applied): snapshot -> delete ->
 *     insert, restoring the snapshot if the insert is rejected. A lost response (status 0)
 *     is checked against the row count first, so a write that actually committed is never
 *     "restored" into duplicates.
 *
 * Run with: npx playwright test tests/session4/atomic-replace.spec.ts
 */

type Row = Record<string, unknown>
type Err = { code: string; message: string; status: number } | null

/** Outcome of one write call. `commit: true` with an error = the write landed but the response was lost. */
interface WriteOutcome { error: Err; commit?: boolean }

interface FakeOptions {
  rpc?: 'ok' | Err
  selectError?: Err
  countError?: Err
  deleteOutcome?: WriteOutcome
  /** Outcomes of successive insert() calls (first = new rows, second = restore). */
  inserts?: WriteOutcome[]
}

const SCHOOL = '00000000-0000-0000-0000-0000000000aa'
const OTHER_SCHOOL = '00000000-0000-0000-0000-0000000000bb'

function makeFake(initial: Record<string, Row[]>, opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
  )
  const calls: string[] = []
  const inserts = [...(opts.inserts ?? [])]
  const statusOf = (error: Err, ok: number) => (error ? error.status : ok)

  const client = {
    rpc(name: string, params: { p_school_id: string; p_rows: Row[] }) {
      calls.push(`rpc:${name}`)
      const outcome = opts.rpc ?? 'ok'
      if (outcome !== 'ok') return Promise.resolve({ data: null, error: outcome })
      const table = name === 'replace_staffing_positions' ? 'staffing_positions' : 'grade_expansion_plan'
      tables[table] = [
        ...tables[table].filter((r) => r.school_id !== params.p_school_id),
        ...params.p_rows.map((r) => ({ ...r, school_id: params.p_school_id })),
      ]
      return Promise.resolve({ data: null, error: null })
    },
    from(table: string) {
      return {
        select(_cols: string, selectOpts?: { count?: string; head?: boolean }) {
          return {
            eq(_col: string, schoolId: string) {
              const mine = tables[table].filter((r) => r.school_id === schoolId)
              if (selectOpts?.head) {
                calls.push(`count:${table}`)
                if (opts.countError) return Promise.resolve({ data: null, count: null, error: opts.countError, status: opts.countError.status })
                return Promise.resolve({ data: null, count: mine.length, error: null, status: 200 })
              }
              calls.push(`select:${table}`)
              if (opts.selectError) return Promise.resolve({ data: null, error: opts.selectError, status: opts.selectError.status })
              return Promise.resolve({ data: mine.map((r) => ({ ...r })), error: null, status: 200 })
            },
          }
        },
        delete() {
          return {
            eq(_col: string, schoolId: string) {
              calls.push(`delete:${table}`)
              const { error, commit } = opts.deleteOutcome ?? { error: null }
              if (!error || commit) tables[table] = tables[table].filter((r) => r.school_id !== schoolId)
              return Promise.resolve({ error, status: statusOf(error, 204) })
            },
          }
        },
        insert(rows: Row[]) {
          calls.push(`insert:${table}:${rows.length}`)
          const { error, commit } = inserts.shift() ?? { error: null }
          if (!error || commit) tables[table] = [...tables[table], ...rows.map((r) => ({ ...r }))]
          return Promise.resolve({ error, status: statusOf(error, 201) })
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, tables, calls }
}

const MISSING_FN: Err = { code: 'PGRST202', message: 'Could not find the function public.replace_staffing_positions', status: 404 }
const RLS_DENIED: Err = { code: '42501', message: 'new row violates row-level security policy', status: 403 }
const BAD_VALUE: Err = { code: '22P02', message: 'invalid input syntax for type numeric', status: 400 }
// What postgrest-js returns when fetch rejects (connection dropped): status 0, empty code.
const NETWORK: Err = { code: '', message: 'TypeError: fetch failed', status: 0 }

const oldStaff: Row[] = [
  { id: 'a', school_id: SCHOOL, year: 1, title: 'Principal', fte: 1 },
  { id: 'b', school_id: SCHOOL, year: 1, title: 'Teacher', fte: 6 },
]
const otherSchoolStaff: Row[] = [{ id: 'z', school_id: OTHER_SCHOOL, year: 1, title: 'CEO', fte: 1 }]
const newStaff: Row[] = [
  { school_id: SCHOOL, year: 1, title: 'Principal', fte: 1 },
  { school_id: SCHOOL, year: 1, title: 'Teacher', fte: 7 },
  { school_id: SCHOOL, year: 1, title: 'Paraeducator', fte: 2 },
]

function staffFor(tables: Record<string, Row[]>, schoolId: string) {
  return tables.staffing_positions.filter((r) => r.school_id === schoolId)
}

test.describe('Phase 1 — atomic replace of school rows', () => {
  test('RPC path: success replaces rows and never touches the fallback', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff, ...otherSchoolStaff] })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(['rpc:replace_staffing_positions'])
    expect(staffFor(tables, SCHOOL).map((r) => r.title)).toEqual(['Principal', 'Teacher', 'Paraeducator'])
    expect(staffFor(tables, OTHER_SCHOOL)).toEqual(otherSchoolStaff)
  })

  test('RPC path: an RPC error (e.g. RLS) reports failure, keeps data, and does not fall back', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: RLS_DENIED })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: RLS_DENIED!.message, previousDataIntact: true })
    expect(calls).toEqual(['rpc:replace_staffing_positions'])
    expect(staffFor(tables, SCHOOL)).toEqual(oldStaff)
  })

  test('grade plan uses its own RPC', async () => {
    const { client, calls } = makeFake({ grade_expansion_plan: [] })
    const result = await replaceGradeExpansionPlan(client, SCHOOL, [{ school_id: SCHOOL, year: 1, grade_level: 'K', sections: 2, students_per_section: 24, is_new_grade: true }])
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['rpc:replace_grade_expansion_plan'])
  })

  test('fallback (PGRST202): replaces rows via snapshot -> delete -> insert', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff, ...otherSchoolStaff] }, { rpc: MISSING_FN })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      'rpc:replace_staffing_positions',
      'select:staffing_positions',
      'delete:staffing_positions',
      'insert:staffing_positions:3',
    ])
    expect(staffFor(tables, SCHOOL).map((r) => r.fte)).toEqual([1, 7, 2])
    expect(staffFor(tables, OTHER_SCHOOL)).toEqual(otherSchoolStaff)
  })

  test('fallback also triggers on Postgres undefined_function (42883)', async () => {
    const { client, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: { code: '42883', message: 'function does not exist', status: 404 } })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result.ok).toBe(true)
    expect(calls).toContain('delete:staffing_positions')
  })

  test('fallback: a rejected insert restores the previous rows (the original data-loss bug)', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, inserts: [{ error: BAD_VALUE }] })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: BAD_VALUE!.message, previousDataIntact: true })
    expect(calls).toEqual([
      'rpc:replace_staffing_positions',
      'select:staffing_positions',
      'delete:staffing_positions',
      'insert:staffing_positions:3',
      'insert:staffing_positions:2',
    ])
    expect(staffFor(tables, SCHOOL)).toEqual(oldStaff)
  })

  test('fallback: if the restore also fails, the result says the old data is not intact', async () => {
    const { client, tables } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, inserts: [{ error: BAD_VALUE }, { error: BAD_VALUE }] })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: BAD_VALUE!.message, previousDataIntact: false })
    expect(staffFor(tables, SCHOOL)).toEqual([])
  })

  test('fallback: insert committed but its response was lost -> reported saved, no duplicate restore', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, inserts: [{ error: NETWORK, commit: true }] })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      'rpc:replace_staffing_positions',
      'select:staffing_positions',
      'delete:staffing_positions',
      'insert:staffing_positions:3',
      'count:staffing_positions',
    ])
    expect(staffFor(tables, SCHOOL).map((r) => r.title)).toEqual(['Principal', 'Teacher', 'Paraeducator'])
  })

  test('fallback: network failure on insert that did not land -> snapshot restored', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, inserts: [{ error: NETWORK }] })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: NETWORK!.message, previousDataIntact: true })
    expect(calls.slice(-2)).toEqual(['count:staffing_positions', 'insert:staffing_positions:2'])
    expect(staffFor(tables, SCHOOL)).toEqual(oldStaff)
  })

  test('fallback: network failure on insert and the outcome cannot be checked -> no restore, not intact', async () => {
    const { client, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, inserts: [{ error: NETWORK, commit: true }], countError: NETWORK })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: NETWORK!.message, previousDataIntact: false })
    expect(calls.filter((c) => c.startsWith('insert:'))).toEqual(['insert:staffing_positions:3'])
  })

  test('fallback: delete committed but its response was lost -> continues and saves', async () => {
    const { client, tables } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, deleteOutcome: { error: NETWORK, commit: true } })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: true })
    expect(staffFor(tables, SCHOOL).map((r) => r.title)).toEqual(['Principal', 'Teacher', 'Paraeducator'])
  })

  test('fallback: network failure on a delete that did not land -> stops, data intact', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, deleteOutcome: { error: NETWORK } })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: NETWORK!.message, previousDataIntact: true })
    expect(calls.some((c) => c.startsWith('insert:'))).toBe(false)
    expect(staffFor(tables, SCHOOL)).toEqual(oldStaff)
  })

  test('fallback: a failed snapshot read aborts before deleting anything', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, selectError: NETWORK })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: NETWORK!.message, previousDataIntact: true })
    expect(calls).not.toContain('delete:staffing_positions')
    expect(staffFor(tables, SCHOOL)).toEqual(oldStaff)
  })

  test('fallback: a failed delete aborts before inserting', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN, deleteOutcome: { error: RLS_DENIED } })
    const result = await replaceStaffingPositions(client, SCHOOL, newStaff)
    expect(result).toEqual({ ok: false, message: RLS_DENIED!.message, previousDataIntact: true })
    expect(calls.some((c) => c.startsWith('insert:'))).toBe(false)
    expect(staffFor(tables, SCHOOL)).toEqual(oldStaff)
  })

  test('fallback: replacing with an empty set deletes and skips the insert', async () => {
    const { client, tables, calls } = makeFake({ staffing_positions: [...oldStaff] }, { rpc: MISSING_FN })
    const result = await replaceStaffingPositions(client, SCHOOL, [])
    expect(result).toEqual({ ok: true })
    expect(calls.some((c) => c.startsWith('insert:'))).toBe(false)
    expect(staffFor(tables, SCHOOL)).toEqual([])
  })

  test('failure copy distinguishes intact vs. lost previous data', () => {
    expect(replaceFailureMessage('staffing', { ok: false, message: 'boom', previousDataIntact: true }))
      .toBe('Save failed — your previously saved staffing is unchanged. boom')
    expect(replaceFailureMessage('staffing', { ok: false, message: 'boom', previousDataIntact: false }))
      .toBe('Save failed and your previously saved staffing could not be restored. Keep this page open and click Save again. boom')
  })
})
