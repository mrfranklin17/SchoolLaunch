import { test, expect } from '@playwright/test'
import { computeAdvisoryHash } from '../../src/lib/buildSchoolContext'
import type { SchoolProfile, StaffingPosition, BudgetProjection, StartupFundingSource } from '../../src/lib/types'

/**
 * P-UX-11 - startup_funding canonicalizer hardening.
 *
 * canonicalizeProjectionInputs (via computeAdvisoryHash) must normalize any
 * startup_funding shape - including ones built outside the Revenue editor - to a
 * canonical serialization WITHOUT throwing, while producing byte-identical output
 * for already-canonical input. Covers the three throw vectors from the diagnosis:
 *   1. non-array top level
 *   2. null / non-object array entries
 *   3. missing / null / numeric `source` (the .localeCompare crash)
 *
 * Run with: npx playwright test tests/session4/startup-funding-canonicalizer.spec.ts
 */

function baseProfile(): SchoolProfile {
  return {
    school_id: '00000000-0000-0000-0000-000000000099',
    region: 'Seattle',
    planned_open_year: 2027,
    grade_config: 'K-5',
    target_enrollment_y1: 150,
    target_enrollment_y2: 200,
    target_enrollment_y3: 250,
    target_enrollment_y4: 300,
    target_enrollment_y5: 350,
    max_class_size: 24,
    pct_frl: 40,
    pct_iep: 12,
    pct_ell: 10,
    pct_hicap: 5,
    onboarding_complete: true,
    financial_assumptions: { regular_ed_per_pupil: 11812, sped_per_pupil: 2548, regionalization_factor: 1.0 },
    startup_funding: [
      { source: 'CSP Grant', amount: 250000, type: 'grant', status: 'pledged' },
    ],
    retention_rate: 0.9,
    opening_grades: ['K', '1', '2'],
    buildout_grades: ['3', '4', '5'],
  }
}

const POSITIONS: StaffingPosition[] = [
  { school_id: 'x', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
]
const PROJECTIONS: BudgetProjection[] = [
  { school_id: 'x', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 180000, is_revenue: false },
]

// Build a hash input whose startup_funding is set to an arbitrary (possibly
// malformed) value. The cast models the JSONB reality: the column is typed
// StartupFundingSource[] but can hold any shape at runtime.
function hashWithFunding(funding: unknown): string {
  const profile = { ...baseProfile(), startup_funding: funding as StartupFundingSource[] | null }
  return computeAdvisoryHash({ profile, positions: POSITIONS, projections: PROJECTIONS, gradeExpansionPlan: null })
}

const GOOD: StartupFundingSource = { source: 'Federal CSP Grant', amount: 100000, type: 'grant', status: 'projected' }

test.describe('P-UX-11 - startup_funding canonicalizer hardening', () => {
  test('byte-identical for already-canonical input (behavior-preserving guard)', () => {
    // Deterministic, and pinned so any drift in canonical serialization trips here.
    const h1 = hashWithFunding([{ source: 'CSP Grant', amount: 250000, type: 'grant', status: 'pledged' }])
    const h2 = hashWithFunding([{ source: 'CSP Grant', amount: 250000, type: 'grant', status: 'pledged' }])
    expect(h1).toBe(h2)
    // P-UX-21: prefix now carries PROMPT_VERSION + ENGINE_VERSION; pin the canonical
    // djb2|len discriminator via endsWith so drift in serialization still trips here.
    // PROMPT_VERSION is also inside the canonical JSON, so a prompt bump re-pins this (v5-2026-10).
    expect(h1.endsWith('|0814e0fd|1535')).toBe(true)
  })

  test('vector 1: non-array top level does not throw and equals empty funding', () => {
    const empty = hashWithFunding([])
    expect(() => hashWithFunding({ 'Federal CSP Grant': 350000 })).not.toThrow()
    expect(hashWithFunding({ 'Federal CSP Grant': 350000 })).toBe(empty) // keyed object
    expect(hashWithFunding('Federal CSP Grant')).toBe(empty)             // scalar string
    expect(hashWithFunding(42)).toBe(empty)                              // scalar number
    expect(hashWithFunding(null)).toBe(empty)                           // genuine garbage / null
  })

  test('vector 2: null / non-object entries are dropped, good siblings preserved', () => {
    const onlyGood = hashWithFunding([GOOD])
    expect(() => hashWithFunding([null, 'ESWA', 123, GOOD])).not.toThrow()
    expect(hashWithFunding([null, 'ESWA', 123, GOOD])).toBe(onlyGood)
  })

  test('vector 3: missing / null source coerces to empty string, no throw', () => {
    const missing = { amount: 100000, type: 'grant', status: 'projected' }
    const nulled = { source: null, amount: 100000, type: 'grant', status: 'projected' }
    expect(() => hashWithFunding([missing])).not.toThrow()
    expect(() => hashWithFunding([nulled])).not.toThrow()
    // A missing source and an explicit null source both normalize to src=''.
    expect(hashWithFunding([missing])).toBe(hashWithFunding([nulled]))
    // And both equal a canonical entry whose source is the empty string.
    expect(hashWithFunding([missing])).toBe(hashWithFunding([{ source: '', amount: 100000, type: 'grant', status: 'projected' }]))
  })

  test('vector 3: numeric source is String()-coerced (preserves the label)', () => {
    const numeric = { source: 12345, amount: 100000, type: 'grant', status: 'projected' }
    expect(() => hashWithFunding([numeric])).not.toThrow()
    // Numeric 12345 serializes identically to the string "12345" - label preserved, not blanked.
    expect(hashWithFunding([numeric])).toBe(hashWithFunding([{ source: '12345', amount: 100000, type: 'grant', status: 'projected' }]))
    expect(hashWithFunding([numeric])).not.toBe(hashWithFunding([{ source: '', amount: 100000, type: 'grant', status: 'projected' }]))
  })

  test('mixed bad+good array (the test-columbia integration shape) does not throw', () => {
    const shape = [
      { source: null, amount: 99999, type: 'grant', status: 'projected', selectedYears: [0], yearAllocations: { '0': 99999 } },
      GOOD,
    ]
    expect(() => hashWithFunding(shape)).not.toThrow()
    // Good sibling survives: result differs from dropping everything to empty.
    expect(hashWithFunding(shape)).not.toBe(hashWithFunding([]))
  })
})
