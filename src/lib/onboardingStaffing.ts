import type { SupabaseClient } from '@supabase/supabase-js'
import { replaceStaffingPositions, type ReplaceResult } from './atomicReplace'
import {
  POSITION_CLASSIFICATION,
  classificationToCategory,
  getClassification,
  getDriver,
  getStudentsPerPosition,
  inferPositionType,
  type StaffClassification,
} from './positionTypes'
import { getStateConfig } from './stateConfig'
import { getCommissionPosition } from './types'

/**
 * Year-1 staffing writes from onboarding (P-UX-24 / P4-FU-02).
 *
 * Onboarding Step 4 and /api/onboarding/complete used to DELETE the school's Year-1
 * staffing_positions and INSERT the new set in a separate request (a failed insert left the
 * school with no Year-1 staff), and the complete route wrote only title/category/FTE/salary,
 * so every new school started with untyped ('custom', 24) rows. Both now build fully typed
 * rows here and save them through replace_staffing_positions (src/lib/atomicReplace.ts).
 * That RPC replaces ALL of a school's rows, so Years 2-5 are read first and written back
 * unchanged alongside the new Year 1.
 */

/** A position as the onboarding wizard holds it. */
export interface WizardPosition {
  title: string
  category: 'certificated' | 'classified' | 'admin' | string
  fte: number
  salary: number
  positionType?: string | null
  classification?: string | null
  driver?: string | null
}

/** Every column replace_staffing_positions writes. */
export interface StaffingRow {
  school_id: string
  year: number
  title: string
  category: string
  fte: number
  annual_salary: number
  position_type: string
  driver: string
  classification: string
  benchmark_salary: number
  students_per_position: number
  sort_order: number
  manual_override: boolean
}

const CATEGORY_CLASSIFICATION: Record<string, StaffClassification> = {
  admin: 'Administrative',
  certificated: 'Certificated',
  classified: 'Classified',
}

/** stateConfig's three-way classification in the Staffing tab's vocabulary. */
const CONFIG_CLASSIFICATION: Record<string, StaffClassification> = {
  Administrative: 'Administrative',
  Instructional: 'Certificated',
  'Non-Instructional': 'Classified',
  Certificated: 'Certificated',
  Classified: 'Classified',
}

function finiteOr(n: unknown, fallback: number): number {
  if (n == null || n === '') return fallback
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : fallback
}

/**
 * The type a wizard position is saved with: its own type when it has one, otherwise the
 * catalog type its title names (the same inference the Staffing tab applies to untyped rows),
 * otherwise 'custom'.
 */
export function wizardPositionType(p: WizardPosition): string {
  if (p.positionType) return p.positionType
  return inferPositionType(p.title ?? '')
}

/**
 * Fully typed Year-1 rows for the wizard's positions, in the shape the Staffing tab saves:
 * - WA catalog types take the Staffing tab's classification / driver / students-per-position;
 * - other pathway catalog types (stateConfig) keep that catalog's driver, ratio and salary;
 * - anything else is a founder's custom position: 'custom' with students_per_position 0 and
 *   the section the founder picked, so the Staffing tab keeps it custom (P-UX-12).
 */
export function onboardingStaffingRows(schoolId: string, positions: WizardPosition[], pathway?: string | null): StaffingRow[] {
  const catalog = getStateConfig(pathway).position_types
  return positions.map((p, i) => {
    const type = wizardPositionType(p)
    const configEntry = catalog.find((t) => t.type === type)
    const fte = finiteOr(p.fte, 0)
    const salary = finiteOr(p.salary, 0)

    let classification: StaffClassification
    let driver: string
    let studentsPerPosition: number
    let benchmark: number
    let positionType = type

    if (type !== 'custom' && type in POSITION_CLASSIFICATION) {
      classification = getClassification(type)
      driver = getDriver(type)
      studentsPerPosition = getStudentsPerPosition(type)
      benchmark = configEntry?.default_salary ?? getCommissionPosition(type)?.salary ?? 0
    } else if (type !== 'custom' && configEntry) {
      classification = CONFIG_CLASSIFICATION[configEntry.classification] ?? 'Classified'
      driver = configEntry.driver
      studentsPerPosition = configEntry.students_per_position
      benchmark = configEntry.default_salary
    } else {
      positionType = 'custom'
      classification = CATEGORY_CLASSIFICATION[p.category] ?? CONFIG_CLASSIFICATION[p.classification ?? ''] ?? 'Classified'
      driver = 'fixed'
      studentsPerPosition = 0
      benchmark = 0
    }

    return {
      school_id: schoolId,
      year: 1,
      title: p.title ?? '',
      category: classificationToCategory(classification),
      fte,
      annual_salary: salary,
      position_type: positionType,
      driver,
      classification,
      benchmark_salary: benchmark,
      students_per_position: studentsPerPosition,
      sort_order: i,
      manual_override: false,
    }
  })
}

/** A staffing_positions row as read back from the database (any subset of columns). */
export type StoredStaffingRow = Partial<Record<keyof StaffingRow, unknown>> & Record<string, unknown>

/** Project a stored row onto the columns the replace writes, keeping its values. */
function keepStoredRow(schoolId: string, r: StoredStaffingRow): StaffingRow {
  return {
    school_id: schoolId,
    year: finiteOr(r.year, 0),
    title: String(r.title ?? ''),
    category: String(r.category ?? 'classified'),
    fte: finiteOr(r.fte, 0),
    annual_salary: finiteOr(r.annual_salary, 0),
    position_type: r.position_type == null ? 'custom' : String(r.position_type),
    driver: r.driver == null ? 'fixed' : String(r.driver),
    classification: r.classification == null ? 'Administrative' : String(r.classification),
    benchmark_salary: finiteOr(r.benchmark_salary, 0),
    students_per_position: finiteOr(r.students_per_position, 24),
    sort_order: finiteOr(r.sort_order, 0),
    manual_override: r.manual_override === true,
  }
}

/**
 * The school's full row set after replacing Year 1: every stored row for another year
 * (unchanged, defaults as the table would fill them) plus the new Year-1 rows.
 */
export function mergeYearOneStaffing(schoolId: string, existing: StoredStaffingRow[], yearOne: StaffingRow[]): StaffingRow[] {
  const otherYears = existing
    .filter((r) => finiteOr(r.year, 1) !== 1)
    .map((r) => keepStoredRow(schoolId, r))
    .sort((a, b) => a.year - b.year || a.sort_order - b.sort_order)
  return [...yearOne.map((r) => ({ ...r, school_id: schoolId, year: 1 })), ...otherYears]
}

/**
 * Replace the school's Year-1 staffing with the wizard's positions in one transaction
 * (the RPC; atomicReplace falls back to delete -> insert -> restore if it is missing).
 * Years 2-5 are read first and written back unchanged.
 */
export async function replaceYearOneStaffing(
  supabase: SupabaseClient,
  schoolId: string,
  positions: WizardPosition[],
  pathway?: string | null,
): Promise<ReplaceResult> {
  const { data: existing, error } = await supabase
    .from('staffing_positions')
    .select('*')
    .eq('school_id', schoolId)
    .neq('year', 1)
  if (error) return { ok: false, message: error.message, previousDataIntact: true }
  const rows = mergeYearOneStaffing(schoolId, (existing ?? []) as StoredStaffingRow[], onboardingStaffingRows(schoolId, positions, pathway))
  return replaceStaffingPositions(supabase, schoolId, rows as unknown as Record<string, unknown>[])
}
