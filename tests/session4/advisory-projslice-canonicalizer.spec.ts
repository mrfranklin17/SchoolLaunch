import { test, expect } from '@playwright/test'
import { computeAdvisoryHash, ENGINE_HASH_FILES } from '../../src/lib/buildSchoolContext'
import { canonicalizeBudgetProjections } from '../../src/lib/budgetProjections'
import type { SchoolProfile, StaffingPosition, BudgetProjection, StartupFundingSource } from '../../src/lib/types'

/**
 * P-UX-16 — harden the advisory hash `projSlice` (buildSchoolContext.ts:80) against
 * malformed budget_projections. Sibling of P-UX-18 (startup_funding) / P-UX-19 (pre-opening),
 * but a DISTINCT shape: BudgetProjection[]. Threat model is identical — malformed rows arrive
 * via DB seed / import / backfill / CSP fixtures, never the in-app editor.
 *
 * projSlice read raw and had three failure modes:
 *   Mode 1 — null/non-object array element -> TypeError on `r.year` (:82).
 *   Mode 2 — null category/subcategory -> TypeError on `.localeCompare` (:91/:92).
 *   Mode 3 — non-finite amount -> Math.round(NaN)=NaN -> JSON.stringify writes `null`,
 *            silently corrupting BOTH the djb2 hash and the |len discriminator (the
 *            dangerous case — no throw, spurious cache invalidation).
 *
 * One shared value-preserving canonicalizeBudgetProjections is applied at the slice boundary;
 * COERCE semantics (cat/sub -> string, amount -> finite) keep row count stable, mirroring
 * projSlice's existing keep-every-row-and-coerce behavior. Strict no-op on canonical input
 * -> computeAdvisoryHash byte-identical -> cached advisories NOT invalidated.
 *
 * Run: npx playwright test tests/session4/advisory-projslice-canonicalizer.spec.ts
 */

const WA_FUNDING: StartupFundingSource[] = [{ source: 'Federal CSP Grant', amount: 350000, type: 'grant', status: 'projected', selectedYears: [0, 1, 2, 3, 4], yearAllocations: { 0: 350000, 1: 0, 2: 0, 3: 0, 4: 0 } }]
const GEN_FUNDING: StartupFundingSource[] = [{ source: 'Founder Donation', amount: 120000, type: 'donation', status: 'received' }]

function profile(funding: StartupFundingSource[]): SchoolProfile {
  return {
    school_id: 'x', region: 'benton_county', planned_open_year: 2027, grade_config: 'K-5',
    target_enrollment_y1: 72, target_enrollment_y2: 96, target_enrollment_y3: 120,
    target_enrollment_y4: 144, target_enrollment_y5: 168, max_class_size: 24,
    pct_frl: 62, pct_iep: 13, pct_ell: 18, pct_hicap: 3, onboarding_complete: true,
    financial_assumptions: {}, retention_rate: 92, opening_grades: ['K', '1', '2'],
    buildout_grades: ['K', '1', '2', '3', '4', '5'], pre_opening_expenses: [], pre_opening_transactions: [],
    startup_funding: funding,
  } as unknown as SchoolProfile
}
const POSITIONS: StaffingPosition[] = [{ school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 }]

// Canonical (editor-shaped) single projection row — identical to the P-UX-18 baseline-capture run.
const CANON_PROJ: BudgetProjection[] = [{ school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 120000, is_revenue: false }]

// Malformed (non-editor) projections exercising all 3 modes. The valid Facilities row must survive untouched.
const VALID_PROJ: BudgetProjection = { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 120000, is_revenue: false }
const MALFORMED_PROJ = [
  null,                                                                                              // Mode 1: null element
  'garbage',                                                                                         // Mode 1: non-object
  { school_id: 'x', year: 1, category: null, subcategory: 'Insurance', amount: 5000, is_revenue: false },   // Mode 2: null category
  { school_id: 'x', year: 1, category: 'Operations', subcategory: null, amount: 3000, is_revenue: false },  // Mode 2: null subcategory
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Technology', amount: NaN, is_revenue: false },  // Mode 3: NaN amount
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Supplies', amount: 'abc', is_revenue: false },  // Mode 3: string amount
  VALID_PROJ,
] as unknown as BudgetProjection[]
// Hand-cleaned equivalent of MALFORMED_PROJ under the agreed COERCE semantics (null/garbage dropped;
// cat/sub null -> ''; non-finite amount -> 0; valid row preserved). The hash of the malformed input
// MUST equal the hash of this hand-cleaned input — value assertion, not mere no-throw.
const CLEANED_PROJ: BudgetProjection[] = [
  { school_id: 'x', year: 1, category: '', subcategory: 'Insurance', amount: 5000, is_revenue: false },
  { school_id: 'x', year: 1, category: 'Operations', subcategory: '', amount: 3000, is_revenue: false },
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Technology', amount: 0, is_revenue: false },
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Supplies', amount: 0, is_revenue: false },
  VALID_PROJ,
]

const hashInput = (funding: StartupFundingSource[], projections: BudgetProjection[]) =>
  ({ profile: profile(funding), positions: POSITIONS, projections, gradeExpansionPlan: [] })

test.describe('P-UX-16 — advisory hash no longer crashes/corrupts on malformed budget_projections', () => {
  test('computeAdvisoryHash: no throw on all 3 modes; value equals hand-cleaned equivalent', () => {
    let h = ''
    expect(() => { h = computeAdvisoryHash(hashInput(WA_FUNDING, MALFORMED_PROJ)) }).not.toThrow()
    // No masked NaN: a real 4-segment hash, never containing the literal NaN.
    expect(h).toMatch(/^v9-2026-10\|[0-9a-f]{12}\|[0-9a-f]{8}\|\d+$/)
    // Canonicalization == hand-cleaning: malformed input hashes identically to the cleaned input.
    expect(h).toBe(computeAdvisoryHash(hashInput(WA_FUNDING, CLEANED_PROJ)))
  })
})

test.describe('P-UX-16 — canonicalizeBudgetProjections is value-preserving + cleans garbage', () => {
  test('strict no-op on canonical input + idempotent', () => {
    expect(canonicalizeBudgetProjections(CANON_PROJ)).toEqual(CANON_PROJ)
    expect(canonicalizeBudgetProjections(canonicalizeBudgetProjections(CANON_PROJ))).toEqual(CANON_PROJ)
  })

  test('non-array -> []; null/non-object entries dropped; row count stable otherwise', () => {
    expect(canonicalizeBudgetProjections(null)).toEqual([])
    expect(canonicalizeBudgetProjections('garbage')).toEqual([])
    const cleaned = canonicalizeBudgetProjections(MALFORMED_PROJ)
    expect(cleaned.length).toBe(5) // 7 entries minus the 2 null/non-object; no valid row dropped
    expect(cleaned.every(e => e != null && typeof e === 'object'
      && typeof e.category === 'string' && typeof e.subcategory === 'string'
      && Number.isFinite(e.amount))).toBe(true)
  })

  test('Mode 2: null category/subcategory coerced to empty string', () => {
    const cleaned = canonicalizeBudgetProjections(MALFORMED_PROJ)
    expect(cleaned.find(e => e.subcategory === 'Insurance')!.category).toBe('')
    expect(cleaned.find(e => e.category === 'Operations' && e.amount === 3000)!.subcategory).toBe('')
  })

  test('Mode 3: non-finite amount coerced to 0, never NaN (the silent-corruption fix)', () => {
    const cleaned = canonicalizeBudgetProjections(MALFORMED_PROJ)
    expect(cleaned.find(e => e.subcategory === 'Technology')!.amount).toBe(0) // NaN -> 0
    expect(cleaned.find(e => e.subcategory === 'Supplies')!.amount).toBe(0)   // 'abc' -> 0
    expect(cleaned.some(e => Number.isNaN(e.amount))).toBe(false)
  })

  test('valid row preserved exactly (value-preserving)', () => {
    const cleaned = canonicalizeBudgetProjections(MALFORMED_PROJ)
    expect(cleaned.find(e => e.subcategory === 'Facilities')).toEqual(VALID_PROJ)
  })
})

test.describe('P-UX-16 — BYTE-IDENTICAL guards (canonical input unchanged; ENGINE_VERSION not bumped)', () => {
  test('computeAdvisoryHash UNCHANGED on canonical input — cached advisories not invalidated', () => {
    // Pin the djb2|len suffix only: those segments are determined by projSlice CONTENT, not by
    // ENGINE_VERSION, so this pins exactly the P-UX-16 byte-identity invariant and stays green across
    // engine bumps (e.g. P-UX-22). Same canonical fixtures + pins as the P-UX-18 spec. (Still trips on
    // a deliberate PROMPT_VERSION change — rare and intentional: PROMPT_VERSION is part of the
    // canonical JSON. Re-pinned for v9-2026-10; under v8-2026-10 this was 153f611f, under v7 b44a1e9e, under v6-2026-10 2a4c324c / fcd27d3e.)
    expect(computeAdvisoryHash(hashInput(WA_FUNDING, CANON_PROJ)).endsWith('|7634a3a0|1628')).toBe(true)
    expect(computeAdvisoryHash(hashInput(GEN_FUNDING, CANON_PROJ)).endsWith('|6b512f92|1590')).toBe(true)
  })

  test('budgetProjections.ts is NOT in ENGINE_HASH_FILES — advisory-only, never bumps ENGINE_VERSION', () => {
    // Tests the exclusion requirement directly (survives every engine bump), rather than pinning a
    // specific ENGINE_VERSION value. If budgetProjections.ts ever leaks into the hashed set,
    // ENGINE_VERSION changes and every advisory cache invalidates spuriously — the inverse of P-UX-21.
    expect((ENGINE_HASH_FILES as readonly string[]).includes('src/lib/budgetProjections.ts')).toBe(false)
  })
})
