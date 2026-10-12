import { test, expect } from '@playwright/test'
import { computeAdvisoryHash } from '../../src/lib/buildSchoolContext'
import { calcCommissionRevenue } from '../../src/lib/calculations'
import {
  getAssumptions,
  ASSUMPTIONS_VERSION_KEY,
  CURRENT_ASSUMPTIONS_VERSION,
  type FinancialAssumptions,
  type SchoolProfile,
} from '../../src/lib/types'

/**
 * Phase 1 review finding REV-2 — getAssumptions remaps retired default rates (LAP 690/400,
 * HiCap 625/500, IDEA 2200, SPED 4500/10900, Levy Equity 1500, Regular Ed 11000/12000).
 * Once founders can type these rates in Settings, a remap would silently override an
 * explicit entry. Settings saves now write ASSUMPTIONS_VERSION_KEY; rows carrying it are
 * honored as-is, rows without it keep the legacy remaps (so no existing school's numbers
 * change). The marker must stay out of the advisory/scenario hash.
 *
 * P-UX-26 — on a marker row an explicit $0 categorical/federal rate excludes the line; on a
 * legacy row a 0 still resolves to the default.
 *
 * Run with: npx playwright test tests/session4/assumptions-version.spec.ts
 */

const LEGACY: Partial<FinancialAssumptions> = {
  lap_per_pupil: 690,
  hicap_per_pupil: 500,
  idea_per_pupil: 2200,
  sped_per_pupil: 4500,
  levy_equity_per_student: 1500,
  regular_ed_per_pupil: 12000,
}

function confirmed(raw: Partial<FinancialAssumptions>): Partial<FinancialAssumptions> {
  return { ...raw, [ASSUMPTIONS_VERSION_KEY]: CURRENT_ASSUMPTIONS_VERSION } as Partial<FinancialAssumptions>
}

function profileWith(fa: Partial<FinancialAssumptions>): SchoolProfile {
  return {
    school_id: '00000000-0000-0000-0000-000000000077',
    region: 'Seattle',
    planned_open_year: 2027,
    grade_config: 'K-5',
    target_enrollment_y1: 150,
    target_enrollment_y2: 200,
    target_enrollment_y3: 250,
    target_enrollment_y4: 300,
    target_enrollment_y5: 350,
    max_class_size: 24,
    pct_frl: 55,
    pct_iep: 12,
    pct_ell: 10,
    pct_hicap: 5,
    onboarding_complete: true,
    financial_assumptions: fa as FinancialAssumptions,
    startup_funding: [],
    retention_rate: 0.92,
    opening_grades: ['K', '1', '2'],
    buildout_grades: ['3', '4', '5'],
  }
}

function hash(fa: Partial<FinancialAssumptions>): string {
  return computeAdvisoryHash({ profile: profileWith(fa), positions: [], projections: [], gradeExpansionPlan: null })
}

test.describe('REV-2 — founder-confirmed rates are not remapped', () => {
  test('rows without the marker keep the legacy remaps (existing schools unchanged)', () => {
    const fa = getAssumptions(LEGACY)
    expect(fa.lap_per_pupil).toBe(816)
    expect(fa.hicap_per_pupil).toBe(730)
    expect(fa.idea_per_pupil).toBe(1500)
    expect(fa.sped_per_pupil).toBe(2548)
    expect(fa.levy_equity_per_student).toBe(0)
    expect(fa.regular_ed_per_pupil).toBe(11812)
    expect(fa.per_pupil_rate).toBe(11812)
  })

  test('rows with the marker keep exactly what the founder entered', () => {
    const fa = getAssumptions(confirmed(LEGACY))
    expect(fa.lap_per_pupil).toBe(690)
    expect(fa.hicap_per_pupil).toBe(500)
    expect(fa.idea_per_pupil).toBe(2200)
    expect(fa.sped_per_pupil).toBe(4500)
    expect(fa.levy_equity_per_student).toBe(1500)
    expect(fa.regular_ed_per_pupil).toBe(12000)
    expect(fa.per_pupil_rate).toBe(12000)
  })

  test('missing rates fall back to defaults with or without the marker', () => {
    for (const raw of [{}, confirmed({})]) {
      const fa = getAssumptions(raw)
      expect(fa.title_i_per_pupil).toBe(880)
      expect(fa.idea_per_pupil).toBe(1500)
      expect(fa.lap_per_pupil).toBe(816)
      expect(fa.lap_high_poverty_per_pupil).toBe(374)
      expect(fa.tbip_per_pupil).toBe(1600)
      expect(fa.hicap_per_pupil).toBe(730)
      expect(fa.state_sped_per_pupil).toBe(13556)
      expect(fa.regionalization_factor).toBe(1.0)
    }
  })

  // P-UX-26: a founder can enter $0 in Settings to exclude a categorical/federal line.
  const ZERO_RATES = {
    state_sped_per_pupil: 0, lap_per_pupil: 0, lap_high_poverty_per_pupil: 0, tbip_per_pupil: 0,
    hicap_per_pupil: 0, title_i_per_pupil: 0, idea_per_pupil: 0,
  }

  test('P-UX-26: an explicit $0 on a marker row is honored', () => {
    const fa = getAssumptions(confirmed(ZERO_RATES))
    for (const k of Object.keys(ZERO_RATES)) expect(fa[k as keyof FinancialAssumptions]).toBe(0)
    expect(getAssumptions(fa)).toEqual(fa) // idempotent: the marker is carried through
  })

  test('P-UX-26: a $0 on a legacy row (no marker) still resolves to the default', () => {
    const fa = getAssumptions(ZERO_RATES)
    expect(fa.state_sped_per_pupil).toBe(13556)
    expect(fa.lap_per_pupil).toBe(816)
    expect(fa.lap_high_poverty_per_pupil).toBe(374)
    expect(fa.tbip_per_pupil).toBe(1600)
    expect(fa.hicap_per_pupil).toBe(730)
    expect(fa.title_i_per_pupil).toBe(880)
    expect(fa.idea_per_pupil).toBe(1500)
  })

  test('P-UX-26: null or non-numeric rates resolve to the default even on a marker row', () => {
    const fa = getAssumptions(confirmed({ title_i_per_pupil: null, idea_per_pupil: 'abc' } as unknown as Partial<FinancialAssumptions>))
    expect(fa.title_i_per_pupil).toBe(880)
    expect(fa.idea_per_pupil).toBe(1500)
  })

  test('P-UX-26: a confirmed $0 removes the line from revenue and changes the hash', () => {
    const fa = getAssumptions(confirmed({ title_i_per_pupil: 0, idea_per_pupil: 0 }))
    const rev = calcCommissionRevenue(150, 55, 12, 10, 5, fa)
    expect(rev.titleI).toBe(0)
    expect(rev.idea).toBe(0)
    expect(calcCommissionRevenue(150, 55, 12, 10, 5, getAssumptions({})).titleI).toBeGreaterThan(0)
    expect(hash(confirmed({ title_i_per_pupil: 0 }))).not.toBe(hash({ title_i_per_pupil: 0 }))
    expect(hash({ title_i_per_pupil: 0 })).toBe(hash({}))
  })

  test('older or malformed marker values are treated as unconfirmed', () => {
    expect(getAssumptions({ ...LEGACY, [ASSUMPTIONS_VERSION_KEY]: 1 } as Partial<FinancialAssumptions>).idea_per_pupil).toBe(1500)
    expect(getAssumptions({ ...LEGACY, [ASSUMPTIONS_VERSION_KEY]: 'x' } as Partial<FinancialAssumptions>).idea_per_pupil).toBe(1500)
  })

  test('the marker itself never changes the advisory hash', () => {
    const rates = { regular_ed_per_pupil: 11812, sped_per_pupil: 2548, lap_per_pupil: 816 }
    expect(hash(confirmed(rates))).toBe(hash(rates))
  })

  test('a Settings save of a legacy row (remapped values + marker) keeps the same hash', () => {
    // Settings now loads getAssumptions(raw) and saves it back with the marker; the effective
    // rates are identical, so cached briefings and scenarios must not be invalidated.
    const resaved = confirmed(getAssumptions(LEGACY))
    expect(hash(resaved)).toBe(hash(LEGACY))
  })

  test('an explicit confirmed rate that differs from the remap does change the hash', () => {
    expect(hash(confirmed(LEGACY))).not.toBe(hash(LEGACY))
  })
})
