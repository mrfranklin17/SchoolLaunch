import { test, expect } from '@playwright/test'
import {
  computeAdvisoryHash,
  hashProjectionInputs,
  PROMPT_VERSION,
  buildSchoolContextString,
  buildAgentContextString,
  year1MonthlyCash,
} from '../../src/lib/buildSchoolContext'
import {
  runProjections,
  computeCarryForward,
  computeFPFScorecard,
  personnelPctOfRevenue,
  facilityPctOfRevenue,
  breakEvenEnrollment,
  beginningCashOf,
} from '../../src/lib/budgetEngine'
import { evaluateDaysOfCash } from '../../src/lib/healthThresholds'
import { getAssumptions, ASSUMPTIONS_VERSION_KEY, CURRENT_ASSUMPTIONS_VERSION } from '../../src/lib/types'
import type { SchoolProfile, StaffingPosition, BudgetProjection, GradeExpansionEntry, FinancialAssumptions } from '../../src/lib/types'

/**
 * Suite 6 — Advisory / scenario-staleness hash (Session 4, Track A1 / A2, AUDIT 5.2 & 6.2).
 *
 * Pure-function contract tests. These do not require a running dev server or
 * Supabase — they exercise `computeAdvisoryHash` directly and assert that every
 * input that feeds `computeMultiYearDetailed` changes the hash.
 */

function baseProfile(): SchoolProfile {
  return {
    school_id: '00000000-0000-0000-0000-000000000001',
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
    financial_assumptions: {
      regular_ed_per_pupil: 11812,
      sped_per_pupil: 2548,
      regionalization_factor: 1.0,
      salary_escalator_pct: 2.5,
    },
    startup_funding: [
      { source: 'CSP Grant', amount: 250000, type: 'grant', status: 'pledged' },
    ],
    retention_rate: 0.9,
    opening_grades: ['K', '1', '2'],
    buildout_grades: ['3', '4', '5'],
  }
}

function basePositions(): StaffingPosition[] {
  return [
    { school_id: '00000000-0000-0000-0000-000000000001', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
    { school_id: '00000000-0000-0000-0000-000000000001', year: 1, title: 'Teacher K', category: 'certificated', fte: 6, annual_salary: 80000, position_type: 'teacher_elem', classification: 'Instructional', driver: 'per_pupil_elem', students_per_position: 24 },
    { school_id: '00000000-0000-0000-0000-000000000001', year: 2, title: 'Teacher K', category: 'certificated', fte: 8, annual_salary: 82000, position_type: 'teacher_elem', classification: 'Instructional', driver: 'per_pupil_elem', students_per_position: 24 },
  ]
}

function baseProjections(): BudgetProjection[] {
  return [
    { school_id: '00000000-0000-0000-0000-000000000001', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 180000, is_revenue: false },
    { school_id: '00000000-0000-0000-0000-000000000001', year: 1, category: 'Operations', subcategory: 'Supplies', amount: 30000, is_revenue: false },
  ]
}

function baseGep(): GradeExpansionEntry[] {
  return [
    { year: 1, grade_level: 'K', sections: 2, students_per_section: 25, is_new_grade: true },
    { year: 1, grade_level: '1', sections: 2, students_per_section: 25, is_new_grade: true },
  ]
}

function baseInput() {
  return { profile: baseProfile(), positions: basePositions(), projections: baseProjections(), gradeExpansionPlan: baseGep() }
}

test.describe('Suite 6 — Advisory/scenario hash (A1 + A2)', () => {
  test('baseline is deterministic and includes PROMPT_VERSION', () => {
    const h1 = computeAdvisoryHash(baseInput())
    const h2 = computeAdvisoryHash(baseInput())
    expect(h1).toBe(h2)
    expect(h1.startsWith(`${PROMPT_VERSION}|`)).toBe(true)
  })

  test('hashProjectionInputs is an alias of computeAdvisoryHash', () => {
    expect(hashProjectionInputs(baseInput())).toBe(computeAdvisoryHash(baseInput()))
  })

  test('driver change invalidates hash (AUDIT 5.2 core regression)', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.positions[1].driver = 'fixed' // was 'per_pupil_elem'
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('classification change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.positions[0].classification = 'Instructional'
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('position_type change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.positions[0].position_type = 'asst_principal'
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('students_per_position change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.positions[1].students_per_position = 20
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('Y2 staffing change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.positions[2].fte = 10 // was 8, Y2 teacher
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('staffing salary edit invalidates hash (AUDIT 6.2 core regression)', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.positions[1].annual_salary = 85000 // was 80000
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('nested financial_assumptions change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.profile.financial_assumptions = {
      ...modified.profile.financial_assumptions,
      salary_escalator_pct: 3.5, // nested key, not caught by old hash
    }
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('regionalization_factor change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.profile.financial_assumptions = {
      ...modified.profile.financial_assumptions,
      regionalization_factor: 1.15,
    }
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('demographics (pct_frl) change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.profile.pct_frl = 55
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('Y2-Y5 enrollment change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.profile.target_enrollment_y4 = 325
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('retention_rate change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.profile.retention_rate = 0.85
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('grade expansion change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.gradeExpansionPlan[0].students_per_section = 30
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('startup_funding change invalidates hash', () => {
    const base = baseInput()
    const modified = baseInput()
    modified.profile.startup_funding = [
      { source: 'CSP Grant', amount: 300000, type: 'grant', status: 'pledged' },
    ]
    expect(computeAdvisoryHash(modified)).not.toBe(computeAdvisoryHash(base))
  })

  test('position reordering does NOT change hash (canonicalization)', () => {
    const base = baseInput()
    const reordered = baseInput()
    reordered.positions = [reordered.positions[2], reordered.positions[0], reordered.positions[1]]
    expect(computeAdvisoryHash(reordered)).toBe(computeAdvisoryHash(base))
  })

  test('projection reordering does NOT change hash (canonicalization)', () => {
    const base = baseInput()
    const reordered = baseInput()
    reordered.projections = [reordered.projections[1], reordered.projections[0]]
    expect(computeAdvisoryHash(reordered)).toBe(computeAdvisoryHash(base))
  })

  test('old-format hash (r:…|p:…|…) cleanly mismatches new hash', () => {
    const newHash = computeAdvisoryHash(baseInput())
    const oldFormat = 'r:1770000|p:640000|o:210000|e:150|s:15'
    expect(newHash).not.toBe(oldFormat)
    expect(newHash.startsWith('r:')).toBe(false)
  })
})

/**
 * Phase 2 (one source of truth): the AI context builders read every Year-N number from the
 * engine rows (the same rows the dashboard shows) and every Days of Cash verdict from
 * healthThresholds.ts. PROMPT_VERSION covers this prose, so these pin the contract.
 */
test.describe('Phase 2 — AI context reads the engine rows', () => {
  const Y1_POSITIONS = () => basePositions().filter((p) => p.year === 1)
  const rowsFor = (profile: SchoolProfile, pathway?: string) => runProjections({
    pathway,
    profile,
    positions: Y1_POSITIONS(),
    projections: baseProjections(),
    assumptions: getAssumptions(profile.financial_assumptions),
    preOpenCash: computeCarryForward(profile),
    gradeExpansionPlan: baseGep(),
    allPositions: Y1_POSITIONS(),
    startupFunding: profile.startup_funding,
  })
  const usd = (n: number) => `$${n.toLocaleString()}`

  test('school context KEY METRICS and multi-year cash are the engine row values', () => {
    const profile = baseProfile()
    const rows = rowsFor(profile)
    const y1 = rows[0]
    const ctx = buildSchoolContextString('Test School', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows, computeFPFScorecard(rows, computeCarryForward(profile), false))
    expect(ctx).toContain(`Personnel % of Operating Revenue: ${personnelPctOfRevenue(y1).toFixed(1)}%`)
    expect(ctx).toContain(`Facility % of Operating Revenue: ${facilityPctOfRevenue(y1).toFixed(1)}%`)
    expect(ctx).toContain(`Break-Even Enrollment: ${breakEvenEnrollment(y1)} students (target: ${y1.enrollment})`)
    expect(ctx).toContain(`Days of Cash (Year 1): ${y1.reserveDays} days`)
    expect(ctx).toContain(`Operating Revenue (recurring, excludes interest and grants): ${usd(y1.revenue.operatingRevenue)}`)
    expect(ctx).toContain(`Total Revenue (including interest and one-time grants): ${usd(y1.revenue.total)}`)
    for (const r of rows) expect(ctx).toContain(`Ending Cash ${usd(r.endingCash)}, ${r.reserveDays} days cash`)
  })

  test('agent context cash figures and Days of Cash verdicts come from the row and healthThresholds', () => {
    const profile = baseProfile()
    const rows = rowsFor(profile)
    const y1 = rows[0]
    const y5 = rows[rows.length - 1]
    const ctx = buildAgentContextString('Test School', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows)
    expect(ctx).toContain(`Beginning Cash: ${usd(beginningCashOf(y1))}`)
    expect(ctx).toContain(`Ending Cash: ${usd(y1.endingCash)}`)
    expect(ctx).toContain(`End of Year 1: ${evaluateDaysOfCash(y1.reserveDays, 1).long}`)
    expect(ctx).toContain(evaluateDaysOfCash(y5.reserveDays, y5.year).long)
    expect(ctx).toContain('CATEGORICAL GRANT REVENUE')
  })

  test('both contexts carry Year 1 month-end cash from the Cash Flow model', () => {
    const profile = baseProfile()
    const rows = rowsFor(profile)
    const m = year1MonthlyCash(rows[0])
    expect(m.cashFlow.startingCash).toBe(beginningCashOf(rows[0]))
    expect(m.points).toHaveLength(12)
    const low = m.lowest!
    const ctx = buildSchoolContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows)
    expect(ctx).toContain('YEAR 1 MONTHLY CASH')
    expect(ctx).toContain('OSPI apportionment schedule (Sep 9%, Oct 8%, Nov 5%')
    for (const mo of m.cashFlow.months) expect(ctx).toContain(`- ${mo.month}: in ${usd(mo.totalInflow)}`)
    for (const mo of m.cashFlow.months) expect(ctx).toContain(`month-end cash ${usd(mo.cumulativeBalance)}`)
    expect(ctx).toContain(`Lowest month-end cash: ${usd(low.balance)} in ${low.month}`)
    expect(ctx).toContain(`30-day target = ${usd(Math.round(m.lines[0].dollars))}; 21-day floor`)
    expect(ctx).toContain('Smallest scheduled payments: Nov, May')
    const agent = buildAgentContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows)
    expect(agent).toContain(`Lowest month-end cash is ${usd(low.balance)} in ${low.month}`)
  })

  test('P-UX-22: the engine skips null / non-object projection entries', () => {
    const profile = baseProfile()
    for (const pathway of ['wa_charter', 'generic_private']) {
      const clean = rowsFor(profile, pathway)
      const dirty = runProjections({
        pathway,
        profile,
        positions: Y1_POSITIONS(),
        projections: [null, ...baseProjections(), 42, 'x'] as unknown as BudgetProjection[],
        assumptions: getAssumptions(profile.financial_assumptions),
        preOpenCash: computeCarryForward(profile),
        gradeExpansionPlan: baseGep(),
        allPositions: Y1_POSITIONS(),
        startupFunding: profile.startup_funding,
      })
      expect(dirty).toEqual(clean)
    }
  })

  test('generic pathway month-end cash uses its own schedule and band', () => {
    const profile = baseProfile()
    const rows = rowsFor(profile, 'generic_private')
    const m = year1MonthlyCash(rows[0], 'generic_private')
    expect(m.cashFlow.usesOspiSchedule).toBe(false)
    expect(m.lines[0].days).toBe(60)
    const ctx = buildSchoolContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), undefined, undefined, 'generic_private')
    expect(ctx).toContain('YEAR 1 MONTHLY CASH')
    expect(ctx).not.toContain('OSPI apportionment schedule')
    expect(ctx).toContain(`60-day target = ${usd(Math.round(m.lines[0].dollars))}`)
  })

  test('without multiYear the builders run the same engine (no parallel Year 1 path)', () => {
    const profile = baseProfile()
    const rows = rowsFor(profile)
    expect(buildSchoolContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep()))
      .toBe(buildSchoolContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows))
    expect(buildAgentContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep()))
      .toBe(buildAgentContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows))
  })

  test('generic pathway: generic engine rows, generic Days of Cash band, no WA-only lines', () => {
    const profile = baseProfile()
    const rows = rowsFor(profile, 'generic_private')
    const agent = buildAgentContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), undefined, undefined, 'generic_private')
    expect(agent).toContain(`End of Year 1: ${evaluateDaysOfCash(rows[0].reserveDays, 1, 'generic').long}`)
    expect(agent).not.toContain('CATEGORICAL GRANT REVENUE')
    expect(agent).not.toContain('3% of state apportionment')
    const school = buildSchoolContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), undefined, undefined, 'generic_private')
    expect(school).toContain(`Tuition / per-pupil revenue: ${usd(rows[0].revenue.regularEd)}`)
    expect(school).not.toContain('Regular Ed Apportionment')
    expect(school).not.toContain('Regionalization factor')
  })

  test('P-UX-26: an explicit $0 rate is shown as $0 and labeled as set in Settings', () => {
    const profile = baseProfile()
    profile.financial_assumptions = {
      ...profile.financial_assumptions,
      state_sped_per_pupil: 0,
      idea_per_pupil: 0,
      [ASSUMPTIONS_VERSION_KEY]: CURRENT_ASSUMPTIONS_VERSION,
    } as Partial<FinancialAssumptions>
    const rows = rowsFor(profile)
    expect(rows[0].revenue.stateSped).toBe(0)
    expect(rows[0].revenue.idea).toBe(0)
    const school = buildSchoolContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows)
    expect(school).toContain('SPED students × $0) (rate set to $0 in Settings)')
    expect(school).toContain('- IDEA: $0 (rate set to $0 in Settings)')
    expect(school).not.toContain('13,556')
    const agent = buildAgentContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep(), rows)
    expect(agent).toContain('IDEA: $0 (rate set to $0 in Settings)')

    const defaults = buildSchoolContextString('S', baseProfile(), Y1_POSITIONS(), baseProjections(), baseGep())
    expect(defaults).not.toContain('rate set to $0')
    expect(defaults).toContain('× $13,556)')
  })

  test('regionalization note lists only the regionalized lines', () => {
    const profile = baseProfile()
    profile.financial_assumptions = { ...profile.financial_assumptions, regionalization_factor: 1.15 }
    const ctx = buildSchoolContextString('S', profile, Y1_POSITIONS(), baseProjections(), baseGep())
    expect(ctx).toContain('Regionalization factor: 1.15 (multiplies state per-pupil rates: Regular Ed, SPED, State Special Ed)')
    expect(ctx).not.toContain('LAP, TBIP, HiCap)')
  })
})
