export interface FinancialAssumptions {
  // Legacy field — kept for backward compat, computed from new fields
  per_pupil_rate: number
  levy_equity_per_student: number
  benefits_load_pct: number
  authorizer_fee_pct: number
  salary_escalator_pct: number
  ops_escalator_pct: number
  supplies_per_student: number
  contracted_services_per_student: number
  technology_per_student: number
  insurance_annual: number
  contingency_pct: number
  curriculum_per_student: number
  professional_development_per_fte: number
  food_service_per_student: number
  transportation_per_student: number
  marketing_per_student: number
  fundraising_annual: number
  food_service_offered: boolean
  transportation_offered: boolean
  food_service_revenue_per_pupil: number
  transportation_revenue_per_pupil: number
  // Commission-aligned revenue fields
  regular_ed_per_pupil: number
  sped_per_pupil: number
  state_sped_per_pupil: number
  facilities_per_pupil: number
  lap_per_pupil: number
  lap_high_poverty_per_pupil: number
  tbip_per_pupil: number
  hicap_per_pupil: number
  title_i_per_pupil: number
  idea_per_pupil: number
  revenue_cola_pct: number
  aafte_pct: number
  interest_rate_on_cash: number
  regionalization_factor: number
}

export const DEFAULT_ASSUMPTIONS: FinancialAssumptions = {
  per_pupil_rate: 11812, // Now defaults to regular_ed rate (legacy field)
  levy_equity_per_student: 0,
  benefits_load_pct: 30,
  authorizer_fee_pct: 3,
  salary_escalator_pct: 2.5,
  ops_escalator_pct: 2,
  supplies_per_student: 200,
  contracted_services_per_student: 150,
  technology_per_student: 180,
  insurance_annual: 18000,
  contingency_pct: 2,
  curriculum_per_student: 500,
  professional_development_per_fte: 1000,
  food_service_per_student: 1200,
  transportation_per_student: 800,
  marketing_per_student: 200,
  fundraising_annual: 15000,
  food_service_offered: false,
  transportation_offered: false,
  food_service_revenue_per_pupil: 710,
  transportation_revenue_per_pupil: 560,
  // Commission-aligned (validated against OSPI apportionment data)
  regular_ed_per_pupil: 11812,
  sped_per_pupil: 2548,
  state_sped_per_pupil: 13556,
  facilities_per_pupil: 0,
  lap_per_pupil: 816,
  lap_high_poverty_per_pupil: 374,
  tbip_per_pupil: 1600,
  hicap_per_pupil: 730,
  title_i_per_pupil: 880,
  idea_per_pupil: 1500,
  revenue_cola_pct: 3,
  aafte_pct: 95,
  interest_rate_on_cash: 3,
  regionalization_factor: 1.0,
}

/**
 * Marker that Settings saves write into school_profiles.financial_assumptions. A row
 * carrying it holds rates a founder saw and confirmed, so the value-based remaps of retired
 * defaults in getAssumptions must not rewrite them (an explicit IDEA rate of $2,200 is a
 * real rate, not the old default), and a $0 categorical/federal rate means "exclude this
 * line" rather than "use the default" (P-UX-26). It is not a FinancialAssumptions field, so
 * it never enters the advisory/scenario hash (which iterates DEFAULT_ASSUMPTIONS keys).
 */
export const ASSUMPTIONS_VERSION_KEY = 'assumptions_version'
export const CURRENT_ASSUMPTIONS_VERSION = 2

/**
 * P-UX-26: per-student rates a founder can set to $0 in Settings to exclude the line. On a
 * marker row a stored 0 is honored; a missing, null or non-numeric value (and a 0 on a
 * legacy row without the marker) resolves to the default.
 */
const ZERO_CONFIRMABLE_RATES = [
  'state_sped_per_pupil',
  'lap_per_pupil',
  'lap_high_poverty_per_pupil',
  'tbip_per_pupil',
  'hicap_per_pupil',
  'title_i_per_pupil',
  'idea_per_pupil',
] as const

export function getAssumptions(raw: Partial<FinancialAssumptions> | null | undefined): FinancialAssumptions {
  if (!raw) return { ...DEFAULT_ASSUMPTIONS }
  const merged = { ...DEFAULT_ASSUMPTIONS, ...raw }
  const ratesConfirmed = Number((raw as Record<string, unknown>)[ASSUMPTIONS_VERSION_KEY]) >= CURRENT_ASSUMPTIONS_VERSION
  // Migrate old per_pupil_rate: if regular_ed_per_pupil wasn't set but old per_pupil_rate was high
  if (!raw.regular_ed_per_pupil && raw.per_pupil_rate && raw.per_pupil_rate > 13000) {
    merged.regular_ed_per_pupil = 11812
    merged.sped_per_pupil = 2548
  }
  // Rewrite retired default values to the validated rates — only on rows saved before
  // founders confirmed these rates in Settings (no version marker).
  if (!ratesConfirmed) {
    if (raw.sped_per_pupil === 4500 || raw.sped_per_pupil === 10900) merged.sped_per_pupil = 2548
    // Legislature has not reinstated levy equity; the old $1,500 default becomes $0
    if (raw.levy_equity_per_student === 1500) merged.levy_equity_per_student = 0
    if (raw.lap_per_pupil === 690 || raw.lap_per_pupil === 400) merged.lap_per_pupil = 816
    if (raw.hicap_per_pupil === 625 || raw.hicap_per_pupil === 500) merged.hicap_per_pupil = 730
    if (raw.idea_per_pupil === 2200) merged.idea_per_pupil = 1500
    if (raw.regular_ed_per_pupil === 11000 || raw.regular_ed_per_pupil === 12000) merged.regular_ed_per_pupil = 11812
  }
  // Ensure new fields have defaults for existing schools
  if (!raw.regionalization_factor) merged.regionalization_factor = 1.0
  for (const k of ZERO_CONFIRMABLE_RATES) {
    const v = raw[k] as unknown
    const n = v === null || v === undefined || v === '' ? NaN : Number(v)
    if (!Number.isFinite(n) || (n === 0 && !ratesConfirmed)) merged[k] = DEFAULT_ASSUMPTIONS[k]
  }
  // Keep per_pupil_rate in sync for legacy code paths
  merged.per_pupil_rate = merged.regular_ed_per_pupil
  return merged
}

export interface StartupFundingSource {
  source: string
  amount: number
  type: 'grant' | 'donation' | 'debt' | 'other'
  status: 'received' | 'pledged' | 'applied' | 'projected' | 'n/a'
  /** Which years this funding covers (0-4) */
  selectedYears?: number[]
  /** Year-level allocation breakdown, keyed by year number (0-4) */
  yearAllocations?: Record<number, number>
}

export interface SchoolProfile {
  school_id: string
  region: string
  planned_open_year: number
  grade_config: string
  target_enrollment_y1: number
  target_enrollment_y2: number
  target_enrollment_y3: number
  target_enrollment_y4: number
  target_enrollment_y5: number
  max_class_size: number
  pct_frl: number
  pct_iep: number
  pct_ell: number
  pct_hicap: number
  onboarding_complete: boolean
  financial_assumptions?: Partial<FinancialAssumptions> | null
  startup_funding?: StartupFundingSource[] | null
  opening_grades?: string[] | null
  buildout_grades?: string[] | null
  retention_rate?: number | null
  pre_opening_expenses?: PreOpeningExpense[] | null
  pre_opening_transactions?: PreOpeningTransaction[] | null
  advisory_cache?: AdvisoryCache | null
  logo_url?: string | null
  /** First month of the fiscal year (1–12), chosen at onboarding; WA charter is always 9. */
  fiscal_year_start_month?: number | null
}

export interface AdvisoryCache {
  briefing: string
  agents: {
    id: string
    name: string
    icon: string
    subtitle: string
    status: 'strong' | 'needs_attention' | 'risk'
    summary: string
    actions: string[]
    /** The advisor's call failed; shown as unavailable, never cached (see src/lib/advisory.ts). */
    failed?: boolean
  }[]
  generatedAt: string
  dataHash: string
}

export interface PreOpeningExpense {
  id: string
  name: string
  budgeted: number
  actual: number
  /** Source name from startup funding for Y0 tracking */
  fundingSource?: string
}

export interface PreOpeningTransaction {
  id: string
  /** Lowercase month key: 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' */
  month: string
  description: string
  amount: number
  /** Matches a PreOpeningExpense.name for roll-up */
  expense_category: string
  created_at: string
}

export interface StaffingPosition {
  id?: string
  school_id: string
  year: number
  title: string
  category: 'certificated' | 'classified' | 'admin'
  fte: number
  annual_salary: number
  funding_source?: string
  notes?: string
  // Commission-aligned fields
  position_type?: string
  driver?: string
  students_per_position?: number
  classification?: string
  benchmark_salary?: number
  sort_order?: number
  /** Per-cell user-overridden flag — set when a founder manually overrides
   *  a Y2-Y5 FTE on a per-pupil-driver position. Recompute paths (Y1 edit,
   *  type change, fixed→per-pupil toggle) skip flagged indices. UI-only:
   *  engines (budgetEngine, scenarioEngine) ignore this field. */
  manual_override?: boolean
}

export interface BudgetProjection {
  id?: string
  school_id: string
  year: number
  category: string
  subcategory: string
  amount: number
  is_revenue: boolean
  notes?: string
  updated_at?: string
}

export type GrowthPreset = 'conservative' | 'moderate' | 'aggressive' | 'manual'

export interface GradeExpansionEntry {
  year: number
  grade_level: string
  sections: number
  students_per_section: number
  is_new_grade: boolean
}

export type EnrollmentMode = 'simple' | 'grade_expansion'

// --- Commission Position Types ---

export interface CommissionPositionType {
  type: string
  name: string
  classification: 'Administrative' | 'Instructional' | 'Non-Instructional'
  salary: number
  driver: string
  studentsPerPosition: number
}

export const COMMISSION_POSITIONS: CommissionPositionType[] = [
  // Administrative
  { type: 'ceo_director', name: 'CEO/Executive Director', classification: 'Administrative', salary: 164800, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'principal', name: 'Principal/Head of School', classification: 'Administrative', salary: 123600, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'asst_principal', name: 'Assistant/Vice Principal', classification: 'Administrative', salary: 97850, driver: 'per_pupil', studentsPerPosition: 300 },
  { type: 'registrar', name: 'Registrar/Enrollment Manager', classification: 'Administrative', salary: 61800, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'coo', name: 'COO/Operations Manager', classification: 'Administrative', salary: 113300, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'cfo', name: 'CFO/Finance/Business Manager', classification: 'Administrative', salary: 113300, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'it_coordinator', name: 'IT Coordinator', classification: 'Administrative', salary: 82400, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'facilities_mgr', name: 'Facilities Manager', classification: 'Administrative', salary: 72100, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'nutrition_mgr', name: 'Nutrition Program Manager', classification: 'Administrative', salary: 61800, driver: 'fixed', studentsPerPosition: 0 },
  // Instructional
  { type: 'instructional_coach', name: 'Instructional Coach/Curriculum Specialist', classification: 'Instructional', salary: 87550, driver: 'per_pupil', studentsPerPosition: 200 },
  { type: 'teacher_elem', name: 'Classroom Teacher - Elementary', classification: 'Instructional', salary: 80340, driver: 'per_pupil_elem', studentsPerPosition: 24 },
  { type: 'teacher_ms', name: 'Classroom Teacher - Middle School', classification: 'Instructional', salary: 82400, driver: 'per_pupil_ms', studentsPerPosition: 24 },
  { type: 'teacher_hs', name: 'Classroom Teacher - High School', classification: 'Instructional', salary: 84460, driver: 'per_pupil_hs', studentsPerPosition: 24 },
  { type: 'sped_teacher', name: 'Special Education (SPED) Teacher', classification: 'Instructional', salary: 87550, driver: 'per_pupil_sped', studentsPerPosition: 12 },
  { type: 'el_specialist', name: 'English Learner (EL) Specialist', classification: 'Instructional', salary: 82400, driver: 'per_pupil_el', studentsPerPosition: 30 },
  { type: 'interventionist', name: 'Intervention Specialist (Reading/Math)', classification: 'Instructional', salary: 80340, driver: 'per_pupil', studentsPerPosition: 50 },
  { type: 'paraeducator', name: 'Instructional Aides/Paraeducators', classification: 'Instructional', salary: 41200, driver: 'per_pupil', studentsPerPosition: 48 },
  { type: 'substitute_pool', name: 'Substitute Teacher Pool', classification: 'Instructional', salary: 30900, driver: 'per_pupil', studentsPerPosition: 200 },
  // Non-Instructional
  { type: 'counselor', name: 'School Counselor', classification: 'Non-Instructional', salary: 77250, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'social_worker', name: 'School Social Worker', classification: 'Non-Instructional', salary: 68000, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'psychologist', name: 'School Psychologist', classification: 'Non-Instructional', salary: 87550, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'office_mgr', name: 'Administrative Assistant/Office Manager', classification: 'Non-Instructional', salary: 56650, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'hr_specialist', name: 'Human Resources Specialist', classification: 'Non-Instructional', salary: 77250, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'custodian', name: 'Custodian/Facilities Maintenance', classification: 'Non-Instructional', salary: 43260, driver: 'per_pupil', studentsPerPosition: 200 },
  { type: 'security', name: 'Security/Safety Coordinator', classification: 'Non-Instructional', salary: 51500, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'food_service', name: 'Food Service Staff', classification: 'Non-Instructional', salary: 30900, driver: 'per_pupil', studentsPerPosition: 100 },
  { type: 'transport_coord', name: 'Transportation Coordinator', classification: 'Non-Instructional', salary: 61800, driver: 'fixed', studentsPerPosition: 0 },
  { type: 'custom', name: 'Custom Position', classification: 'Administrative', salary: 0, driver: 'fixed', studentsPerPosition: 0 },
]

export function getCommissionPosition(type: string): CommissionPositionType | undefined {
  return COMMISSION_POSITIONS.find((p) => p.type === type)
}
