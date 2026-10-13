import { test, expect } from '@playwright/test'
import { computeMultiYearDetailed, computeCarryForward } from '../../src/lib/budgetEngine'
import { computeAdvisoryHash } from '../../src/lib/buildSchoolContext'
import { canonicalizePreOpeningTransactions, canonicalizePreOpeningExpenses } from '../../src/lib/preOpening'
import { DEFAULT_ASSUMPTIONS, type SchoolProfile, type StaffingPosition, type BudgetProjection, type StartupFundingSource, type PreOpeningTransaction, type PreOpeningExpense } from '../../src/lib/types'

/**
 * P-UX-19 — harden pre_opening_transactions / pre_opening_expenses at the engine boundary.
 * Sibling of P-UX-18, one layer over: computeCarryForward (budgetEngine.ts:129 tx.amount,
 * :130 e.budgeted) read these raw and crashed on a null entry / silently corrupted on a
 * non-finite numeric. TWO distinct value-preserving canonicalizers (NOT canonicalizeStartupFunding).
 *
 * SEMANTICS (approved): DROP entries that are null / non-object / whose numeric field is not
 * already finite. Do NOT coerce non-finite to 0 (a fabricated 0 line corrupts the sum just like
 * the NaN does). Well-formed entries pass through byte-identical.
 *
 * Run: npx playwright test tests/session4/pre-opening-engine-canonicalizer.spec.ts
 */

const WA_FUNDING: StartupFundingSource[] = [{ source: 'Federal CSP Grant', amount: 350000, type: 'grant', status: 'projected', selectedYears: [0, 1, 2, 3, 4], yearAllocations: { 0: 350000, 1: 0, 2: 0, 3: 0, 4: 0 } }]
const GEN_FUNDING: StartupFundingSource[] = [{ source: 'Founder Donation', amount: 120000, type: 'donation', status: 'received' }]
const tx = (amount: number): PreOpeningTransaction => ({ id: 't' + amount, month: 'mar', description: 'd', amount, expense_category: 'c', created_at: '2026-03-01' })
const exp = (budgeted: number): PreOpeningExpense => ({ id: 'e' + budgeted, name: 'n', budgeted, actual: 0 })

function profile(opts: { funding?: StartupFundingSource[]; txs?: unknown; exps?: unknown } = {}): SchoolProfile {
  return {
    school_id: 'x', region: 'benton_county', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 72, target_enrollment_y2: 96, target_enrollment_y3: 120,
    target_enrollment_y4: 144, target_enrollment_y5: 168, max_class_size: 24,
    pct_frl: 62, pct_iep: 13, pct_ell: 18, pct_hicap: 3, onboarding_complete: true,
    financial_assumptions: {}, retention_rate: 92, opening_grades: ['K', '1', '2'],
    buildout_grades: ['K', '1', '2', '3', '4', '5'],
    pre_opening_expenses: (opts.exps ?? []) as PreOpeningExpense[],
    pre_opening_transactions: (opts.txs ?? []) as PreOpeningTransaction[],
    startup_funding: opts.funding ?? WA_FUNDING,
  } as unknown as SchoolProfile
}
const POSITIONS: StaffingPosition[] = [{ school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 }]
const PROJECTIONS: BudgetProjection[] = [{ school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 120000, is_revenue: false }]
const hashInput = (funding: StartupFundingSource[], txs: unknown = [], exps: unknown = []) => ({ profile: profile({ funding, txs, exps }), positions: POSITIONS, projections: PROJECTIONS, gradeExpansionPlan: [] })

test.describe('P-UX-19 — computeCarryForward no longer crashes/corrupts on malformed pre_opening_*', () => {
  test('null transaction entry: was THROW -> now drops it; value correct', () => {
    let v = NaN
    expect(() => { v = computeCarryForward(profile({ txs: [tx(50000), null] })) }).not.toThrow()
    expect(v).toBe(300000) // year0 350000 - actual spend 50000 (null dropped)
  })

  test('null expense entry: was THROW -> now drops it; value correct', () => {
    let v = NaN
    expect(() => { v = computeCarryForward(profile({ exps: [exp(5000), null] })) }).not.toThrow()
    expect(v).toBe(345000) // no txs -> uses budget 5000 (null dropped); 350000 - 5000
  })

  test('non-finite amount: was masked NaN (wrongly used budget) -> now dropped; value correct', () => {
    // pre-fix: 50000 + 'x' string-concats -> NaN>0 false -> wrongly falls back to budget 9999.
    const v = computeCarryForward(profile({ txs: [tx(50000), { amount: 'x' } as unknown as PreOpeningTransaction], exps: [exp(9999)] }))
    expect(v).toBe(300000) // drops {amount:'x'} -> actual spend 50000 used; 350000 - 50000
  })
})

test.describe('P-UX-19 — canonicalizers value-preserving + drop semantics', () => {
  test('drop null/non-object/non-finite; well-formed pass through byte-identical; idempotent', () => {
    const goodTx = [tx(100), tx(200)]
    expect(canonicalizePreOpeningTransactions(goodTx)).toEqual(goodTx) // no-op
    expect(canonicalizePreOpeningTransactions([tx(100), null, 'x', { amount: 'y' }, { amount: NaN }])).toEqual([tx(100)])
    expect(canonicalizePreOpeningTransactions(canonicalizePreOpeningTransactions(goodTx))).toEqual(goodTx) // idempotent
    expect(canonicalizePreOpeningTransactions(null)).toEqual([])

    const goodExp = [exp(100), exp(200)]
    expect(canonicalizePreOpeningExpenses(goodExp)).toEqual(goodExp)
    expect(canonicalizePreOpeningExpenses([exp(100), null, 'x', { budgeted: 'y' }, { budgeted: Infinity }])).toEqual([exp(100)])
    expect(canonicalizePreOpeningExpenses(canonicalizePreOpeningExpenses(goodExp))).toEqual(goodExp)
    expect(canonicalizePreOpeningExpenses('garbage')).toEqual([])
  })
})

test.describe('P-UX-19 — BYTE-IDENTICAL guards on canonical input', () => {
  test('computeCarryForward pinned: WA 350000 / Generic 120000', () => {
    expect(computeCarryForward(profile({ funding: WA_FUNDING }))).toBe(350000)
    expect(computeCarryForward(profile({ funding: GEN_FUNDING }))).toBe(120000)
  })

  test('computeMultiYearDetailed unchanged: canonicalizer-derived preOpen == literal pin', () => {
    const p = profile({ funding: WA_FUNDING, txs: [tx(50000)], exps: [exp(9999)] })
    const viaEngine = computeMultiYearDetailed(p, POSITIONS, PROJECTIONS, DEFAULT_ASSUMPTIONS, computeCarryForward(p), [], POSITIONS, p.startup_funding)
    const viaPin = computeMultiYearDetailed(p, POSITIONS, PROJECTIONS, DEFAULT_ASSUMPTIONS, 300000, [], POSITIONS, p.startup_funding)
    expect(viaEngine).toEqual(viaPin) // carry-forward (350000 - 50000) unchanged by canonicalization
  })

  test('computeAdvisoryHash UNCHANGED (these fields are not hashed; guard) + pinned baselines', () => {
    // pre_opening_* do not affect the hash: garbage vs canonical -> same hash.
    expect(computeAdvisoryHash(hashInput(WA_FUNDING, [tx(1), null], [exp(2), null]))).toBe(computeAdvisoryHash(hashInput(WA_FUNDING, [], [])))
    // and unchanged vs the P-UX-18 baselines (same fixtures).
    // P-UX-21: the hash prefix now carries PROMPT_VERSION + ENGINE_VERSION; pin the canonical
    // djb2|len discriminator (unchanged by this canonicalizer) via endsWith, robust to engine bumps.
    // PROMPT_VERSION is also inside the canonical JSON, so a prompt bump re-pins these (v4-2026-10).
    expect(computeAdvisoryHash(hashInput(WA_FUNDING)).endsWith('|62893c8a|1599')).toBe(true)
    expect(computeAdvisoryHash(hashInput(GEN_FUNDING)).endsWith('|7e8cb8fc|1561')).toBe(true)
  })
})
