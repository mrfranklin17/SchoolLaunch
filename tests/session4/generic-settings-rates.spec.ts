import { test, expect } from '@playwright/test'
import { computeGenericProjections, runProjections, type ProjectionInputs } from '../../src/lib/budgetEngine'
import { getStateConfig, withPathwayAuthorizerFee, type Pathway } from '../../src/lib/stateConfig'
import { ASSUMPTIONS_VERSION_KEY, CURRENT_ASSUMPTIONS_VERSION, DEFAULT_ASSUMPTIONS, getAssumptions, type BudgetProjection, type SchoolProfile, type StaffingPosition } from '../../src/lib/types'

/**
 * BP1-FU-01 — the generic engine honors the Settings rates it shows: salary and operations
 * escalators, revenue COLA and, on generic_charter, the authorizer fee. Fixed-fee pathways keep
 * the pathway's fee whatever is stored, and generic_charter keeps its default (0%, the fee
 * onboarding quotes) until the founder saves Settings, so no school's numbers move unless its
 * founder set a rate.
 *
 * Run: npx playwright test tests/session4/generic-settings-rates.spec.ts
 */

const GENERIC: Pathway[] = ['generic_charter', 'generic_private', 'generic_micro']

const POSITIONS: StaffingPosition[] = [
  { school_id: 's', year: 1, title: 'Executive Director', category: 'admin', fte: 1, annual_salary: 110000, position_type: 'executive_director', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 's', year: 1, title: 'Teacher', category: 'certificated', fte: 6, annual_salary: 60000, position_type: 'teacher_elem', classification: 'Instructional', driver: 'per_pupil', students_per_position: 22 },
]
const PROJECTIONS: BudgetProjection[] = [
  ['Facilities', 150000], ['Supplies & Materials', 24000], ['Insurance', 15000],
].map(([sub, amount]) => ({ school_id: 's', year: 1, category: 'Operations', subcategory: sub as string, amount: amount as number, is_revenue: false }))

/** Flat enrollment, so year-over-year changes come from the rates alone. */
function profile(fa: Record<string, unknown> = {}): SchoolProfile {
  return {
    school_id: 's', region: 'Portland', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 120, target_enrollment_y2: 120, target_enrollment_y3: 120, target_enrollment_y4: 120, target_enrollment_y5: 120,
    max_class_size: 24, pct_frl: 55, pct_iep: 12, pct_ell: 10, pct_hicap: 5,
    onboarding_complete: true, retention_rate: 100,
    financial_assumptions: fa,
    startup_funding: [],
    custom_revenue_lines: [{ key: 'per_pupil_funding', label: 'Per-Pupil Funding', amount: 1_320_000 }],
    tuition_rate: 14000, financial_aid_pct: 0.1,
  } as unknown as SchoolProfile
}

function run(pathway: Pathway, fa: Record<string, unknown> = {}) {
  const p = profile(fa)
  const i: ProjectionInputs = { pathway, profile: p, positions: POSITIONS, projections: PROJECTIONS, assumptions: getAssumptions(p.financial_assumptions), preOpenCash: 250000, gradeExpansionPlan: [], allPositions: POSITIONS, startupFunding: [] }
  return runProjections(i)
}

const confirmed = (fa: Record<string, unknown>) => ({ ...fa, [ASSUMPTIONS_VERSION_KEY]: CURRENT_ASSUMPTIONS_VERSION })

test.describe('defaults match the old fixed rates', () => {
  test('each generic pathway’s built-in escalators equal the Settings defaults', () => {
    for (const pathway of GENERIC) {
      const c = getStateConfig(pathway)
      expect(DEFAULT_ASSUMPTIONS.salary_escalator_pct / 100).toBeCloseTo(c.salary_escalator, 10)
      expect(DEFAULT_ASSUMPTIONS.ops_escalator_pct / 100).toBeCloseTo(c.operations_escalator, 10)
      expect(DEFAULT_ASSUMPTIONS.revenue_cola_pct / 100).toBeCloseTo(c.revenue_escalator, 10)
    }
  })

  test('a school with the signup defaults (WA 3% fee stored, never saved Settings) pays the pathway fee', () => {
    for (const pathway of GENERIC) {
      const rows = run(pathway, { authorizer_fee_pct: 3 })
      const fee = getStateConfig(pathway).authorizer_fee
      rows.forEach((r) => expect(r.operations.authorizerFee).toBe(Math.round(r.revenue.operatingRevenue * fee)))
    }
  })
})

test.describe('Settings rates are honored', () => {
  for (const pathway of GENERIC) {
    test(`${pathway}: salary escalator, operations escalator and revenue COLA`, () => {
      const base = run(pathway)
      const custom = run(pathway, { salary_escalator_pct: 5, ops_escalator_pct: 4, revenue_cola_pct: 1 })
      // Year 1 doesn't escalate.
      expect(custom[0].personnel.totalSalaries).toBe(base[0].personnel.totalSalaries)
      expect(custom[0].revenue.operatingRevenue).toBe(base[0].revenue.operatingRevenue)
      // Year 3 = two years of escalation, at the founder's rate instead of the default.
      expect(custom[2].personnel.totalSalaries / base[2].personnel.totalSalaries).toBeCloseTo((1.05 / 1.025) ** 2, 3)
      expect(custom[2].operations.insurance / base[2].operations.insurance).toBeCloseTo((1.04 / 1.02) ** 2, 3)
      expect(custom[2].revenue.operatingRevenue / base[2].revenue.operatingRevenue).toBeCloseTo((1.01 / 1.03) ** 2, 3)
    })
  }

  test('generic_charter: a fee the founder saved in Settings applies', () => {
    const rows = run('generic_charter', confirmed({ authorizer_fee_pct: 4 }))
    rows.forEach((r) => expect(r.operations.authorizerFee).toBe(Math.round(r.revenue.operatingRevenue * 0.04)))
    expect(rows[0].operations.authorizerFee).toBeGreaterThan(0)
  })

  test('fixed-fee pathways ignore a stored fee, saved or not', () => {
    for (const pathway of ['generic_private', 'generic_micro'] as Pathway[]) {
      const rows = run(pathway, confirmed({ authorizer_fee_pct: 4 }))
      rows.forEach((r) => expect(r.operations.authorizerFee).toBe(0))
    }
  })

  test('computeGenericProjections reads the profile when no assumptions are passed', () => {
    const p = profile(confirmed({ salary_escalator_pct: 5, authorizer_fee_pct: 4 }))
    const direct = computeGenericProjections(p, POSITIONS, PROJECTIONS, getStateConfig('generic_charter'), 250000, [], POSITIONS, [])
    expect(direct).toEqual(run('generic_charter', confirmed({ salary_escalator_pct: 5, authorizer_fee_pct: 4 })))
  })
})

test.describe('withPathwayAuthorizerFee', () => {
  const fa = (raw: Record<string, unknown>) => getAssumptions(raw)

  test('WA: always the Commission’s 3%', () => {
    const wa = getStateConfig('wa_charter')
    expect(withPathwayAuthorizerFee(fa({ authorizer_fee_pct: 5 }), wa).authorizer_fee_pct).toBe(3)
    expect(withPathwayAuthorizerFee(fa(confirmed({ authorizer_fee_pct: 5 })), wa).authorizer_fee_pct).toBe(3)
  })

  test('generic_charter: the pathway default until Settings is saved, then the saved value', () => {
    const gc = getStateConfig('generic_charter')
    expect(withPathwayAuthorizerFee(fa({ authorizer_fee_pct: 3 }), gc).authorizer_fee_pct).toBe(gc.authorizer_fee * 100)
    expect(withPathwayAuthorizerFee(fa(confirmed({ authorizer_fee_pct: 3 })), gc).authorizer_fee_pct).toBe(3)
    expect(withPathwayAuthorizerFee(fa(confirmed({ authorizer_fee_pct: 0 })), gc).authorizer_fee_pct).toBe(0)
  })

  test('leaves every other rate alone', () => {
    const before = fa(confirmed({ salary_escalator_pct: 4, interest_rate_on_cash: 5 }))
    const after = withPathwayAuthorizerFee(before, getStateConfig('generic_private'))
    expect({ ...after, authorizer_fee_pct: before.authorizer_fee_pct }).toEqual(before)
  })
})
