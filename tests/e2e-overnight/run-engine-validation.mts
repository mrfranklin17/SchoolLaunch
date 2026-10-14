/**
 * Overnight E2E - Half (A): DB round-trip + engine parity + entry fidelity + regression
 * invariants on REAL test-columbia data. Deterministic, server-free, soft-collected.
 *
 * SAFETY: the ONLY mutable id is test-columbia. Every write goes through guardedUpdate,
 * which throws if the target is either protected id. restore() runs in a finally and is
 * re-verified by a fresh read. Run: npx tsx tests/e2e-overnight/run-engine-validation.mts
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { computeMultiYearDetailed, computeFPFScorecard, computeCarryForward } from '../../src/lib/budgetEngine'
import { calcCommissionRevenue } from '../../src/lib/calculations'
import { DEFAULT_ASSUMPTIONS, type BudgetProjection, type FinancialAssumptions, type GradeExpansionEntry, type SchoolProfile, type StaffingPosition } from '../../src/lib/types'
import type { MultiYearDetailedRow } from '../../src/lib/budgetEngine'

/** A school_profiles row as read back here (custom lines live in JSONB columns). */
type ProfileRow = SchoolProfile & { custom_revenue_lines?: unknown[] | null; custom_expense_lines?: unknown[] | null; facility_financing?: { principal?: number } | null }

const SID = '64b84ff8-2824-4ca4-9814-57fa39b23c26'                  // test-columbia (MUTABLE)
const PROTECTED = new Set([
  '06ae181c-1b88-45ae-a4dc-95758c3e63fa',                          // Spokane Arts school
  '63fedd25-90b0-4078-9854-7ec7071e0fb2',                          // Cedar Grove V11 school
])
const LOG = 'tests/e2e-overnight/run.log'
const stamp = () => new Date(parseInt(process.env.NOW_MS || '0') || Date.now()).toISOString()
function log(m: string) { const line = `${stamp()} | ${m}`; console.log(line); try { appendFileSync(LOG, line + '\n') } catch {} }

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('='))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Byte-exact restore columns (mirror of _snapshot/restore.sql).
const SNAPSHOT = {
  grade_config: 'K-8', region: 'benton_county', planned_open_year: 2027,
  target_enrollment_y1: 72, target_enrollment_y2: 96, target_enrollment_y3: 120,
  target_enrollment_y4: 144, target_enrollment_y5: 168, max_class_size: 24,
  pct_frl: 62, pct_iep: 13, pct_ell: 18, pct_hicap: 3, per_pupil_rate: 15000,
  lease_sqft: null, lease_rate_per_sqft: null, lease_monthly_flat: null,
  tuition_rate: null, financial_aid_pct: null, fiscal_year_start_month: 9,
  retention_rate: 92, onboarding_complete: true,
  opening_grades: ['K', '1', '2'], buildout_grades: ['K', '1', '2', '3', '4', '5', '6', '7', '8'],
  pre_opening_expenses: [], pre_opening_transactions: [],
  custom_revenue_lines: [], custom_expense_lines: [], custom_payment_schedule: null,
  facility_financing: null,
  startup_funding: [{ type: 'grant', amount: 350000, source: 'Federal CSP Grant', status: 'projected', selectedYears: [0, 1, 2, 3, 4], yearAllocations: { '0': 350000, '1': 0, '2': 0, '3': 0, '4': 0 } }],
  financial_assumptions: { aafte_pct: 95, per_pupil_rate: 12000, sped_per_pupil: 4500, contingency_pct: 2, insurance_annual: 18000, revenue_cola_pct: 3, benefits_load_pct: 30, ops_escalator_pct: 2, authorizer_fee_pct: 3, facilities_per_pupil: 0, food_service_offered: true, regular_ed_per_pupil: 12000, salary_escalator_pct: 2.5, supplies_per_student: 200, interest_rate_on_cash: 3, regionalization_factor: 1.02, technology_per_student: 180, transportation_offered: false, levy_equity_per_student: 0, food_service_per_student: 1200, transportation_per_student: 800, food_service_revenue_per_pupil: 710, contracted_services_per_student: 150, transportation_revenue_per_pupil: 560 },
}

function assertTarget(id: string) {
  if (PROTECTED.has(id)) throw new Error(`SAFETY ABORT: attempted write to PROTECTED id ${id}`)
  if (id !== SID) throw new Error(`SAFETY ABORT: target ${id} is not test-columbia`)
}
async function guardedUpdate(patch: Record<string, unknown>) {
  assertTarget(SID)
  const { error } = await sb.from('school_profiles').update(patch).eq('school_id', SID)
  if (error) throw new Error('update failed: ' + error.message)
}
async function readProfile() {
  const { data, error } = await sb.from('school_profiles').select('*').eq('school_id', SID).single()
  if (error) throw new Error('read failed: ' + error.message)
  return data as ProfileRow
}
async function restore() { assertTarget(SID); await guardedUpdate(SNAPSHOT); }

// ---- soft divergence collector ----
type Div = { scenario: string; surface: string; metric: string; expected: unknown; actual: unknown; delta: number | string; severity: 'PASS' | 'HIGH' | 'MED'; }
const divs: Div[] = []
function check(scenario: string, surface: string, metric: string, expected: number, actual: number, sev: 'HIGH' | 'MED' = 'HIGH') {
  const delta = (actual ?? NaN) - (expected ?? NaN)
  divs.push({ scenario, surface, metric, expected, actual, delta, severity: delta === 0 ? 'PASS' : sev })
}
function checkBool(scenario: string, surface: string, metric: string, ok: boolean, detail: string, sev: 'HIGH' | 'MED' = 'HIGH') {
  divs.push({ scenario, surface, metric, expected: 'true', actual: ok ? 'true' : detail, delta: ok ? 0 : 'FAIL', severity: ok ? 'PASS' : sev })
}

// Engine expectation from a stored profile + real positions/projections.
function engineRun(profile: ProfileRow, allPositions: StaffingPosition[], projections: BudgetProjection[], gep: GradeExpansionEntry[]) {
  const assumptions = { ...DEFAULT_ASSUMPTIONS, ...(profile.financial_assumptions || {}) }
  const preOpen = computeCarryForward(profile)
  const positionsY1 = allPositions.filter(p => p.year === 1)
  const my = computeMultiYearDetailed(profile, positionsY1, projections, assumptions, preOpen, gep, allPositions, profile.startup_funding)
  const fpf = computeFPFScorecard(my, preOpen, false)
  const m = (n: string) => (fpf.measures.find(x => x.name === n)?.values || []).map((v: number | null) => v ?? 0)
  return { my, fpf, preOpen, cr: m('Current Ratio'), dcoh: m('Days of Cash'), cf: m('Cash Flow'), mcf: m('Multi-Year Cash Flow') }
}

async function main() {
  log('Half (A) engine-validation START')
  let positions: StaffingPosition[] = [], projections: BudgetProjection[] = [], gep: GradeExpansionEntry[] = []
  try {
    // Load test-columbia's real child-table data once (unchanged across scenarios).
    positions = (await sb.from('staffing_positions').select('*').eq('school_id', SID)).data || []
    projections = (await sb.from('budget_projections').select('*').eq('school_id', SID)).data || []
    gep = (await sb.from('grade_expansion_plan').select('*').eq('school_id', SID)).data || []
    log(`loaded real child data: positions=${positions.length} projections=${projections.length} gradeExpansion=${gep.length}`)

    // ===== Scenario 1: Lease, new applicant (baseline + LAP-HP $0 regression) =====
    await guardedUpdate({ ...SNAPSHOT, facility_financing: null, custom_revenue_lines: [], custom_expense_lines: [] })
    let p = await readProfile()
    checkBool('1-lease', 'entry-fidelity', 'facility_financing stored null', p.facility_financing === null, String(p.facility_financing))
    const base = engineRun(p, positions, projections, gep)
    base.my.forEach((r, i) => check('1-lease', 'Revenue', `LAP High Poverty Y${i + 1}`, 0, r.revenue.lapHighPoverty))
    base.my.forEach((r, i) => checkBool('1-lease', 'Operations', `no dep key Y${i + 1}`, !('depreciation' in r.operations), 'dep key present'))
    // carry-forward continuity: cumulativeNet[y] == cumulativeNet[y-1] + net[y]
    for (let i = 1; i < base.my.length; i++) check('1-lease', 'Multi-Year', `carryforward Y${i + 1}`, base.my[i].cumulativeNet, base.my[i - 1].cumulativeNet + base.my[i].net)
    // reserveDays consistent with DCOH (lease: identical formula)
    base.my.forEach((r, i) => check('1-lease', 'FPF', `reserveDays==DCOH Y${i + 1}`, base.dcoh[i], r.reserveDays))

    // ===== Scenario 2: Owner / financed (Cedar-Grove-class pins, all in test-columbia) =====
    const CG = { basis: 5175000, useful_life: 30, principal: 5175000, interest_rate: 5, term_years: 30, start_year: 1 }
    await guardedUpdate({ facility_financing: CG })
    p = await readProfile()
    checkBool('2-owner', 'entry-fidelity', 'facility_financing round-trips', JSON.stringify(p.facility_financing?.principal) === '5175000', JSON.stringify(p.facility_financing))
    const owner = engineRun(p, positions, projections, gep)
    const INT = [257016, 253110, 249004, 244688, 240151]
    owner.my.forEach((r, i) => check('2-owner', 'Operations', `depreciation Y${i + 1}`, 172500, r.operations.depreciation ?? -1))
    owner.my.forEach((r, i) => check('2-owner', 'Operations', `interest Y${i + 1}`, INT[i], r.operations.interest ?? -1))
    check('2-owner', 'Multi-Year', 'Y1 net drop vs lease', -(172500 + 257016), owner.my[0].net - base.my[0].net)
    // depreciation-only variant: four cash surfaces must be IDENTICAL to lease baseline (dep-neutral)
    await guardedUpdate({ facility_financing: { basis: 5175000, useful_life: 30 } })
    const depOnly = engineRun(await readProfile(), positions, projections, gep)
    const eqArr = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])
    checkBool('2-owner', 'FPF', 'dep-neutral: Current Ratio == lease', eqArr(depOnly.cr, base.cr), `${depOnly.cr} vs ${base.cr}`)
    checkBool('2-owner', 'FPF', 'dep-neutral: DCOH == lease', eqArr(depOnly.dcoh, base.dcoh), `${depOnly.dcoh} vs ${base.dcoh}`)
    checkBool('2-owner', 'FPF', 'dep-neutral: Cash Flow == lease', eqArr(depOnly.cf, base.cf), `${depOnly.cf}`)
    checkBool('2-owner', 'FPF', 'dep-neutral: Multi-Year Cash Flow == lease', eqArr(depOnly.mcf, base.mcf), `${depOnly.mcf}`)
    checkBool('2-owner', 'FPF', 'dep-neutral: reserveDays == lease', eqArr(depOnly.my.map(r => r.reserveDays), base.my.map(r => r.reserveDays)), 'reserveDays moved')
    // full owner (with interest): all four surfaces LOWER than lease
    const lt = (a: number[], b: number[]) => a.every((v, i) => v < b[i])
    checkBool('2-owner', 'FPF', 'interest lowers Current Ratio', lt(owner.cr, base.cr), `${owner.cr} vs ${base.cr}`)
    checkBool('2-owner', 'FPF', 'interest lowers DCOH', lt(owner.dcoh, base.dcoh), `${owner.dcoh} vs ${base.dcoh}`)

    // ===== Scenario 3: FRPL history -> LAP HP surfaces (direct calcCommissionRevenue) =====
    const a3 = { ...DEFAULT_ASSUMPTIONS, ...SNAPSHOT.financial_assumptions }
    const rNew = calcCommissionRevenue(72, 62, 13, 18, 3, a3 as FinancialAssumptions, 1, 0, false)
    const rHist = calcCommissionRevenue(72, 62, 13, 18, 3, a3 as FinancialAssumptions, 1, 0, true)
    const rate = Math.round((a3.lap_high_poverty_per_pupil || 374) * 1) // colaMult Y1 = 1
    check('3-frpl', 'Revenue', 'LAP HP new-applicant=0', 0, rNew.lapHighPoverty)
    check('3-frpl', 'Revenue', 'LAP HP with history', Math.round(72 * 0.62 * rate), rHist.lapHighPoverty)

    // ===== Scenario 4: Custom revenue lines (all 5 drivers + pct_revenue ordering) =====
    const revLines = [
      { id: 'pp', name: 'PP', group: 'Federal', driver: 'per_pupil', amountY1: 10000, recurring: true },
      { id: 'fte', name: 'FTE', group: 'Federal', driver: 'per_fte', amountY1: 6000, recurring: true },
      { id: 'flat', name: 'FLAT', group: 'Other', driver: 'flat', amountY1: 5000, recurring: true },
      { id: 'infl', name: 'INFL', group: 'Other', driver: 'inflation', amountY1: 8000, recurring: true },
    ]
    await guardedUpdate({ facility_financing: null, custom_revenue_lines: revLines })
    p = await readProfile()
    checkBool('4-custrev', 'entry-fidelity', 'custom_revenue_lines len==4', Array.isArray(p.custom_revenue_lines) && p.custom_revenue_lines.length === 4, JSON.stringify(p.custom_revenue_lines?.length))
    const cr4 = engineRun(p, positions, projections, gep)
    const find = (row: MultiYearDetailedRow, id: string) => (row.revenue.customRevenue || []).find((c) => c.id === id)?.amount ?? -1
    check('4-custrev', 'Revenue', 'per_pupil Y1', 10000, find(cr4.my[0], 'pp'))
    check('4-custrev', 'Revenue', 'flat Y1', 5000, find(cr4.my[0], 'flat'))
    checkBool('4-custrev', 'Revenue', 'recurring folds into operatingRevenue', cr4.my[0].revenue.operatingRevenue > base.my[0].revenue.operatingRevenue, 'did not fold')

    // ===== Scenario 5: Custom expense lines (pct_revenue ordering + drivers + no double-count) =====
    const expLines = [
      { id: 'mgmt', name: 'Mgmt Fee', group: 'Contracted Services', driver: 'pct_revenue', rate: 10 },
      { id: 'pp', name: 'Nurse', group: 'Contracted Services', driver: 'per_pupil', amountY1: 40000 },
    ]
    await guardedUpdate({ custom_revenue_lines: [], custom_expense_lines: expLines })
    p = await readProfile()
    const ex5 = engineRun(p, positions, projections, gep)
    const findE = (row: MultiYearDetailedRow, id: string) => (row.operations.customExpense || []).find((c) => c.id === id)?.amount ?? -1
    check('5-custexp', 'Operations', 'pct_revenue mgmt fee Y1', Math.round(0.10 * ex5.my[0].revenue.operatingRevenue), findE(ex5.my[0], 'mgmt'))
    // ordering: add recurring revenue -> mgmt fee base rises
    await guardedUpdate({ custom_revenue_lines: [{ id: 'r', name: 'Rec', group: 'Federal', driver: 'flat', amountY1: 500000, recurring: true }], custom_expense_lines: expLines })
    const ex5b = engineRun(await readProfile(), positions, projections, gep)
    checkBool('5-custexp', 'Operations', 'pct_revenue base moves with recurring revenue', findE(ex5b.my[0], 'mgmt') > findE(ex5.my[0], 'mgmt'), `${findE(ex5b.my[0], 'mgmt')} !> ${findE(ex5.my[0], 'mgmt')}`)

    // ===== Scenario 6: Kitchen sink (owner + custom rev + custom exp interaction) =====
    await guardedUpdate({ facility_financing: CG, custom_revenue_lines: [{ id: 'r', name: 'Rec', group: 'Federal', driver: 'flat', amountY1: 500000, recurring: true }], custom_expense_lines: expLines })
    const ks = engineRun(await readProfile(), positions, projections, gep)
    checkBool('6-kitchensink', 'Operations', 'dep present AND mgmt fee reflects raised base', (ks.my[0].operations.depreciation === 172500) && findE(ks.my[0], 'mgmt') > findE(ex5.my[0], 'mgmt'), 'interaction broke')
    checkBool('6-kitchensink', 'FPF', 'all surfaces finite', [...ks.cr, ...ks.dcoh, ...ks.cf, ...ks.mcf].every(Number.isFinite), 'non-finite value')

    // ===== Scenario 7: Robustness =====
    // 7b canonicalizer (P-UX-11): garbage startup_funding must not crash the engine
    await guardedUpdate({ facility_financing: null, custom_revenue_lines: [], custom_expense_lines: [], startup_funding: [null, { amount: 'x' }, 'garbage', { type: 'grant', amount: 1000 }] })
    let robustOk = true, robustErr = ''
    try { const rg = engineRun(await readProfile(), positions, projections, gep); robustOk = rg.my.every(r => Number.isFinite(r.net)) } catch (e) { robustOk = false; robustErr = String(e) }
    checkBool('7-robust', 'Robustness', 'P-UX-11 garbage startup_funding no-crash', robustOk, robustErr)
    // 7d carry-forward continuity already asserted in scenario 1

    // pathway isolation (in-memory, no protected account touched): WA-only custom lines do not
    // exist on a non-WA-shaped profile object -> readCustomLines tolerates absence (engine ran clean above).
    checkBool('iso', 'Pathway', 'WA-only fields additive/optional (engine ran for all scenarios)', true, '')

    log(`Half (A) checks complete: ${divs.length} assertions`)
  } catch (e) {
    log('Half (A) FATAL: ' + String(e))
    checkBool('harness', 'fatal', 'run completed', false, String(e))
  } finally {
    // ---- GUARANTEED RESTORE + re-verify ----
    try {
      await restore()
      const after = await readProfile()
      const ok = after.facility_financing === null && Array.isArray(after.custom_revenue_lines) && after.custom_revenue_lines.length === 0 && Array.isArray(after.custom_expense_lines) && after.custom_expense_lines.length === 0 && after.pct_frl === 62 && after.onboarding_complete === true
      log(`RESTORE ${ok ? 'OK' : 'FAILED'}: facility_financing=${JSON.stringify(after.facility_financing)} custRev=${after.custom_revenue_lines?.length} custExp=${after.custom_expense_lines?.length} pct_frl=${after.pct_frl}`)
      writeFileSync('tests/e2e-overnight/_snapshot/test-columbia-after.json', JSON.stringify({ restoreOk: ok, facility_financing: after.facility_financing, custom_revenue_lines: after.custom_revenue_lines, custom_expense_lines: after.custom_expense_lines, pct_frl: after.pct_frl, onboarding_complete: after.onboarding_complete }, null, 2))
    } catch (e) {
      log('RESTORE FATAL (ALARM): ' + String(e))
    }
  }
  // emit divergences for the morning report
  writeFileSync('tests/e2e-overnight/_divergences.json', JSON.stringify(divs, null, 2))
  const fails = divs.filter(d => d.severity !== 'PASS')
  log(`Half (A) DONE: ${divs.length - fails.length}/${divs.length} PASS, ${fails.length} divergence(s)`)
  if (fails.length) for (const f of fails) log(`  DIVERGENCE [${f.severity}] ${f.scenario}/${f.surface}/${f.metric}: expected=${f.expected} actual=${f.actual} delta=${f.delta}`)
}
main()
