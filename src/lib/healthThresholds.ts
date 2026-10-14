/**
 * Centralized health-threshold logic for WA charter and generic-pathway financial planning
 * (R-HEALTH-01).
 *
 * Single source of truth for every surface that classifies a health metric: the FPF and
 * generic scorecards in budgetEngine.ts, dashboard tiles and tables, the Scenarios grid,
 * admin portfolio views, PDF/Excel exports, and AI agent prompts. Change a threshold here
 * and every surface follows. This file is in ENGINE_HASH_FILES, so a threshold change also
 * invalidates cached advisory briefings.
 *
 * WA charter thresholds are the Commission FPF bands as implemented in computeFPFScorecard
 * (Stage 1 = Years 1–2, Stage 2 = Years 3+). Generic-pathway thresholds are the
 * computeGenericHealthScorecard benchmarks (not stage-aware).
 *
 * REPRESENTATION NOTE: All percentages are INTEGER PERCENTAGES (65, 72, 78),
 * NOT decimal fractions (0.65, 0.72, 0.78). Producers and consumers must use
 * the same representation; mixing them silently produces wrong evaluations.
 */

export type HealthVerdict = 'meets' | 'approaching' | 'fails'

export interface PersonnelHealthBand {
  /** Inclusive lower bound of the "meets" band. */
  meetsLower: number
  /** Inclusive upper bound of the "meets" band. */
  meetsUpper: number
  /** Inclusive lower bound of "approaching" — values in [approachingLow, meetsLower) are "approaching low". */
  approachingLow: number
  /** Inclusive upper bound of "approaching" — values in (meetsUpper, approachingHigh] are "approaching high". */
  approachingHigh: number
  /** Short human-readable label for the band, e.g. "Founding year 65–72%". */
  label: string
  /** Year category, useful for prompts and tooltips. */
  yearCategory: 'founding' | 'steady_state'
}

export interface PersonnelHealthEvaluation {
  verdict: HealthVerdict
  band: PersonnelHealthBand
  /** Tile-friendly short string, e.g. "Within founding-year range" or "Below healthy range". */
  short: string
  /** Full sentence for tooltips and AI prompts — explains the verdict against the band. */
  long: string
}

/**
 * Return the personnel-% band that applies for a given operating year.
 *
 * Two-band model (F-001/F-011 Phase 1 decision D1):
 *   - Year 1 (founding):     meets 65–72%, approaching 62–65% or 72–75%, fails outside
 *   - Year 2+ (steady-state): meets 72–78%, approaching 69–72% or 78–81%, fails outside
 *
 * Y2 transition handled naturally by enrollment growth (per D1 decision).
 */
export function getPersonnelHealthBand(year: number): PersonnelHealthBand {
  if (year === 1) {
    return {
      meetsLower: 65,
      meetsUpper: 72,
      approachingLow: 62,
      approachingHigh: 75,
      label: 'Founding year 65–72%',
      yearCategory: 'founding',
    }
  }
  return {
    meetsLower: 72,
    meetsUpper: 78,
    approachingLow: 69,
    approachingHigh: 81,
    label: 'Steady-state 72–78%',
    yearCategory: 'steady_state',
  }
}

/**
 * Evaluate a personnel-as-share-of-operating-revenue percentage against the
 * year-appropriate healthy band.
 *
 * @param pct - Personnel % of operating revenue, as integer percentage (e.g. 65.3 not 0.653)
 * @param year - Operating year (1 = founding, 2+ = steady-state)
 */
export function evaluatePersonnelPctHealth(pct: number, year: number): PersonnelHealthEvaluation {
  const band = getPersonnelHealthBand(year)
  const formatted = pct.toFixed(1)

  let verdict: HealthVerdict
  let short: string
  let long: string

  if (pct >= band.meetsLower && pct <= band.meetsUpper) {
    verdict = 'meets'
    short = `Within ${band.yearCategory === 'founding' ? 'founding-year' : 'steady-state'} range`
    long = `Personnel costs at ${formatted}% of operating revenue are within the healthy ${band.label.toLowerCase()} range for WA charter schools.`
  } else if (pct >= band.approachingLow && pct < band.meetsLower) {
    verdict = 'approaching'
    short = 'Approaching low'
    long = `Personnel costs at ${formatted}% are just below the healthy ${band.label.toLowerCase()} range. Review staffing plan against academic program commitments to confirm adequate coverage.`
  } else if (pct > band.meetsUpper && pct <= band.approachingHigh) {
    verdict = 'approaching'
    short = 'Approaching high'
    long = `Personnel costs at ${formatted}% are just above the healthy ${band.label.toLowerCase()} range. Monitor sustainability — there's limited margin to absorb shocks if enrollment doesn't grow.`
  } else if (pct < band.approachingLow) {
    verdict = 'fails'
    short = 'Below healthy range'
    long = `Personnel costs at ${formatted}% are significantly below the healthy ${band.label.toLowerCase()} range. The school is likely under-staffed for delivering quality programming and will face authorizer scrutiny over academic capacity.`
  } else {
    // pct > approachingHigh
    verdict = 'fails'
    short = 'Above healthy range'
    long = `Personnel costs at ${formatted}% are significantly above the healthy ${band.label.toLowerCase()} range. Insufficient margin to absorb enrollment fluctuations, mid-year hires, or benefit cost increases. Plan reviewers will scrutinize staffing decisions at this level.`
  }

  return { verdict, band, short, long }
}

/**
 * Render the personnel-% band definitions as a single prompt-ready string,
 * for injection into AI agent system prompts (Staffing Advisor, Ask SchoolLaunch).
 *
 * Single source of truth ensures the prompts never drift from the helper's
 * verdict logic — the R-ENR-01 F3 lesson.
 */
export function personnelHealthBandsForPrompt(): string {
  const y1 = getPersonnelHealthBand(1)
  const yN = getPersonnelHealthBand(2)
  return [
    `PERSONNEL % HEALTH BANDS (year-aware):`,
    `- Year 1 (founding): healthy ${y1.meetsLower}–${y1.meetsUpper}%, approaching ${y1.approachingLow}–${y1.meetsLower}% (low) or ${y1.meetsUpper}–${y1.approachingHigh}% (high). Below ${y1.approachingLow}% = under-staffed; above ${y1.approachingHigh}% = unsustainable.`,
    `- Year 2+ (steady-state): healthy ${yN.meetsLower}–${yN.meetsUpper}%, approaching ${yN.approachingLow}–${yN.meetsLower}% (low) or ${yN.meetsUpper}–${yN.approachingHigh}% (high). Below ${yN.approachingLow}% = under-staffed; above ${yN.approachingHigh}% = unsustainable.`,
    `- Apply the correct band for each year — DO NOT cite the steady-state 72–78% range as the standard for Year 1 founding schools. Founding schools genuinely run leaner because staffing is sized to current enrollment, not buildout capacity.`,
  ].join('\n')
}


// ---------------------------------------------------------------------------
// R-HEALTH-01: shared bands, evaluators, vocabulary mappers, colors and prompt text.
// ---------------------------------------------------------------------------

/** A verdict, or 'na' when the metric does not apply (e.g. Year 1 Cash Flow). */
export type HealthStatus = HealthVerdict | 'na'

/** The engine's FPF vocabulary — stored in scenarios.results, so it never changes. */
export type FpfStatus = 'meets' | 'approaches' | 'does_not_meet' | 'na'

/** The generic scorecard's vocabulary. */
export type GenericColor = 'green' | 'yellow' | 'red'

export type HealthPathway = 'wa_charter' | 'generic'

/** FPF stage: Stage 1 applies to Years 1–2, Stage 2 to Years 3+. */
export type FpfStage = 1 | 2

/** Map any pathway id ('wa_charter', 'generic_private', …) to the threshold family. */
export function healthPathway(pathway: string | null | undefined): HealthPathway {
  return !pathway || pathway === 'wa_charter' ? 'wa_charter' : 'generic'
}

export function fpfStageForYear(year: number): FpfStage {
  return year <= 2 ? 1 : 2
}

export interface HealthBand {
  pathway: HealthPathway
  /** FPF stage for WA bands; null for generic and stage-independent bands. */
  stage: FpfStage | null
  direction: 'higher_better' | 'lower_better'
  meetsAt: number
  /** true: meets requires strictly beyond meetsAt (> or <); false: inclusive (>= or <=). */
  meetsStrict: boolean
  approachingAt: number
  approachingStrict: boolean
  /** Display target, e.g. '≥ 30 days' (FPF) or '60+ days' (generic "healthy"). */
  target: string
  /** Display range of the approaching band, e.g. '21–29'. */
  approachingRange: string
  /** Generic-scorecard style description of the fails band, e.g. 'Under 30 days'. */
  concern: string
}

export interface HealthEvaluation {
  status: HealthStatus
  band: HealthBand
  /** Tile/badge-sized label, e.g. 'Meets Stage 1' or 'Watch'. */
  short: string
  /** One sentence for tooltips, PDFs and AI context. */
  long: string
}

function band(
  pathway: HealthPathway,
  stage: FpfStage | null,
  direction: HealthBand['direction'],
  meetsAt: number,
  meetsStrict: boolean,
  approachingAt: number,
  approachingStrict: boolean,
  target: string,
  approachingRange: string,
  concern: string,
): HealthBand {
  return { pathway, stage, direction, meetsAt, meetsStrict, approachingAt, approachingStrict, target, approachingRange, concern }
}

/** Classify a value against a band. Exported for the engine's scorecards. */
export function classify(value: number, b: HealthBand): HealthVerdict {
  const beyond = (v: number, at: number, strict: boolean) =>
    b.direction === 'higher_better' ? (strict ? v > at : v >= at) : (strict ? v < at : v <= at)
  if (beyond(value, b.meetsAt, b.meetsStrict)) return 'meets'
  if (beyond(value, b.approachingAt, b.approachingStrict)) return 'approaching'
  return 'fails'
}

const STAGE_SHORT: Record<HealthVerdict, (stage: FpfStage) => string> = {
  meets: (s) => `Meets Stage ${s}`,
  approaching: (s) => `Approaches Stage ${s}`,
  fails: (s) => `Below Stage ${s}`,
}
const GENERIC_SHORT: Record<HealthVerdict, string> = {
  meets: 'Healthy',
  approaching: 'Watch',
  fails: 'Needs attention',
}

function evaluate(
  value: number | null | undefined,
  b: HealthBand,
  describe: (verdict: HealthVerdict, value: number) => string,
): HealthEvaluation {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { status: 'na', band: b, short: 'N/A', long: 'Not applicable for this year.' }
  }
  const verdict = classify(value, b)
  const short = b.stage !== null ? STAGE_SHORT[verdict](b.stage) : GENERIC_SHORT[verdict]
  return { status: verdict, band: b, short, long: describe(verdict, value) }
}

function stageText(b: HealthBand): string {
  return b.stage === 1 ? 'Commission Stage 1 (Years 1–2)' : b.stage === 2 ? 'Commission Stage 2 (Year 3+)' : 'platform benchmark'
}

// --- Days of Cash ---------------------------------------------------------

export function getDaysOfCashBand(year: number, pathway: HealthPathway = 'wa_charter'): HealthBand {
  if (pathway === 'generic') return band('generic', null, 'higher_better', 60, false, 30, false, '60+ days', '30-60 days', 'Under 30 days')
  return fpfStageForYear(year) === 1
    ? band('wa_charter', 1, 'higher_better', 30, false, 21, false, '≥ 30 days', '21–29', 'Under 21 days')
    : band('wa_charter', 2, 'higher_better', 60, false, 30, false, '≥ 60 days', '30–59', 'Under 30 days')
}

export function evaluateDaysOfCash(days: number | null | undefined, year: number, pathway: HealthPathway = 'wa_charter'): HealthEvaluation {
  const b = getDaysOfCashBand(year, pathway)
  return evaluate(days, b, (v, d) => {
    const n = `${Math.round(d)} days of cash`
    if (b.pathway === 'generic') {
      return v === 'meets' ? `${n} meets the 60+ day reserve benchmark.`
        : v === 'approaching' ? `${n} is in the 30–60 day watch range; the healthy benchmark is 60+ days.`
        : `${n} is below the 30-day minimum reserve benchmark.`
    }
    return v === 'meets' ? `${n} meets the ${stageText(b)} standard of ${b.target}.`
      : v === 'approaching' ? `${n} approaches the ${stageText(b)} standard of ${b.target} (approaching range ${b.approachingRange}).`
      : `${n} is below the ${stageText(b)} standard of ${b.target}.`
  })
}

// --- Total Margin -----------------------------------------------------------

export function getTotalMarginBand(year: number, pathway: HealthPathway = 'wa_charter'): HealthBand {
  if (pathway === 'generic') return band('generic', null, 'higher_better', 5, true, 0, false, 'Above 5%', '0-5%', 'Negative')
  return band('wa_charter', fpfStageForYear(year), 'higher_better', 0, false, -2, false, '≥ 0%', '-2% to 0%', 'Below -2%')
}

export function evaluateTotalMargin(pct: number | null | undefined, year: number, pathway: HealthPathway = 'wa_charter'): HealthEvaluation {
  const b = getTotalMarginBand(year, pathway)
  return evaluate(pct, b, (v, p) => {
    const n = `A ${p.toFixed(1)}% total margin`
    if (b.pathway === 'generic') {
      return v === 'meets' ? `${n} is above the 5% healthy benchmark.`
        : v === 'approaching' ? `${n} is in the 0–5% watch range.`
        : `${n} is negative — the school is spending more than it earns.`
    }
    return v === 'meets' ? `${n} meets the ${stageText(b)} standard of ${b.target}.`
      : v === 'approaching' ? `${n} approaches the ${stageText(b)} standard of ${b.target} (approaching range ${b.approachingRange}).`
      : `${n} is below the ${stageText(b)} standard of ${b.target}.`
  })
}

// --- Aggregated 3-Year Total Margin (WA, Year 3+) ------------------------------

export function getThreeYearMarginBand(): HealthBand {
  return band('wa_charter', 2, 'higher_better', 0, true, -1.5, false, '> 0%', '-1.5% to 0%', 'Below -1.5%')
}

export function evaluateThreeYearMargin(pct: number | null | undefined, year: number): HealthEvaluation {
  const b = getThreeYearMarginBand()
  return evaluate(year < 3 ? null : pct, b, (v, p) =>
    v === 'meets' ? `A ${p.toFixed(1)}% aggregated 3-year margin meets the Stage 2 standard of ${b.target}.`
      : v === 'approaching' ? `A ${p.toFixed(1)}% aggregated 3-year margin approaches the Stage 2 standard of ${b.target}.`
      : `A ${p.toFixed(1)}% aggregated 3-year margin is below the Stage 2 standard of ${b.target}.`)
}

// --- Current Ratio --------------------------------------------------------------

export function getCurrentRatioBand(year: number, pathway: HealthPathway = 'wa_charter'): HealthBand {
  if (pathway === 'generic') return band('generic', null, 'higher_better', 1.5, false, 1.0, false, 'Above 1.5', '1.0-1.5', 'Below 1.0')
  return fpfStageForYear(year) === 1
    ? band('wa_charter', 1, 'higher_better', 1.0, false, 0.9, false, '≥ 1.0', '0.9–0.99', 'Below 0.9')
    : band('wa_charter', 2, 'higher_better', 1.1, false, 1.0, false, '≥ 1.1', '1.0–1.09', 'Below 1.0')
}

export function evaluateCurrentRatio(ratio: number | null | undefined, year: number, pathway: HealthPathway = 'wa_charter'): HealthEvaluation {
  const b = getCurrentRatioBand(year, pathway)
  return evaluate(ratio, b, (v, r) =>
    v === 'meets' ? `A current ratio of ${r.toFixed(2)} meets the ${stageText(b)} standard of ${b.target}.`
      : v === 'approaching' ? `A current ratio of ${r.toFixed(2)} approaches the ${stageText(b)} standard of ${b.target}.`
      : `A current ratio of ${r.toFixed(2)} is below the ${stageText(b)} standard of ${b.target}.`)
}

// --- Cash Flow (one-year and multi-year; WA) --------------------------------------

export function getCashFlowBand(year: number): HealthBand {
  return band('wa_charter', fpfStageForYear(year), 'higher_better', 0, true, -5000, false, '> $0', '-$5,000 to $0', 'Below -$5,000')
}

export function evaluateCashFlow(delta: number | null | undefined, year: number): HealthEvaluation {
  const b = getCashFlowBand(year)
  return evaluate(delta, b, (v, d) => {
    const n = `A year-over-year cash change of ${d < 0 ? '-' : ''}$${Math.abs(Math.round(d)).toLocaleString('en-US')}`
    return v === 'meets' ? `${n} meets the standard of ${b.target}.`
      : v === 'approaching' ? `${n} approaches the standard of ${b.target}.`
      : `${n} is below the standard of ${b.target}.`
  })
}

// --- Enrollment Variance (actual ÷ projected, integer %) ------------------------------

export function getEnrollmentVarianceBand(year: number): HealthBand {
  return band('wa_charter', fpfStageForYear(year), 'higher_better', 95, false, 85, false, '≥ 95%', '85–94%', 'Below 85%')
}

export function evaluateEnrollmentVariance(pctOfProjected: number | null | undefined, year: number): HealthEvaluation {
  const b = getEnrollmentVarianceBand(year)
  return evaluate(pctOfProjected, b, (v, p) =>
    v === 'meets' ? `Enrollment at ${Math.round(p)}% of projected meets the standard of ${b.target}.`
      : v === 'approaching' ? `Enrollment at ${Math.round(p)}% of projected approaches the standard of ${b.target}.`
      : `Enrollment at ${Math.round(p)}% of projected is below the standard of ${b.target}.`)
}

// --- Debt-to-Asset (WA; display strings only — no liabilities are modeled) ---------

export function getDebtToAssetBand(): HealthBand {
  return band('wa_charter', null, 'lower_better', 0.9, true, 1.0, false, '< 0.90', '0.90–1.0', 'Above 1.0')
}

// --- Facility % of operating revenue (all pathways) -------------------------------------

export function getFacilityPctBand(): HealthBand {
  return band('wa_charter', null, 'lower_better', 12, false, 15, false, '≤ 12%', '12–15%', 'Above 15%')
}

export function evaluateFacilityPct(pct: number | null | undefined): HealthEvaluation {
  const b = getFacilityPctBand()
  const e = evaluate(pct, b, (v, p) =>
    v === 'meets' ? `Facility costs at ${p.toFixed(1)}% of operating revenue are within the healthy range (${b.target}).`
      : v === 'approaching' ? `Facility costs at ${p.toFixed(1)}% of operating revenue are approaching the 15% maximum lenders and authorizers look for.`
      : `Facility costs at ${p.toFixed(1)}% of operating revenue exceed the 15% maximum most lenders require for financing.`)
  if (e.status === 'na') return e
  return { ...e, short: e.status === 'meets' ? 'Within range' : e.status === 'approaching' ? 'Approaching limit' : 'Above limit' }
}

// --- Generic personnel, break-even and financial-aid benchmarks -------------------------

export function getGenericPersonnelBand(): HealthBand {
  return band('generic', null, 'lower_better', 75, true, 80, false, 'Under 75%', '75-80%', 'Over 80%')
}

export function getBreakEvenPctBand(): HealthBand {
  return band('generic', null, 'lower_better', 85, true, 95, false, 'Below 85%', '85-95%', 'Above 95%')
}

export function getFinancialAidPctBand(): HealthBand {
  return band('generic', null, 'lower_better', 15, true, 25, false, 'Under 15%', '15-25%', 'Over 25%')
}

/** Break-even enrollment as % of projected enrollment (lower is better). */
export function evaluateBreakEvenPct(pct: number | null | undefined): HealthEvaluation {
  const b = getBreakEvenPctBand()
  return evaluate(pct, b, (v, p) =>
    v === 'meets' ? `Break-even at ${Math.round(p)}% of projected enrollment leaves a healthy cushion.`
      : v === 'approaching' ? `Break-even at ${Math.round(p)}% of projected enrollment leaves a thin cushion.`
      : `Break-even at ${Math.round(p)}% of projected enrollment leaves little or no cushion for normal attrition.`)
}

export function evaluateFinancialAidPct(pct: number | null | undefined): HealthEvaluation {
  const b = getFinancialAidPctBand()
  return evaluate(pct, b, (v, p) =>
    v === 'meets' ? `Financial aid at ${Math.round(p)}% of tuition is within the healthy range.`
      : v === 'approaching' ? `Financial aid at ${Math.round(p)}% of tuition is in the watch range.`
      : `Financial aid at ${Math.round(p)}% of tuition is high for a new school.`)
}

/**
 * Personnel % for either pathway. WA delegates to evaluatePersonnelPctHealth (founding vs
 * steady-state bands, same labels); generic uses the generic scorecard benchmark.
 */
export function evaluatePersonnelPct(pct: number | null | undefined, year: number, pathway: HealthPathway = 'wa_charter'): HealthEvaluation {
  if (pathway === 'generic') {
    const b = getGenericPersonnelBand()
    return evaluate(pct, b, (v, p) =>
      v === 'meets' ? `Personnel costs at ${p.toFixed(1)}% of operating revenue are under the 75% healthy benchmark.`
        : v === 'approaching' ? `Personnel costs at ${p.toFixed(1)}% of operating revenue are in the 75–80% watch range.`
        : `Personnel costs at ${p.toFixed(1)}% of operating revenue are above 80%, leaving little margin.`)
  }
  const wa = getPersonnelHealthBand(year)
  const b = band('wa_charter', null, 'lower_better', wa.meetsUpper, false, wa.approachingHigh, false,
    `${wa.meetsLower}–${wa.meetsUpper}%`, `${wa.approachingLow}–${wa.meetsLower}% or ${wa.meetsUpper}–${wa.approachingHigh}%`,
    `Below ${wa.approachingLow}% or above ${wa.approachingHigh}%`)
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return { status: 'na', band: b, short: 'N/A', long: 'Not applicable for this year.' }
  }
  const e = evaluatePersonnelPctHealth(pct, year)
  return { status: e.verdict, band: b, short: e.short, long: e.long }
}

// --- Vocabulary mappers ----------------------------------------------------------------

export function toFpfStatus(status: HealthStatus): FpfStatus {
  return status === 'approaching' ? 'approaches' : status === 'fails' ? 'does_not_meet' : status
}

export function fromFpfStatus(status: string | null | undefined): HealthStatus {
  if (status === 'meets') return 'meets'
  if (status === 'approaches' || status === 'approaching') return 'approaching'
  if (status === 'does_not_meet' || status === 'fails') return 'fails'
  return 'na'
}

export function toGenericColor(status: HealthStatus): GenericColor {
  return status === 'fails' ? 'red' : status === 'approaching' ? 'yellow' : 'green'
}

export function fromGenericColor(color: string | null | undefined): HealthStatus {
  return color === 'green' ? 'meets' : color === 'yellow' ? 'approaching' : color === 'red' ? 'fails' : 'na'
}

/** Worst of a set of statuses ('na' is ignored unless everything is 'na'). */
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('fails')) return 'fails'
  if (statuses.includes('approaching')) return 'approaching'
  if (statuses.includes('meets')) return 'meets'
  return 'na'
}

// --- FPF roll-up helpers -----------------------------------------------------------------

/** FPF measures excluded from the overall assessment (informational or not modeled). */
export const FPF_OVERALL_SKIP: ReadonlySet<string> = new Set(['Debt Default', 'Enrollment Variance'])

/** Names of FPF measures that do not meet the given stage's standard in that stage's years. */
export function fpfIssuesForStage(
  scorecard: { measures: { name: string; statuses: string[] }[] },
  stage: FpfStage,
): string[] {
  const issues: string[] = []
  for (const m of scorecard.measures) {
    if (FPF_OVERALL_SKIP.has(m.name)) continue
    const years = m.statuses.map((s, i) => ({ s, year: i + 1 }))
    if (years.some(({ s, year }) => fpfStageForYear(year) === stage && s === 'does_not_meet')) issues.push(m.name)
  }
  return issues
}

/**
 * Names of generic health measures in the concern (red) band in any of Years 1..lastYear —
 * the generic counterpart of fpfIssuesForStage(scorecard, 1) for portfolio triage.
 */
export function genericIssuesForYears(
  scorecard: { measures: { name: string; applicable?: boolean; values: { year: number; status: string }[] }[] },
  lastYear: number = 2,
): string[] {
  return scorecard.measures
    .filter((m) => m.applicable !== false && m.values.some((v) => v.year <= lastYear && v.status === 'red'))
    .map((m) => m.name)
}

// --- Colors (screen and print share one palette) -------------------------------------------

export interface HealthColorSet {
  /** Tailwind text color for a value. */
  twText: string
  /** Tailwind classes for a small pill/badge. */
  twPill: string
  /** Tailwind classes for a tinted card (bg + text + border). */
  twCard: string
  /** Tailwind background for a progress bar or dot. */
  twBar: string
  /** CSS variables (screen). */
  cssFg: string
  cssBg: string
  cssBorder: string
  /** Hex values (PDF/print), matching the CSS tokens. */
  hexFg: string
  hexBg: string
  hexBorder: string
  hexDot: string
}

export const HEALTH_COLORS: Record<HealthStatus, HealthColorSet> = {
  meets: {
    twText: 'text-emerald-600', twPill: 'bg-emerald-100 text-emerald-700', twCard: 'bg-emerald-50 text-emerald-700 border-emerald-200', twBar: 'bg-emerald-500',
    cssFg: 'var(--status-meets-fg)', cssBg: 'var(--status-meets-bg)', cssBorder: 'var(--status-meets-border)',
    hexFg: '#047857', hexBg: '#ECFDF5', hexBorder: '#D1FAE5', hexDot: '#10B981',
  },
  approaching: {
    twText: 'text-amber-600', twPill: 'bg-amber-100 text-amber-700', twCard: 'bg-amber-50 text-amber-700 border-amber-200', twBar: 'bg-amber-500',
    cssFg: 'var(--status-approaching-fg)', cssBg: 'var(--status-approaching-bg)', cssBorder: 'var(--status-approaching-border)',
    hexFg: '#B45309', hexBg: '#FFFBEB', hexBorder: '#FEF3C7', hexDot: '#F59E0B',
  },
  fails: {
    twText: 'text-red-600', twPill: 'bg-red-100 text-red-700', twCard: 'bg-red-50 text-red-700 border-red-200', twBar: 'bg-red-500',
    cssFg: 'var(--status-fails-fg)', cssBg: 'var(--status-fails-bg)', cssBorder: 'var(--status-fails-border)',
    hexFg: '#BE123C', hexBg: '#FFF1F2', hexBorder: '#FFE4E6', hexDot: '#F43F5E',
  },
  na: {
    twText: 'text-slate-500', twPill: 'bg-slate-100 text-slate-500', twCard: 'bg-slate-50 text-slate-600 border-slate-200', twBar: 'bg-slate-300',
    cssFg: '#64748B', cssBg: '#F1F5F9', cssBorder: '#E2E8F0',
    hexFg: '#64748B', hexBg: '#F1F5F9', hexBorder: '#E2E8F0', hexDot: '#94A3B8',
  },
}

export function healthColor(status: HealthStatus, surface: keyof HealthColorSet): string {
  return HEALTH_COLORS[status][surface]
}

// --- Prompt text --------------------------------------------------------------------------

/** WA Commission FPF thresholds as prompt-ready lines (generated from the bands above). */
export function fpfThresholdsForPrompt(): string {
  const d1 = getDaysOfCashBand(1), d2 = getDaysOfCashBand(3)
  const c1 = getCurrentRatioBand(1), c2 = getCurrentRatioBand(3)
  const m = getTotalMarginBand(1), m3 = getThreeYearMarginBand()
  const cf = getCashFlowBand(3), ev = getEnrollmentVarianceBand(1)
  return [
    'COMMISSION FPF THRESHOLDS (the platform scorecard applies exactly these; Stage 1 = Years 1–2, Stage 2 = Year 3+). The Commission rates only Meets or Does Not Meet; "approaching" is the platform\'s early-warning band, and in Stage 2 the Commission also accepts 30–59 days cash or a 1.0–1.1 current ratio when the one-year trend is positive:',
    `- Days of Cash: Stage 1 meets ${d1.target} (approaching ${d1.approachingRange}); Stage 2 meets ${d2.target} (approaching ${d2.approachingRange}).`,
    `- Current Ratio: Stage 1 meets ${c1.target} (approaching ${c1.approachingRange}); Stage 2 meets ${c2.target} (approaching ${c2.approachingRange}).`,
    `- Total Margin (net income ÷ total revenue): meets ${m.target} in both stages (approaching ${m.approachingRange}; below that does not meet).`,
    `- Aggregated 3-Year Total Margin (Year 3+): meets ${m3.target} (approaching ${m3.approachingRange}).`,
    `- Cash Flow (year-over-year change in cash): meets ${cf.target} (approaching ${cf.approachingRange}).`,
    `- Enrollment Variance (actual ÷ projected): meets ${ev.target} (approaching ${ev.approachingRange}).`,
  ].join('\n')
}

/** Generic-pathway health benchmarks as prompt-ready lines. */
export function genericHealthBandsForPrompt(): string {
  const d = getDaysOfCashBand(1, 'generic'), p = getGenericPersonnelBand(), m = getTotalMarginBand(1, 'generic')
  const be = getBreakEvenPctBand(), cr = getCurrentRatioBand(1, 'generic'), fa = getFinancialAidPctBand()
  const line = (name: string, b: HealthBand) => `- ${name}: healthy ${b.target}, watch ${b.approachingRange}, concern ${b.concern}.`
  return [
    'FINANCIAL HEALTH BENCHMARKS (the platform scorecard applies exactly these in every year):',
    line('Reserve days (cash on hand)', d),
    line('Personnel % of operating revenue', p),
    line('Total margin (net ÷ total revenue)', m),
    line('Break-even enrollment as % of projected', be),
    line('Current ratio', cr),
    line('Financial aid % of tuition (tuition-based schools)', fa),
  ].join('\n')
}

/** Facility-cost benchmark as a prompt-ready line. */
export function facilityHealthBandsForPrompt(): string {
  const f = getFacilityPctBand()
  return `FACILITY COST BENCHMARK (platform health band, all years): facility costs ${f.target} of operating revenue meet the benchmark; ${f.approachingRange} is approaching; ${f.concern.toLowerCase()} fails (most lenders require ≤ 15% for financing).`
}
