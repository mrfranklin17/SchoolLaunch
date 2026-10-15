import { computeCarryForward, computeFPFScorecard, runProjections, type MultiYearDetailedRow, type FPFScorecard } from '../../src/lib/budgetEngine'
import { buildAdvisoryRequest } from '../../src/lib/advisory'
import { REGIONALIZATION_FACTORS } from '../../src/lib/regionalization'
import {
  COMMISSION_POSITIONS,
  DEFAULT_ASSUMPTIONS,
  getAssumptions,
  type BudgetProjection,
  type FinancialAssumptions,
  type SchoolProfile,
  type StaffingPosition,
  type StartupFundingSource,
} from '../../src/lib/types'

/**
 * AI-EXP-01 step 3: fixture schools for the advisor eval (tests/evals/advisors.eval.ts).
 *
 * Each fixture is a healthy WA K-5 school with one planted problem, built in memory and run
 * through the same engine and context builders as the dashboard (runProjections,
 * computeFPFScorecard, buildAdvisoryRequest), so the advisors see exactly what a founder's
 * school would send. `tests/session4/advisor-eval-fixtures.spec.ts` checks offline that each
 * planted problem is really in the engine output (and absent from the control), so an eval
 * failure means the advisors missed it, not that the fixture lost it.
 */

const SCHOOL_ID = '00000000-0000-0000-0000-0000000e7a11'
const COUNTY = 'king_county'

interface Fixture {
  profile: SchoolProfile
  positions: StaffingPosition[]
  projections: BudgetProjection[]
}

function position(type: string, fte: number, extra: Partial<StaffingPosition> = {}): StaffingPosition {
  const p = COMMISSION_POSITIONS.find((c) => c.type === type)!
  return {
    school_id: SCHOOL_ID,
    year: 1,
    title: p.name,
    category: p.classification === 'Instructional' ? 'certificated' : p.classification === 'Administrative' ? 'admin' : 'classified',
    fte,
    annual_salary: p.salary,
    position_type: p.type,
    classification: p.classification,
    driver: p.driver,
    students_per_position: p.studentsPerPosition,
    ...extra,
  } as StaffingPosition
}

function ops(lines: Record<string, number>): BudgetProjection[] {
  return Object.entries(lines).map(([subcategory, amount]) => ({
    school_id: SCHOOL_ID, year: 1, category: 'Operations', subcategory, amount, is_revenue: false,
  }) as BudgetProjection)
}

const CSP: StartupFundingSource = {
  source: 'Federal CSP Grant', amount: 900000, type: 'grant', status: 'pledged',
  selectedYears: [0, 1, 2], yearAllocations: { 0: 300000, 1: 350000, 2: 250000 },
}
const PHILANTHROPY: StartupFundingSource = {
  source: 'Founding philanthropy', amount: 400000, type: 'grant', status: 'received',
  selectedYears: [0], yearAllocations: { 0: 400000 },
}

/** The control: a sound K-5 plan that should draw no red status. */
function healthy(): Fixture {
  const assumptions: Partial<FinancialAssumptions> = {
    regionalization_factor: REGIONALIZATION_FACTORS[COUNTY].factor,
  }
  const profile = {
    school_id: SCHOOL_ID,
    region: COUNTY,
    planned_open_year: 2027,
    grade_config: 'K-5',
    target_enrollment_y1: 288, target_enrollment_y2: 312, target_enrollment_y3: 336,
    target_enrollment_y4: 360, target_enrollment_y5: 360,
    max_class_size: 24,
    pct_frl: 55, pct_iep: 12, pct_ell: 12, pct_hicap: 5,
    retention_rate: 92,
    onboarding_complete: true,
    financial_assumptions: assumptions,
    startup_funding: [CSP, PHILANTHROPY],
  } as unknown as SchoolProfile
  const positions = [
    position('principal', 1),
    position('asst_principal', 1),
    position('office_mgr', 1),
    position('registrar', 1),
    position('cfo', 0.5),
    position('teacher_elem', 15),
    position('sped_teacher', 3),
    position('paraeducator', 8),
    position('el_specialist', 1.5),
    position('interventionist', 2),
    position('instructional_coach', 1),
    position('substitute_pool', 1.5),
    position('counselor', 1),
    position('psychologist', 0.5),
    position('custodian', 2),
  ]
  const projections = ops({
    'Facilities': 560000,
    'Insurance': 45000,
    'Supplies & Materials': 72000,
    'Technology': 60000,
    'Curriculum & Materials': 80000,
    'Professional Development': 40000,
    'Contracted Services': 150000,
    'Marketing & Outreach': 20000,
    'Fundraising': 0,
  })
  return { profile, positions, projections }
}

export interface EvalCase {
  id: string
  /** What is planted, in a founder's words. */
  planted: string
  build: () => Fixture
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'control',
    planted: 'Nothing: a sound plan. Advisors should not report risk.',
    build: healthy,
  },
  {
    id: 'year3_cliff',
    planted: 'The CSP grant carries Years 1-2; enrollment stalls at 288 after Year 1, so Year 3 net turns sharply negative and cash falls.',
    build: () => {
      const f = healthy()
      Object.assign(f.profile, {
        target_enrollment_y2: 288, target_enrollment_y3: 288, target_enrollment_y4: 288, target_enrollment_y5: 288,
        startup_funding: [
          { ...CSP, amount: 1250000, selectedYears: [0, 1, 2], yearAllocations: { 0: 250000, 1: 500000, 2: 500000 } },
          PHILANTHROPY,
        ],
      })
      // More staff than Year 1 revenue alone carries; the grant hides it until Year 3.
      f.positions.push(position('social_worker', 1), position('it_coordinator', 1))
      return f
    },
  },
  {
    id: 'sped_understaffed',
    planted: '14% IEP (about 40 students) served by a single 0.5 FTE SPED teacher.',
    build: () => {
      const f = healthy()
      f.profile.pct_iep = 14
      f.positions = f.positions
        .filter((p) => p.position_type !== 'sped_teacher')
        .concat(position('sped_teacher', 0.5))
      return f
    },
  },
  {
    id: 'thin_back_office',
    planted: 'No business manager or bookkeeper and only $8,000 of Contracted Services (no room for outsourced accounting, audit or payroll).',
    build: () => {
      const f = healthy()
      f.positions = f.positions.filter((p) => p.position_type !== 'cfo')
      f.projections = f.projections.map((p) => p.subcategory === 'Contracted Services' ? { ...p, amount: 8000 } : p)
      return f
    },
  },
  {
    id: 'regular_ed_rate',
    planted: 'Regular Ed base rate set to $13,900, well above the statutory default, with no documented source.',
    build: () => {
      const f = healthy()
      f.profile.financial_assumptions = { ...(f.profile.financial_assumptions as object), regular_ed_per_pupil: 13900 } as FinancialAssumptions
      return f
    },
  },
]

export interface EvalSchool {
  multiYear: MultiYearDetailedRow[]
  scorecard: FPFScorecard
  request: ReturnType<typeof buildAdvisoryRequest>
}

/** Run a fixture through the dashboard's engine and build its /api/advisory request body. */
export function evalSchool(c: EvalCase, schoolId = SCHOOL_ID): EvalSchool {
  const { profile, positions, projections } = c.build()
  const assumptions = getAssumptions(profile.financial_assumptions)
  const preOpenCash = computeCarryForward(profile)
  const multiYear = runProjections({
    pathway: 'wa_charter', profile, positions, projections, assumptions, preOpenCash,
    gradeExpansionPlan: [], allPositions: positions, startupFunding: profile.startup_funding,
  })
  const scorecard = computeFPFScorecard(multiYear, preOpenCash, false)
  const request = buildAdvisoryRequest({
    schoolId, schoolName: `Eval Academy (${c.id})`, profile, positions, projections,
    gradeExpansionPlan: [], multiYear, fpfScorecard: scorecard, pathway: 'wa_charter', alignmentReview: null,
  })
  return { multiYear, scorecard, request }
}

export { DEFAULT_ASSUMPTIONS }
