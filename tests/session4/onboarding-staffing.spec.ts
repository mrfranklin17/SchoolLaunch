import { test, expect } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildWaOnboardingSeed,
  buildConfigOnboardingSeed,
  teacherSectionsByBand,
  gradeBand,
  gradesInConfig,
} from '../../src/lib/staffingDefaults'
import {
  onboardingStaffingRows,
  mergeYearOneStaffing,
  replaceYearOneStaffing,
  type StoredStaffingRow,
} from '../../src/lib/onboardingStaffing'
import { resolvePositionType, savedCustomClassification, getClassification } from '../../src/lib/positionTypes'
import { getCommissionPosition } from '../../src/lib/types'

/**
 * Onboarding staffing (pure logic, no browser/network):
 * - P-UX-13: the Staffing step's seed has one classroom-teacher row per grade band in the
 *   opening grades (no elementary teacher for a 6-12 school; high-school teachers for 9-12).
 * - P-UX-24 / P4-FU-02: Step 4 and /api/onboarding/complete write fully typed Year-1 rows and
 *   replace them through the atomic replace with Years 2-5 written back unchanged.
 *
 * Run with: npx playwright test tests/session4/onboarding-staffing.spec.ts
 */

const SCHOOL = '00000000-0000-0000-0000-000000000001'
const TEACHER_TYPES = ['teacher_elem', 'teacher_ms', 'teacher_hs']

function teacherRows<T extends { positionType: string }>(seed: T[]): T[] {
  return seed.filter((p) => TEACHER_TYPES.includes(p.positionType))
}

test.describe('P-UX-13 — grade-aware onboarding staffing seed', () => {
  test('grade bands and grade-config parsing', () => {
    expect(gradeBand('K')).toBe('elem')
    expect(gradeBand('5')).toBe('elem')
    expect(gradeBand('6')).toBe('ms')
    expect(gradeBand('8')).toBe('ms')
    expect(gradeBand('9')).toBe('hs')
    expect(gradeBand('12')).toBe('hs')
    expect(gradeBand('PK')).toBeNull()
    expect(gradesInConfig('6-12')).toEqual(['6', '7', '8', '9', '10', '11', '12'])
    expect(gradesInConfig('K')).toEqual(['K'])
    expect(gradesInConfig('nonsense')).toEqual([])
  })

  test('a 6-12 school is never seeded an elementary teacher (the Cedar Grove case)', () => {
    // Opening grades unknown: falls back to the grade-config label.
    const byConfig = buildWaOnboardingSeed({ enrollment: 200, maxClassSize: 25, pctIep: 12, gradeConfig: '6-12' })
    const teachers = teacherRows(byConfig)
    expect(teachers.map((t) => t.positionType)).toEqual(['teacher_ms', 'teacher_hs'])
    expect(teachers.reduce((s, t) => s + t.fte, 0)).toBe(8) // ceil(200/25) split 3:4 by grade count
    expect(byConfig.some((p) => p.positionType === 'teacher_elem')).toBe(false)

    // Opening grades 6 and 9 of a 6-12 build-out.
    const byOpening = buildWaOnboardingSeed({ enrollment: 100, maxClassSize: 25, pctIep: 12, gradeConfig: '6-12', openingGrades: ['6', '9'] })
    expect(teacherRows(byOpening).map((t) => [t.positionType, t.fte])).toEqual([['teacher_ms', 2], ['teacher_hs', 2]])
  })

  test('a 9-12 school gets high-school teachers; a K-5 school only elementary', () => {
    const hs = buildWaOnboardingSeed({ enrollment: 120, maxClassSize: 24, pctIep: 10, gradeConfig: '9-12', openingGrades: ['9', '10'] })
    expect(teacherRows(hs).map((t) => t.positionType)).toEqual(['teacher_hs'])
    expect(teacherRows(hs)[0].title).toBe(getCommissionPosition('teacher_hs')!.name)
    expect(teacherRows(hs)[0].salary).toBe(getCommissionPosition('teacher_hs')!.salary)

    const elem = buildWaOnboardingSeed({ enrollment: 120, maxClassSize: 24, pctIep: 10, gradeConfig: 'K-5', openingGrades: ['K', '1'], sectionsY1: 6 })
    expect(teacherRows(elem).map((t) => [t.positionType, t.fte])).toEqual([['teacher_elem', 6]])
  })

  test('the rest of the WA roster is unchanged and fully typed', () => {
    const seed = buildWaOnboardingSeed({ enrollment: 120, maxClassSize: 24, pctIep: 12, openingGrades: ['K', '1', '6'] })
    expect(seed.map((p) => p.positionType)).toEqual([
      'ceo_director', 'principal', 'teacher_elem', 'teacher_ms', 'sped_teacher', 'office_mgr', 'paraeducator',
    ])
    for (const p of seed) {
      expect(p.salary, p.positionType).toBe(getCommissionPosition(p.positionType)!.salary)
      expect(p.classification, p.positionType).toBe(getClassification(p.positionType))
    }
    expect(seed.find((p) => p.positionType === 'paraeducator')!.fte).toBe(2) // ceil(120*12%/10)
  })

  test('Year-1 expansion plan rows give exact sections per band', () => {
    const plan = [
      { year: 1, grade_level: 'K', sections: 2 },
      { year: 1, grade_level: '1', sections: 2 },
      { year: 1, grade_level: '6', sections: 3 },
      { year: 2, grade_level: '9', sections: 4 }, // not Year 1
    ]
    expect(teacherSectionsByBand({ expansionPlan: plan, openingGrades: ['K'], totalSections: 99 })).toEqual([
      { band: 'elem', sections: 4 },
      { band: 'ms', sections: 3 },
    ])
  })

  test('without a plan, sections split by grade count and add up to the total', () => {
    const split = teacherSectionsByBand({ openingGrades: ['K', '1', '2', '6'], totalSections: 7 })
    expect(split).toEqual([{ band: 'elem', sections: 5 }, { band: 'ms', sections: 2 }])
    // Each band present gets at least one section, even past the total.
    expect(teacherSectionsByBand({ openingGrades: ['K', '1', '2', '3', '4', '9'], totalSections: 2 })).toEqual([
      { band: 'elem', sections: 2 },
      { band: 'hs', sections: 1 },
    ])
    // No grade information at all: the old elementary default.
    expect(teacherSectionsByBand({ totalSections: 5 })).toEqual([{ band: 'elem', sections: 5 }])
    expect(teacherSectionsByBand({ openingGrades: ['6'], totalSections: 0 })).toEqual([{ band: 'ms', sections: 0 }])
  })

  test('generic pathways seed only the band teacher types the school opens with', () => {
    const seed = buildConfigOnboardingSeed('generic_charter', { enrollment: 96, maxClassSize: 24, pctIep: 10, openingGrades: ['6', '7'] })
    expect(teacherRows(seed).map((t) => [t.positionType, t.fte])).toEqual([['teacher_ms', 4]])
    // Non-band roles are still seeded.
    expect(seed.some((p) => p.positionType === 'sped_teacher')).toBe(true)
    // Before P-UX-13 all three band teacher types were seeded at the full section count.
    const k12 = buildConfigOnboardingSeed('generic_charter', { enrollment: 96, maxClassSize: 24, pctIep: 10, openingGrades: ['K', '6', '9'] })
    expect(teacherRows(k12).reduce((s, t) => s + t.fte, 0)).toBe(4)
  })
})

test.describe('P-UX-24 / P4-FU-02 — typed Year-1 onboarding rows', () => {
  test('seeded positions are written typed, never as untyped (custom, 24) rows', () => {
    const seed = buildWaOnboardingSeed({ enrollment: 120, maxClassSize: 24, pctIep: 12, openingGrades: ['K', '6'] })
    const rows = onboardingStaffingRows(SCHOOL, seed, 'wa_charter')
    expect(rows).toHaveLength(seed.length)
    rows.forEach((r, i) => {
      expect(r.school_id).toBe(SCHOOL)
      expect(r.year).toBe(1)
      expect(r.sort_order).toBe(i)
      expect(r.position_type).toBe(seed[i].positionType)
      expect(r.position_type).not.toBe('custom')
      expect(r.classification).toBe(getClassification(r.position_type))
      expect(r.benchmark_salary).toBe(getCommissionPosition(r.position_type)!.salary)
      expect(r.manual_override).toBe(false)
      // The Staffing tab reads back the same type.
      expect(resolvePositionType(r)).toBe(r.position_type)
    })
    const teacher = rows.find((r) => r.position_type === 'teacher_elem')!
    expect([teacher.driver, teacher.students_per_position, teacher.category]).toEqual(['per_pupil', 24, 'certificated'])
    const ceo = rows.find((r) => r.position_type === 'ceo_director')!
    expect([ceo.driver, ceo.students_per_position, ceo.category]).toEqual(['fixed', 0, 'admin'])
  })

  test('positions added in the wizard are typed from their title, else saved as custom', () => {
    const rows = onboardingStaffingRows(SCHOOL, [
      { title: 'Office Manager', category: 'admin', fte: 1, salary: 50000 },
      { title: 'Robotics Coach', category: 'certificated', fte: 0.5, salary: 30000 },
      { title: 'Spare', category: 'classified', fte: Number.NaN, salary: Number.NaN },
    ], 'wa_charter')
    expect(rows[0]).toMatchObject({ position_type: 'office_mgr', classification: 'Classified', category: 'classified' })
    expect(rows[1]).toMatchObject({ position_type: 'custom', classification: 'Certificated', category: 'certificated', students_per_position: 0, driver: 'fixed', benchmark_salary: 0 })
    // A founder's custom position keeps its type and section on the Staffing tab (P-UX-12).
    expect(resolvePositionType(rows[1])).toBe('custom')
    expect(savedCustomClassification(rows[1])).toBe('Certificated')
    expect([rows[2].fte, rows[2].annual_salary]).toEqual([0, 0])
  })

  test('generic pathway catalog types keep their catalog driver, ratio and salary', () => {
    const seed = buildConfigOnboardingSeed('generic_private', { enrollment: 40, maxClassSize: 20, pctIep: 10, openingGrades: ['K', '1'] })
    const rows = onboardingStaffingRows(SCHOOL, seed, 'generic_private')
    for (const r of rows) {
      expect(r.position_type).not.toBe('custom')
      expect(['Administrative', 'Certificated', 'Classified']).toContain(r.classification)
      expect(r.benchmark_salary).toBeGreaterThan(0)
    }
    const teacher = rows.find((r) => r.position_type === 'classroom_teacher')
    expect(teacher).toMatchObject({ classification: 'Certificated', driver: 'per_pupil', students_per_position: 20 })
  })

  test('merged row set replaces Year 1 and keeps every other year unchanged', () => {
    const existing: StoredStaffingRow[] = [
      { id: 'a', school_id: SCHOOL, year: 1, title: 'Old Y1', category: 'admin', fte: 1, annual_salary: 1 },
      { id: 'b', school_id: 'someone-else', year: 2, title: 'Teacher', category: 'certificated', fte: 5, annual_salary: 82000, position_type: 'teacher_elem', driver: 'per_pupil', classification: 'Certificated', benchmark_salary: 80340, students_per_position: 24, sort_order: 2, manual_override: true, notes: 'dropped' },
      { id: 'c', school_id: SCHOOL, year: 3, title: 'Legacy', category: 'classified', fte: 1, annual_salary: 40000, position_type: null, driver: null, classification: null, benchmark_salary: null, students_per_position: null, sort_order: null, manual_override: null },
    ]
    const y1 = onboardingStaffingRows(SCHOOL, [{ title: 'CEO/Executive Director', category: 'admin', fte: 1, salary: 164800, positionType: 'ceo_director' }])
    const merged = mergeYearOneStaffing(SCHOOL, existing, y1)

    expect(merged.map((r) => [r.year, r.title])).toEqual([[1, 'CEO/Executive Director'], [2, 'Teacher'], [3, 'Legacy']])
    for (const r of merged) {
      expect(r.school_id).toBe(SCHOOL)
      expect(r).not.toHaveProperty('id')
      expect(r).not.toHaveProperty('notes')
    }
    expect(merged[1]).toMatchObject({ fte: 5, annual_salary: 82000, position_type: 'teacher_elem', manual_override: true, sort_order: 2 })
    // Nulls take the column defaults, exactly as the table / RPC would.
    expect(merged[2]).toMatchObject({ position_type: 'custom', driver: 'fixed', classification: 'Administrative', benchmark_salary: 0, students_per_position: 24, sort_order: 0, manual_override: false })
  })
})

type Err = { code: string; message: string } | null

/** Minimal Supabase fake: one read of the school's non-Year-1 rows, then the replace RPC. */
function fakeSupabase(opts: { stored: StoredStaffingRow[]; readError?: Err; rpcError?: Err }) {
  const calls: { rpc: { name: string; args: { p_school_id: string; p_rows: Record<string, unknown>[] } }[]; filters: string[] } = { rpc: [], filters: [] }
  const client = {
    from(table: string) {
      expect(table).toBe('staffing_positions')
      const q = {
        select() { return q },
        eq(col: string, v: unknown) { calls.filters.push(`${col}=${v}`); return q },
        neq(col: string, v: unknown) { calls.filters.push(`${col}!=${v}`); return q },
        then(resolve: (r: { data: StoredStaffingRow[] | null; error: Err }) => unknown) {
          return Promise.resolve(opts.readError ? { data: null, error: opts.readError } : { data: opts.stored.filter((r) => r.year !== 1), error: null }).then(resolve)
        },
      }
      return q
    },
    rpc(name: string, args: { p_school_id: string; p_rows: Record<string, unknown>[] }) {
      calls.rpc.push({ name, args })
      return Promise.resolve({ error: opts.rpcError ?? null, status: opts.rpcError ? 400 : 204 })
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

test.describe('P-UX-24 — replaceYearOneStaffing goes through the atomic replace', () => {
  const stored: StoredStaffingRow[] = [
    { school_id: SCHOOL, year: 1, title: 'Old', category: 'admin', fte: 1, annual_salary: 1 },
    { school_id: SCHOOL, year: 2, title: 'Kept', category: 'admin', fte: 1, annual_salary: 2, position_type: 'principal', sort_order: 0 },
  ]
  const positions = [{ title: 'Principal/Head of School', category: 'admin', fte: 1, salary: 123600, positionType: 'principal' }]

  test('sends Year 1 plus the stored other years to replace_staffing_positions', async () => {
    const { client, calls } = fakeSupabase({ stored })
    const result = await replaceYearOneStaffing(client, SCHOOL, positions, 'wa_charter')
    expect(result).toEqual({ ok: true })
    expect(calls.filters).toEqual([`school_id=${SCHOOL}`, 'year!=1'])
    expect(calls.rpc).toHaveLength(1)
    expect(calls.rpc[0].name).toBe('replace_staffing_positions')
    expect(calls.rpc[0].args.p_school_id).toBe(SCHOOL)
    expect(calls.rpc[0].args.p_rows.map((r) => [r.year, r.title, r.position_type])).toEqual([
      [1, 'Principal/Head of School', 'principal'],
      [2, 'Kept', 'principal'],
    ])
  })

  test('a failed read of the other years writes nothing', async () => {
    const { client, calls } = fakeSupabase({ stored, readError: { code: '500', message: 'read failed' } })
    const result = await replaceYearOneStaffing(client, SCHOOL, positions)
    expect(result).toEqual({ ok: false, message: 'read failed', previousDataIntact: true })
    expect(calls.rpc).toHaveLength(0)
  })

  test('an RPC error reports the previous rows intact (the transaction rolled back)', async () => {
    const { client } = fakeSupabase({ stored, rpcError: { code: '23502', message: 'null value' } })
    const result = await replaceYearOneStaffing(client, SCHOOL, positions)
    expect(result).toEqual({ ok: false, message: 'null value', previousDataIntact: true })
  })
})
