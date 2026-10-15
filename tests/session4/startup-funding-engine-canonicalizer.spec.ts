import { test, expect } from '@playwright/test'
import { computeMultiYearDetailed, computeCarryForward, getGrantRevenueForYear, getGrantAllocationsForYear } from '../../src/lib/budgetEngine'
import { computeAdvisoryHash } from '../../src/lib/buildSchoolContext'
import { canonicalizeStartupFunding } from '../../src/lib/startupFunding'
import { DEFAULT_ASSUMPTIONS, type SchoolProfile, type StaffingPosition, type BudgetProjection, type StartupFundingSource } from '../../src/lib/types'

/**
 * P-UX-18 — harden startup_funding at the engine boundary. Same bug class as P-UX-11
 * (which hardened the advisory-hash canonicalizer) but in the engine's RAW readers:
 * computeCarryForward (the real first crash site, :107), getGrantRevenueForYear (:63),
 * getGrantAllocationsForYear (:85). One shared value-preserving canonicalizeStartupFunding
 * is applied inside all three; the advisory fundingSlice layers its hash projection on top.
 *
 * Byte-identical guards (must STAY green): canonicalization is a strict no-op on canonical
 * input, so computeCarryForward, computeMultiYearDetailed, AND computeAdvisoryHash are
 * unchanged for the 25 canonical prod rows across pathways (cached advisories not
 * invalidated). Baselines pinned from pre-change code.
 *
 * Run: npx playwright test tests/session4/startup-funding-engine-canonicalizer.spec.ts
 */

// Canonical (editor-shaped) fixtures — identical to the baseline-capture run.
const WA_FUNDING: StartupFundingSource[] = [{ source: 'Federal CSP Grant', amount: 350000, type: 'grant', status: 'projected', selectedYears: [0, 1, 2, 3, 4], yearAllocations: { 0: 350000, 1: 0, 2: 0, 3: 0, 4: 0 } }]
const GEN_FUNDING: StartupFundingSource[] = [{ source: 'Founder Donation', amount: 120000, type: 'donation', status: 'received' }]
// Malformed (non-editor) shape: the P-UX-18 threat. A valid grant in Y1 must survive.
const VALID: StartupFundingSource = { source: 'CSP', amount: 300000, type: 'grant', status: 'projected', selectedYears: [1], yearAllocations: { 1: 300000 } }
const MALFORMED = [null, { amount: 'x' }, 'garbage', VALID] as unknown as StartupFundingSource[]

function profile(funding: unknown): SchoolProfile {
  return {
    school_id: 'x', region: 'benton_county', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 72, target_enrollment_y2: 96, target_enrollment_y3: 120,
    target_enrollment_y4: 144, target_enrollment_y5: 168, max_class_size: 24,
    pct_frl: 62, pct_iep: 13, pct_ell: 18, pct_hicap: 3, onboarding_complete: true,
    financial_assumptions: {}, retention_rate: 92, opening_grades: ['K', '1', '2'],
    buildout_grades: ['K', '1', '2', '3', '4', '5'], pre_opening_expenses: [], pre_opening_transactions: [],
    startup_funding: funding as StartupFundingSource[],
  } as unknown as SchoolProfile
}
const POSITIONS: StaffingPosition[] = [{ school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 }]
const PROJECTIONS: BudgetProjection[] = [{ school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 120000, is_revenue: false }]
const hashInput = (funding: unknown) => ({ profile: profile(funding), positions: POSITIONS, projections: PROJECTIONS, gradeExpansionPlan: [] })
// The CSP fixture is modeled as a one-time grant here (R-REV-04 switch off).
const myRun = (funding: unknown) => computeMultiYearDetailed(profile(funding), POSITIONS, PROJECTIONS, { ...DEFAULT_ASSUMPTIONS, csp_operating_revenue: false }, 0, [], POSITIONS, profile(funding).startup_funding)

test.describe('P-UX-18 — engine no longer crashes on malformed startup_funding', () => {
  test('computeCarryForward: no throw, finite, valid entry value preserved', () => {
    let v = NaN
    expect(() => { v = computeCarryForward(profile(MALFORMED)) }).not.toThrow()
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBe(computeCarryForward(profile([VALID]))) // garbage skipped -> same as valid-only
  })

  test('getGrantRevenueForYear / getGrantAllocationsForYear: no throw; valid grant correct; "x" -> 0 not NaN', () => {
    expect(() => getGrantRevenueForYear(MALFORMED, 1)).not.toThrow()
    expect(getGrantRevenueForYear(MALFORMED, 1)).toBe(300000) // only the valid Y1 grant
    expect(Number.isNaN(getGrantRevenueForYear(MALFORMED, 1))).toBe(false)
    expect(() => getGrantAllocationsForYear(MALFORMED, 1)).not.toThrow()
    const allocs = getGrantAllocationsForYear(MALFORMED, 1)
    expect(allocs.length).toBe(1)
    expect(allocs[0].amount).toBe(300000)
  })

  test('computeMultiYearDetailed: no throw, all rows finite, valid grant folded', () => {
    let rows: ReturnType<typeof myRun> | null = null
    expect(() => { rows = myRun(MALFORMED) }).not.toThrow()
    expect(rows!.every(r => Number.isFinite(r.net) && Number.isFinite(r.revenue.grantRevenue))).toBe(true)
    expect(rows![0].revenue.grantRevenue).toBe(300000) // valid Y1 grant survives canonicalization
  })
})

test.describe('P-UX-18 — canonicalizer is value-preserving + cleans garbage', () => {
  test('strict no-op on canonical input (both pathways) + idempotent', () => {
    expect(canonicalizeStartupFunding(WA_FUNDING)).toEqual(WA_FUNDING)
    expect(canonicalizeStartupFunding(GEN_FUNDING)).toEqual(GEN_FUNDING)
    expect(canonicalizeStartupFunding(canonicalizeStartupFunding(WA_FUNDING))).toEqual(WA_FUNDING)
  })

  test('non-array -> []; null/string entries dropped; numeric amount coerced; valid preserved', () => {
    expect(canonicalizeStartupFunding(null)).toEqual([])
    expect(canonicalizeStartupFunding('garbage')).toEqual([])
    const cleaned = canonicalizeStartupFunding(MALFORMED)
    expect(cleaned.every(e => e != null && typeof e === 'object' && Number.isFinite(e.amount))).toBe(true)
    expect(cleaned.some(e => e.source === 'CSP' && e.amount === 300000)).toBe(true) // valid preserved
    expect(cleaned.find(e => e.amount === 0)).toBeTruthy() // {amount:"x"} coerced to 0, not NaN
  })
})

test.describe('P-UX-18 — BYTE-IDENTICAL guards (canonical input unchanged, all pathways)', () => {
  test('computeCarryForward pinned to pre-change baselines', () => {
    expect(computeCarryForward(profile(WA_FUNDING))).toBe(350000)
    expect(computeCarryForward(profile(GEN_FUNDING))).toBe(120000)
  })

  test('computeMultiYearDetailed FULL output unchanged by canonicalization (deep-equal)', () => {
    // raw canonical vs pre-canonicalized funding -> identical engine output (no-op proof).
    expect(myRun(WA_FUNDING)).toEqual(myRun(canonicalizeStartupFunding(WA_FUNDING)))
    expect(myRun(GEN_FUNDING)).toEqual(myRun(canonicalizeStartupFunding(GEN_FUNDING)))
  })

  test('computeAdvisoryHash UNCHANGED — cached advisories not invalidated', () => {
    // P-UX-21: the hash prefix now carries PROMPT_VERSION + ENGINE_VERSION; pin the canonical
    // djb2|len discriminator (unchanged by this canonicalizer) via endsWith, robust to engine bumps.
    // PROMPT_VERSION is also inside the canonical JSON, so a prompt bump re-pins these (v9-2026-10, was 153f611f under v8; the new csp_operating_revenue assumption also changed it).
    expect(computeAdvisoryHash(hashInput(WA_FUNDING)).endsWith('|7634a3a0|1628')).toBe(true)
    expect(computeAdvisoryHash(hashInput(GEN_FUNDING)).endsWith('|6b512f92|1590')).toBe(true)
  })
})
