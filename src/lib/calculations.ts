import type { FinancialAssumptions, GradeExpansionEntry } from './types'
import { DEFAULT_ASSUMPTIONS } from './types'

// Re-export defaults for backward compatibility
const PER_PUPIL_RATE = DEFAULT_ASSUMPTIONS.regular_ed_per_pupil
const LEVY_EQUITY_RATE = DEFAULT_ASSUMPTIONS.levy_equity_per_student
const BENEFITS_RATE = DEFAULT_ASSUMPTIONS.benefits_load_pct / 100
const AUTHORIZER_FEE_RATE = DEFAULT_ASSUMPTIONS.authorizer_fee_pct / 100

// --- AAFTE helper ---
export function calcAAFTE(headcount: number, aaftePct: number = 95): number {
  return Math.floor(headcount * aaftePct / 100)
}

// --- Commission-aligned revenue lines ---

/** Regular Ed apportionment: AAFTE × rate */
export function calcRegularEdRevenue(headcount: number, regularEdRate: number, aaftePct: number = 95): number {
  return calcAAFTE(headcount, aaftePct) * regularEdRate
}

/** SPED apportionment: AAFTE × SPED% × SPED rate */
export function calcSpedRevenue(headcount: number, pctIep: number, spedRate: number, aaftePct: number = 95): number {
  return Math.round(calcAAFTE(headcount, aaftePct) * (pctIep / 100) * spedRate)
}

/** Facilities revenue: AAFTE × rate (usually $0 for WA charters) */
export function calcFacilitiesRevenue(headcount: number, facilitiesRate: number, aaftePct: number = 95): number {
  return calcAAFTE(headcount, aaftePct) * facilitiesRate
}

/** Levy equity: AAFTE × rate */
export function calcLevyEquityCommission(headcount: number, levyRate: number, aaftePct: number = 95): number {
  return calcAAFTE(headcount, aaftePct) * levyRate
}

// --- Legacy revenue functions (still used in some code paths) ---

export function calcRevenue(enrollment: number, perPupilRate: number = PER_PUPIL_RATE) {
  return enrollment * perPupilRate
}

export function calcLevyEquity(enrollment: number, levyRate: number = LEVY_EQUITY_RATE) {
  return enrollment * levyRate
}

export function calcTotalBaseRevenue(enrollment: number, perPupilRate: number = PER_PUPIL_RATE, levyRate: number = LEVY_EQUITY_RATE) {
  return calcRevenue(enrollment, perPupilRate) + calcLevyEquity(enrollment, levyRate)
}

// --- Categorical grants (use headcount, not AAFTE) ---
// These functions accept per-pupil rates from assumptions and apply regionalization where appropriate.

export function calcTitleI(enrollment: number, pctFrl: number, rate: number = 880) {
  return pctFrl > 40 ? Math.round(enrollment * (pctFrl / 100) * rate) : 0
}

export function calcIDEA(enrollment: number, pctIep: number, rate: number = 1500) {
  return Math.round(enrollment * (pctIep / 100) * rate)
}

export function calcLAP(enrollment: number, pctFrl: number, rate: number = 816) {
  return Math.round(enrollment * (pctFrl / 100) * rate)
}

export function calcTBIP(enrollment: number, pctEll: number, rate: number = 1600) {
  return Math.round(enrollment * (pctEll / 100) * rate)
}

export function calcHiCap(enrollment: number, pctHicap: number, rate: number = 730) {
  return Math.round(enrollment * (pctHicap / 100) * rate)
}

// --- Commission-aligned total revenue (12 lines) ---

export interface CommissionRevenue {
  regularEd: number
  sped: number
  stateSped: number
  facilitiesRev: number
  levyEquity: number
  titleI: number
  idea: number
  lap: number
  lapHighPoverty: number
  tbip: number
  hicap: number
  foodServiceRev: number
  transportationRev: number
  smallSchoolEnhancement: number
  total: number
  aafte: number
  headcount: number
}

export function calcCommissionRevenue(
  headcount: number,
  pctFrl: number,
  pctIep: number,
  pctEll: number,
  pctHicap: number,
  assumptions: FinancialAssumptions,
  colaYear: number = 1,
  sse: number = 0,
  hasFrplHistory: boolean = false,
): CommissionRevenue {
  const colaMult = Math.pow(1 + assumptions.revenue_cola_pct / 100, colaYear - 1)
  const regionFactor = assumptions.regionalization_factor || 1.0

  // State apportionment rates: base × regionalization × COLA
  const regRate = Math.round(assumptions.regular_ed_per_pupil * regionFactor * colaMult)
  const spedRate = Math.round(assumptions.sped_per_pupil * regionFactor * colaMult)
  // P-UX-26: rates arrive resolved by getAssumptions (an explicit $0 excludes the line), so
  // only a missing value falls back to the default here.
  const stateSpedRate = Math.round((assumptions.state_sped_per_pupil ?? DEFAULT_ASSUMPTIONS.state_sped_per_pupil) * regionFactor * colaMult)
  const facRate = Math.round(assumptions.facilities_per_pupil * colaMult) // not regionalized
  const levyRate = Math.round(assumptions.levy_equity_per_student * colaMult) // not regionalized
  const aaftePct = assumptions.aafte_pct

  const aafte = calcAAFTE(headcount, aaftePct)
  const spedStudents = Math.round(headcount * (pctIep / 100))

  // State & Local (AAFTE-based)
  const regularEd = aafte * regRate
  const sped = Math.round(aafte * (pctIep / 100) * spedRate)
  const stateSped = spedStudents * stateSpedRate
  const facilitiesRev = aafte * facRate
  const levyEquity = aafte * levyRate

  // State categorical (headcount-based) — NOT regionalized per Spectrum validation, COLA only
  const lapRate = Math.round((assumptions.lap_per_pupil ?? DEFAULT_ASSUMPTIONS.lap_per_pupil) * colaMult)
  const lapHighPovertyRate = Math.round((assumptions.lap_high_poverty_per_pupil ?? DEFAULT_ASSUMPTIONS.lap_high_poverty_per_pupil) * colaMult)
  const tbipRate = Math.round((assumptions.tbip_per_pupil ?? DEFAULT_ASSUMPTIONS.tbip_per_pupil) * colaMult)
  const hicapRate = Math.round((assumptions.hicap_per_pupil ?? DEFAULT_ASSUMPTIONS.hicap_per_pupil) * colaMult)
  const lap = Math.round(headcount * (pctFrl / 100) * lapRate)
  // LAP High Poverty supplement (R-REV-02): OSPI's LAP Guide gates this supplement on a
  // THREE-YEAR ROLLING FRPL average >= 50% (RCW 28A.165), not a single current-year snapshot.
  // New WA charter applicants have no 3-year FRPL history, so they do not qualify in their
  // early projection years. hasFrplHistory defaults to false because the WA Charter pathway is
  // a pre-opening planning tool: every school modeled in it is a new applicant by definition.
  // When hasFrplHistory is true, the supplement scales with FRPL share of enrollment (not a
  // flat per-student amount). The LAP BASE line above is NOT gated this way and is unaffected.
  const lapHighPoverty = (hasFrplHistory && pctFrl >= 50)
    ? Math.round(headcount * (pctFrl / 100) * lapHighPovertyRate)
    : 0
  const tbip = Math.round(headcount * (pctEll / 100) * tbipRate)
  const hicap = Math.round(headcount * (pctHicap / 100) * hicapRate)

  // Federal (headcount-based) — NOT regionalized, COLA only
  const titleIRate = Math.round((assumptions.title_i_per_pupil ?? DEFAULT_ASSUMPTIONS.title_i_per_pupil) * colaMult)
  const ideaRate = Math.round((assumptions.idea_per_pupil ?? DEFAULT_ASSUMPTIONS.idea_per_pupil) * colaMult)
  const titleI = pctFrl > 40 ? Math.round(headcount * (pctFrl / 100) * titleIRate) : 0
  const idea = Math.round(headcount * (pctIep / 100) * ideaRate)

  // Program revenue (only when programs are enabled)
  const foodServiceRevRate = Math.round((assumptions.food_service_revenue_per_pupil || 0) * colaMult)
  const transportRevRate = Math.round((assumptions.transportation_revenue_per_pupil || 0) * colaMult)
  const foodServiceRev = assumptions.food_service_offered ? headcount * foodServiceRevRate : 0
  const transportationRev = assumptions.transportation_offered ? headcount * transportRevRate : 0

  // smallSchoolEnhancement needs grade-band enrollment data to compute; callers that have it
  // (budgetEngine, onboarding steps, etc.) pass it in via `sse` so rev.total is a true total.
  const smallSchoolEnhancement = sse

  const total = regularEd + sped + stateSped + facilitiesRev + levyEquity + titleI + idea + lap + lapHighPoverty + tbip + hicap + foodServiceRev + transportationRev + smallSchoolEnhancement

  return { regularEd, sped, stateSped, facilitiesRev, levyEquity, titleI, idea, lap, lapHighPoverty, tbip, hicap, foodServiceRev, transportationRev, smallSchoolEnhancement, total, aafte, headcount }
}

// --- Small School Enhancement ---

/** Minimum AAFTE thresholds by grade band (WA prototypical school funding model) */
export const SMALL_SCHOOL_THRESHOLDS = {
  k6: 60,   // Elementary: K-6
  ms: 20,   // Middle: 7-8
  hs: 60,   // High: 9-12
}

/** Grade band classification for Small School Enhancement */
function gradeToGradeBand(grade: string): 'k6' | 'ms' | 'hs' | null {
  const g = grade.toUpperCase()
  if (g === 'K' || (parseInt(g) >= 1 && parseInt(g) <= 6)) return 'k6'
  if (parseInt(g) >= 7 && parseInt(g) <= 8) return 'ms'
  if (parseInt(g) >= 9 && parseInt(g) <= 12) return 'hs'
  return null
}

/**
 * Calculate Small School Enhancement revenue for a given year.
 * Returns the enhancement amount based on grade-band AAFTE vs statutory minimums.
 *
 * @param gradeExpansionPlan Full grade expansion plan (all years)
 * @param year The year to calculate for (1-5)
 * @param aaftePct AAFTE percentage (e.g. 95)
 * @param perPupilRate Regular Ed per-pupil rate (base, before COLA)
 * @param regionFactor Regionalization factor
 * @param colaYear Year for COLA calculation (same as revenue year)
 * @param colaPct Revenue COLA percentage (e.g. 3)
 */
export function calcSmallSchoolEnhancement(
  gradeExpansionPlan: GradeExpansionEntry[],
  year: number,
  aaftePct: number,
  perPupilRate: number,
  regionFactor: number = 1.0,
  colaYear: number = 1,
  colaPct: number = 3,
): number {
  const yearEntries = gradeExpansionPlan.filter(e => e.year === year)
  if (yearEntries.length === 0) return 0

  const colaMult = Math.pow(1 + colaPct / 100, colaYear - 1)
  const effectiveRate = Math.round(perPupilRate * regionFactor * colaMult)

  // Sum headcount by grade band
  const bandHeadcount: Record<string, number> = { k6: 0, ms: 0, hs: 0 }
  for (const entry of yearEntries) {
    const band = gradeToGradeBand(entry.grade_level)
    if (band) {
      bandHeadcount[band] += entry.sections * entry.students_per_section
    }
  }

  let totalEnhancement = 0
  for (const [band, headcount] of Object.entries(bandHeadcount)) {
    if (headcount <= 0) continue // School doesn't serve this grade band
    const aafte = Math.floor(headcount * aaftePct / 100)
    const threshold = SMALL_SCHOOL_THRESHOLDS[band as keyof typeof SMALL_SCHOOL_THRESHOLDS]
    if (aafte < threshold) {
      totalEnhancement += (threshold - aafte) * effectiveRate
    }
  }

  return totalEnhancement
}

/**
 * Calculate Small School Enhancement for Year 1 using flat enrollment + opening grades.
 * Used by Revenue tab where grade expansion plan may not be available.
 */
export function calcSmallSchoolEnhancementFromGrades(
  headcount: number,
  activeGrades: string[],
  aaftePct: number,
  perPupilRate: number,
  regionFactor: number = 1.0,
): number {
  if (activeGrades.length === 0 || headcount <= 0) return 0

  const effectiveRate = Math.round(perPupilRate * regionFactor)

  // Distribute headcount proportionally across grade bands based on number of grades in each band
  const bandGradeCounts: Record<string, number> = { k6: 0, ms: 0, hs: 0 }
  for (const grade of activeGrades) {
    const band = gradeToGradeBand(grade)
    if (band) bandGradeCounts[band]++
  }

  const totalGrades = activeGrades.length
  let totalEnhancement = 0

  for (const [band, gradeCount] of Object.entries(bandGradeCounts)) {
    if (gradeCount === 0) continue
    const bandHeadcount = Math.round(headcount * gradeCount / totalGrades)
    const aafte = Math.floor(bandHeadcount * aaftePct / 100)
    const threshold = SMALL_SCHOOL_THRESHOLDS[band as keyof typeof SMALL_SCHOOL_THRESHOLDS]
    if (aafte < threshold) {
      totalEnhancement += (threshold - aafte) * effectiveRate
    }
  }

  return totalEnhancement
}

// --- Benefits ---

export function calcBenefits(salary: number, benefitsRate: number = BENEFITS_RATE) {
  return Math.round(salary * benefitsRate)
}

// --- Authorizer fee (3% of state operating funding — see authorizerFeeBase() in budgetEngine.ts for the canonical base) ---

export function calcAuthorizerFee(enrollment: number, feeRate: number = AUTHORIZER_FEE_RATE, perPupilRate: number = PER_PUPIL_RATE) {
  return Math.round(calcRevenue(enrollment, perPupilRate) * feeRate)
}

export function calcAuthorizerFeeCommission(stateApportionment: number, feeRate: number = AUTHORIZER_FEE_RATE): number {
  return Math.round(stateApportionment * feeRate)
}

// --- Sections & enrollment growth ---

export function calcSections(enrollment: number, classSize: number) {
  return Math.ceil(enrollment / classSize)
}

export function calcEnrollmentGrowth(base: number, rate: number, year: number) {
  return Math.round(base * Math.pow(1 + rate / 100, year - 1))
}

// --- Legacy total revenue ---

export function calcTotalRevenue(
  enrollment: number,
  pctFrl: number,
  pctIep: number,
  pctEll: number,
  pctHicap: number,
  assumptions: FinancialAssumptions,
  sse: number = 0,
) {
  const rev = calcCommissionRevenue(enrollment, pctFrl, pctIep, pctEll, pctHicap, assumptions, 1, sse)
  return rev.total
}

export { PER_PUPIL_RATE, LEVY_EQUITY_RATE, BENEFITS_RATE, AUTHORIZER_FEE_RATE }
