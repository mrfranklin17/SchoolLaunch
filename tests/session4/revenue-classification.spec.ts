import { test, expect } from '@playwright/test'
import { computeMultiYearDetailed } from '../../src/lib/budgetEngine'
import type { SchoolProfile, StaffingPosition, BudgetProjection, FinancialAssumptions, GradeExpansionEntry, StartupFundingSource } from '../../src/lib/types'
import { DEFAULT_ASSUMPTIONS } from '../../src/lib/types'

/**
 * Suite — Operating Revenue vs Total Revenue semantic invariants (F-006 fix).
 *
 * Validates the one-line fix at budgetEngine.ts:553:
 *   const operatingRevenue = rev.total                   (excludes Interest, Grants)
 *   const totalRevenue = operatingRevenue + interestIncome + yearGrantRevenue
 *
 * The R-ENR-01 retention test pattern: pin specific values that will fail loudly
 * if any future engine change re-conflates Interest with Operating Revenue.
 *
 * Test fixture mirrors Evergreen Heights Charter Academy (Yakima County, K-2
 * founding → K-5 buildout, retention=92, $250K Y0 startup → $3,750 Y1 interest).
 */

const EVERGREEN_PLAN: GradeExpansionEntry[] = [
  // Y1 founding K, 1, 2
  { year: 1, grade_level: 'K', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 1, grade_level: '1', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 1, grade_level: '2', sections: 1, students_per_section: 24, is_new_grade: false },
  // Y2 + grade 3
  { year: 2, grade_level: 'K', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 2, grade_level: '1', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 2, grade_level: '2', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 2, grade_level: '3', sections: 1, students_per_section: 24, is_new_grade: true },
  // Y3 + grade 4
  { year: 3, grade_level: 'K', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 3, grade_level: '1', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 3, grade_level: '2', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 3, grade_level: '3', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 3, grade_level: '4', sections: 1, students_per_section: 24, is_new_grade: true },
  // Y4 + grade 5
  { year: 4, grade_level: 'K', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 4, grade_level: '1', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 4, grade_level: '2', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 4, grade_level: '3', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 4, grade_level: '4', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 4, grade_level: '5', sections: 1, students_per_section: 24, is_new_grade: true },
  // Y5 — buildout complete
  { year: 5, grade_level: 'K', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 5, grade_level: '1', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 5, grade_level: '2', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 5, grade_level: '3', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 5, grade_level: '4', sections: 1, students_per_section: 24, is_new_grade: false },
  { year: 5, grade_level: '5', sections: 1, students_per_section: 24, is_new_grade: false },
]

const EVERGREEN_PROFILE: SchoolProfile = {
  school_id: 'test-evergreen',
  region: 'yakima_county',
  planned_open_year: 2027,
  grade_config: 'K-5',
  target_enrollment_y1: 72,
  target_enrollment_y2: 96,
  target_enrollment_y3: 120,
  target_enrollment_y4: 144,
  target_enrollment_y5: 144,
  max_class_size: 24,
  pct_frl: 45,
  pct_iep: 12,
  pct_ell: 8,
  pct_hicap: 5,
  onboarding_complete: true,
  opening_grades: ['K', '1', '2'],
  buildout_grades: ['K', '1', '2', '3', '4', '5'],
  retention_rate: 92,
}

// Evergreen onboarding-time staffing (6 positions for K-2 / 72 students)
const EVERGREEN_POSITIONS: StaffingPosition[] = [
  { school_id: 'test-evergreen', year: 1, title: 'CEO/Executive Director', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'ceo_director', driver: 'fixed', students_per_position: 0, classification: 'Administrative' },
  { school_id: 'test-evergreen', year: 1, title: 'Principal/Head of School', category: 'admin', fte: 1, annual_salary: 95000, position_type: 'principal', driver: 'fixed', students_per_position: 0, classification: 'Administrative' },
  { school_id: 'test-evergreen', year: 1, title: 'Classroom Teacher - Elementary', category: 'certificated', fte: 3, annual_salary: 58000, position_type: 'teacher_elem', driver: 'per_pupil_elem', students_per_position: 24, classification: 'Certificated' },
  { school_id: 'test-evergreen', year: 1, title: 'Special Education (SPED) Teacher', category: 'certificated', fte: 1, annual_salary: 62000, position_type: 'sped_teacher', driver: 'per_pupil_sped', students_per_position: 12, classification: 'Certificated' },
  { school_id: 'test-evergreen', year: 1, title: 'Administrative Assistant/Office Manager', category: 'classified', fte: 1, annual_salary: 52000, position_type: 'office_mgr', driver: 'fixed', students_per_position: 0, classification: 'Classified' },
  { school_id: 'test-evergreen', year: 1, title: 'Instructional Aides/Paraeducators', category: 'classified', fte: 1, annual_salary: 38000, position_type: 'paraeducator', driver: 'per_pupil', students_per_position: 48, classification: 'Classified' },
]

const EVERGREEN_ASSUMPTIONS: FinancialAssumptions = {
  ...DEFAULT_ASSUMPTIONS,
  food_service_offered: true,
  transportation_offered: false,
  regionalization_factor: 1.0, // Yakima
  facilities_per_pupil: 0, // estimate-for-me ON
}

const EVERGREEN_PROJECTIONS: BudgetProjection[] = [
  { school_id: 'test-evergreen', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 153864, is_revenue: false },
]

const EVERGREEN_STARTUP: StartupFundingSource[] = [
  {
    source: 'Federal CSP Grant',
    amount: 250000,
    type: 'grant',
    status: 'projected',
    selectedYears: [0, 1, 2, 3, 4],
    yearAllocations: { 0: 250000, 1: 0, 2: 0, 3: 0, 4: 0 },
  },
]

test.describe('F-006: Operating Revenue excludes Interest & Grants', () => {
  // preOpeningNet = Y0 startup ($250K Federal CSP Grant) - Y0 expenses ($0) = $250,000
  // This becomes priorCash for Y1 interest computation: $250,000 × 3% / 2 = $3,750
  const multiYear = computeMultiYearDetailed(
    EVERGREEN_PROFILE,
    EVERGREEN_POSITIONS,
    EVERGREEN_PROJECTIONS,
    EVERGREEN_ASSUMPTIONS,
    250000, // preOpeningNet — Y0 startup carry-forward
    EVERGREEN_PLAN,
    undefined, // allPositions
    EVERGREEN_STARTUP,
  )

  test('Evergreen Y1 Operating Revenue = $1,076,886 (excludes Interest)', () => {
    expect(multiYear[0].revenue.operatingRevenue).toBe(1076886)
  })

  test('Evergreen Y1 Interest & Other Income = $3,750', () => {
    expect(multiYear[0].revenue.interestIncome).toBe(3750)
  })

  test('Evergreen Y1 Total Revenue = $1,080,636 = operatingRevenue + interestIncome + grants', () => {
    const row = multiYear[0]
    expect(row.revenue.total).toBe(1080636)
    expect(row.revenue.total).toBe(row.revenue.operatingRevenue + row.revenue.interestIncome + row.revenue.grantRevenue)
  })

  test('Evergreen Y1 grants = $0 (Y0-only allocation)', () => {
    expect(multiYear[0].revenue.grantRevenue).toBe(0)
  })

  test('Cross-year invariant: total = operatingRevenue + interestIncome + grantRevenue for all 5 years', () => {
    for (const row of multiYear) {
      expect(row.revenue.total).toBe(row.revenue.operatingRevenue + row.revenue.interestIncome + row.revenue.grantRevenue)
    }
  })

  test('Operating Revenue never includes Interest (regression guard against re-conflation)', () => {
    for (const row of multiYear) {
      // If a future engine change reverts the fix, operatingRevenue will = total
      // (no longer < total by exactly interestIncome). This test fires then.
      if (row.revenue.interestIncome > 0) {
        expect(row.revenue.operatingRevenue).toBeLessThan(row.revenue.total)
        expect(row.revenue.total - row.revenue.operatingRevenue).toBe(row.revenue.interestIncome + row.revenue.grantRevenue)
      }
    }
  })

  test('operating vs total revenue denominators — structural guard', () => {
    // After F-006, operatingRevenue excludes interest, so a ratio over operatingRevenue is
    // MORE positive than over total revenue (for positive net). FPF-01: the FPF Total Margin
    // itself uses total revenue (the Commission's Net Income ÷ Total Revenue).
    for (const row of multiYear) {
      if (row.net <= 0) continue // only validates the favorable-direction invariant
      if (row.revenue.interestIncome <= 0) continue
      const marginAgainstOperating = (row.net / row.revenue.operatingRevenue) * 100
      const marginAgainstTotal = (row.net / row.revenue.total) * 100
      expect(marginAgainstOperating).toBeGreaterThan(marginAgainstTotal)
      // The gap is bounded by interestIncome / operatingRevenue
      const expectedGap = (row.net * row.revenue.interestIncome) / (row.revenue.operatingRevenue * row.revenue.total) * 100
      expect(marginAgainstOperating - marginAgainstTotal).toBeCloseTo(expectedGap, 5)
    }
  })
})
