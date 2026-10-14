// R-REV-05: single source of truth for WA Charter default salaries.
//
// Salaries are NOT stored here. They are read from COMMISSION_POSITIONS in
// types.ts (the OSPI/BLS WA benchmark catalog) via getCommissionPosition, so the
// onboarding seed (buildWaOnboardingSeed below, used by StepStaffing), the staffing/seed
// fallback route (SEED_POSITIONS below), and the dashboard add-position path
// (staffing/page.tsx, which reads getCommissionPosition(type).salary) all resolve
// to the same number. This eliminated the prior drift where onboarding seeded
// salaries ~25-40% below the catalog benchmark a founder saw on the dashboard.
//
// The salary rules are WA Charter only. Generic / Private / Micro pathways seed
// onboarding from their own stateConfig catalogs (buildConfigOnboardingSeed) with
// those catalogs' salaries.

import { getCommissionPosition } from './types'
import { ALL_GRADES, gradeIndex } from './gradeExpansion'
import { getStateConfig } from './stateConfig'

/** WA Charter position types instantiated by the seed paths. The onboarding builder
 *  seeds one classroom-teacher row per grade band the school opens with (elementary,
 *  middle, high); the rest are the fixed onboarding/seed roster. */
export const WA_SEED_POSITION_TYPES = [
  'ceo_director',
  'principal',
  'teacher_elem',
  'teacher_ms',
  'teacher_hs',
  'sped_teacher',
  'office_mgr',
  'paraeducator',
] as const

/** Resolve a position type's default salary from the single source of truth
 *  (COMMISSION_POSITIONS). Returns 0 only if the type is absent from the catalog,
 *  which would be a catalog bug the guardrail test catches. */
export function waSeedSalary(positionType: string): number {
  return getCommissionPosition(positionType)?.salary ?? 0
}

export interface SeedPosition {
  positionType: string
  title: string
  category: 'admin' | 'certificated' | 'classified'
  classification: string
  salary: number
  benchmarkSalary: number
  driver: string
  studentsPerPosition: number
  fixedFte: number | null
}

/** Default seed roster used by /api/staffing/seed (6 position types x 5 years).
 *  salary and benchmarkSalary both resolve to the catalog value so a seeded
 *  school starts at benchmark, not below it. */
export const SEED_POSITIONS: SeedPosition[] = [
  { positionType: 'ceo_director', title: 'CEO/Executive Director', category: 'admin', classification: 'Administrative', salary: waSeedSalary('ceo_director'), benchmarkSalary: waSeedSalary('ceo_director'), driver: 'fixed', studentsPerPosition: 0, fixedFte: 1 },
  { positionType: 'principal', title: 'Principal/Head of School', category: 'admin', classification: 'Administrative', salary: waSeedSalary('principal'), benchmarkSalary: waSeedSalary('principal'), driver: 'fixed', studentsPerPosition: 0, fixedFte: 1 },
  { positionType: 'teacher_elem', title: 'Classroom Teacher - Elementary', category: 'certificated', classification: 'Certificated', salary: waSeedSalary('teacher_elem'), benchmarkSalary: waSeedSalary('teacher_elem'), driver: 'per_pupil', studentsPerPosition: 24, fixedFte: null },
  { positionType: 'sped_teacher', title: 'Special Education (SPED) Teacher', category: 'certificated', classification: 'Certificated', salary: waSeedSalary('sped_teacher'), benchmarkSalary: waSeedSalary('sped_teacher'), driver: 'fixed', studentsPerPosition: 12, fixedFte: 1 },
  { positionType: 'office_mgr', title: 'Administrative Assistant/Office Manager', category: 'classified', classification: 'Classified', salary: waSeedSalary('office_mgr'), benchmarkSalary: waSeedSalary('office_mgr'), driver: 'fixed', studentsPerPosition: 0, fixedFte: 1 },
  { positionType: 'paraeducator', title: 'Instructional Aides/Paraeducators', category: 'classified', classification: 'Classified', salary: waSeedSalary('paraeducator'), benchmarkSalary: waSeedSalary('paraeducator'), driver: 'per_pupil', studentsPerPosition: 48, fixedFte: null },
]

/** Tooltip copy shown next to salary inputs. ASCII only. */
export const SALARY_SOURCE_NOTE = 'Default from BLS WA / OSPI S-275 - verify against your local market.'

// --- P-UX-13: grade-aware onboarding seed ------------------------------------
// The onboarding Staffing step used to seed "Classroom Teacher - Elementary" for every
// school whose grade label wasn't exactly 6-8 or 9-12 (so a 6-12 school got elementary
// teachers and a 9-12 school got middle-school ones), and the generic pathways seeded
// elementary, middle AND high-school teachers at the full section count each. The seed now
// has one teacher row per grade band present in the school's opening grades.

export type GradeBand = 'elem' | 'ms' | 'hs'

const BAND_ORDER: GradeBand[] = ['elem', 'ms', 'hs']

export const TEACHER_TYPE_BY_BAND: Record<GradeBand, 'teacher_elem' | 'teacher_ms' | 'teacher_hs'> = {
  elem: 'teacher_elem',
  ms: 'teacher_ms',
  hs: 'teacher_hs',
}

/** stateConfig drivers that tie a teacher type to a grade band. */
const BAND_BY_DRIVER: Record<string, GradeBand> = {
  per_pupil_elem: 'elem',
  per_pupil_ms: 'ms',
  per_pupil_hs: 'hs',
}

/** K-5 elementary, 6-8 middle, 9-12 high; null for an unknown grade label. */
export function gradeBand(grade: string): GradeBand | null {
  const i = gradeIndex(grade)
  if (i < 0) return null
  if (i < gradeIndex('6')) return 'elem'
  if (i < gradeIndex('9')) return 'ms'
  return 'hs'
}

/** Grades named by a grade-config label such as "K-5", "6-12" or "7"; [] if unparseable. */
export function gradesInConfig(gradeConfig: string): string[] {
  const [from, to = from] = gradeConfig.split('-').map((s) => s.trim())
  const a = gradeIndex(from)
  const b = gradeIndex(to)
  if (a < 0 || b < 0 || b < a) return []
  return ALL_GRADES.slice(a, b + 1)
}

export interface GradeSeedInput {
  /** Grades served in Year 1 (onboarding Step 1). Preferred over gradeConfig. */
  openingGrades?: string[]
  /** Build-out label ("K-8"); used only when no opening grades are known. */
  gradeConfig?: string
  /** Grade expansion plan; its Year-1 rows give exact sections per grade. */
  expansionPlan?: { year: number; grade_level: string; sections: number }[]
  /** Total Year-1 sections, split across bands when there is no Year-1 plan. */
  totalSections: number
}

export interface BandSections {
  band: GradeBand
  sections: number
}

/**
 * Year-1 classroom sections per grade band. Exact from the Year-1 expansion plan when one
 * exists; otherwise `totalSections` is split across the bands in proportion to how many
 * opening grades each has (largest remainder; each band present gets at least one section).
 * With no grade information at all, every section is elementary (the old default).
 */
export function teacherSectionsByBand(input: GradeSeedInput): BandSections[] {
  const planY1 = (input.expansionPlan ?? []).filter((e) => e.year === 1 && gradeBand(e.grade_level) && e.sections > 0)
  if (planY1.length > 0) {
    const byBand = new Map<GradeBand, number>()
    for (const e of planY1) {
      const band = gradeBand(e.grade_level)!
      byBand.set(band, (byBand.get(band) ?? 0) + e.sections)
    }
    return BAND_ORDER.filter((b) => byBand.has(b)).map((band) => ({ band, sections: byBand.get(band)! }))
  }

  const opening = (input.openingGrades ?? []).filter((g) => gradeBand(g))
  const grades = opening.length > 0 ? opening : gradesInConfig(input.gradeConfig ?? '')
  const counts = new Map<GradeBand, number>()
  for (const g of grades) {
    const band = gradeBand(g)
    if (band) counts.set(band, (counts.get(band) ?? 0) + 1)
  }
  if (counts.size === 0) counts.set('elem', 1)

  const bands = BAND_ORDER.filter((b) => counts.has(b))
  const total = Math.max(0, Math.round(Number.isFinite(input.totalSections) ? input.totalSections : 0))
  if (total === 0) return bands.map((band) => ({ band, sections: 0 }))

  const gradeCount = bands.reduce((s, b) => s + counts.get(b)!, 0)
  const shares = bands.map((band) => {
    const exact = (total * counts.get(band)!) / gradeCount
    return { band, sections: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let left = total - shares.reduce((s, x) => s + x.sections, 0)
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (left <= 0) break
    share.sections += 1
    left -= 1
  }
  return shares.map(({ band, sections }) => ({ band, sections: Math.max(1, sections) }))
}

/** A seeded onboarding position (StepStaffing adds its row key). */
export interface OnboardingSeedPosition {
  title: string
  category: 'certificated' | 'classified' | 'admin'
  fte: number
  salary: number
  positionType: string
  classification: string
  driver: string
}

function waSeed(
  positionType: string,
  title: string,
  category: OnboardingSeedPosition['category'],
  classification: string,
  driver: string,
  fte: number,
): OnboardingSeedPosition {
  return { title, category, fte, salary: waSeedSalary(positionType), positionType, classification, driver }
}

function defaultSectionsY1(enrollment: number, maxClassSize: number, sectionsY1?: number): number {
  if (sectionsY1 != null) return sectionsY1
  return maxClassSize > 0 ? Math.ceil(enrollment / maxClassSize) : 0
}

export interface OnboardingSeedInput extends Omit<GradeSeedInput, 'totalSections'> {
  enrollment: number
  maxClassSize: number
  pctIep: number
  /** Total Year-1 sections; defaults to ceil(enrollment / maxClassSize). */
  sectionsY1?: number
}

/** WA Charter onboarding seed: leadership, one teacher row per opening grade band, SPED, office, paras. */
export function buildWaOnboardingSeed(input: OnboardingSeedInput): OnboardingSeedPosition[] {
  const totalSections = defaultSectionsY1(input.enrollment, input.maxClassSize, input.sectionsY1)
  const paras = Math.max(1, Math.ceil((input.enrollment * input.pctIep / 100) / 10))
  const teachers = teacherSectionsByBand({ ...input, totalSections }).map(({ band, sections }) => {
    const type = TEACHER_TYPE_BY_BAND[band]
    return waSeed(type, getCommissionPosition(type)?.name ?? type, 'certificated', 'Certificated', 'per_pupil', sections)
  })
  return [
    waSeed('ceo_director', 'CEO/Executive Director', 'admin', 'Administrative', 'fixed', 1),
    waSeed('principal', 'Principal/Head of School', 'admin', 'Administrative', 'fixed', 1),
    ...teachers,
    waSeed('sped_teacher', 'Special Education (SPED) Teacher', 'certificated', 'Certificated', 'fixed', 1),
    waSeed('office_mgr', 'Administrative Assistant/Office Manager', 'classified', 'Classified', 'fixed', 1),
    waSeed('paraeducator', 'Instructional Aides/Paraeducators', 'classified', 'Classified', 'per_pupil', paras),
  ]
}

/**
 * Generic / private / micro onboarding seed from the pathway's stateConfig catalog. Band
 * teacher types (per_pupil_elem / _ms / _hs drivers) are seeded only for bands the school
 * opens with, at that band's section count.
 */
export function buildConfigOnboardingSeed(pathway: string, input: OnboardingSeedInput): OnboardingSeedPosition[] {
  const config = getStateConfig(pathway)
  const totalSections = defaultSectionsY1(input.enrollment, input.maxClassSize, input.sectionsY1)
  const bandSections = new Map(teacherSectionsByBand({ ...input, totalSections }).map((b) => [b.band, b.sections]))
  const positions: OnboardingSeedPosition[] = []

  for (const pt of config.position_types) {
    let fte = pt.default_fte
    const band = BAND_BY_DRIVER[pt.driver]
    if (band) {
      const sections = bandSections.get(band)
      if (sections == null) continue
      fte = sections
    } else if (pt.driver === 'per_pupil' && pt.students_per_position > 0) {
      fte = Math.max(pt.default_fte, Math.ceil(input.enrollment / pt.students_per_position))
    } else if (pt.driver === 'per_pupil_sped' && pt.students_per_position > 0) {
      fte = Math.max(1, Math.ceil((input.enrollment * input.pctIep / 100) / pt.students_per_position))
    }

    const category: OnboardingSeedPosition['category'] =
      pt.classification === 'Administrative' ? 'admin' :
        pt.classification === 'Instructional' ? 'certificated' : 'classified'

    positions.push({
      title: pt.name,
      category,
      fte,
      salary: pt.default_salary,
      positionType: pt.type,
      classification: pt.classification,
      driver: pt.driver,
    })
  }
  return positions
}
