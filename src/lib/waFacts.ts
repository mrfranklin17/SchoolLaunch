/**
 * WA charter facts the AI is given (AI-EXP-01 step 2). One entry per fact, with its source and
 * the date it was checked, so every prompt states the same vetted fact and a correction lands
 * everywhere at once. The numeric FPF and health bands live in healthThresholds.ts; this module
 * holds the prose facts.
 *
 * status:
 * - 'verified'   checked against the cited primary source on `asOf`
 * - 'decided'    a modeling decision by Travis (the source says why it's a decision)
 * - 'unreviewed' carried over from older prompts without a check; none today, and the test keeps
 *   it that way
 *
 * reviewBy: year-bound figures (rates, counts, appropriations) must be re-checked by this date;
 * tests/session4/wa-facts.spec.ts fails once it passes.
 *
 * Changing a fact's text changes the prompts: bump PROMPT_VERSION in buildSchoolContext.ts.
 */

export interface WaFact {
  text: string
  source: string
  asOf: string
  status: 'verified' | 'decided' | 'unreviewed'
  reviewBy?: string
}

export const WA_FACTS = {
  funding_count: {
    text: 'State apportionment is funded on annual average FTE (AAFTE): the average of monthly P-223 enrollment counts, September–June. Special education and TBIP are funded on annual average headcount, October–June. Every monthly count matters, so mid-year attrition lowers funding month by month; there is no single count day',
    source: 'OSPI fiscal enrollment, https://ospi.k12.wa.us/data-reporting/data-displays/enrollment-data-display',
    asOf: '2026-10-15',
    status: 'verified',
  },
  apportionment_schedule: {
    text: 'OSPI pays apportionment on a fixed monthly schedule: September 9%, October 8%, November 5%, December 9%, January 8.5%, February 9%, March 9%, April 9%, May 5%, June 6%, July 12.5%, August 10%. November and May are the low-payment months',
    source: 'RCW 28A.510.250',
    asOf: '2026-10-15',
    status: 'verified',
  },
  authorizer_fee: {
    text: "The authorizer oversight fee is set annually by the State Board of Education as a percentage of the school's state operating funding (apportionment, SPED, state special education, facilities, Small School Enhancement, LAP, TBIP, HiCap and state transportation; not federal funds, levy equity or grants), capped at 4%. It is currently 3% for both WA authorizers. Model it at 3%; it is not negotiable by the school",
    source: 'WAC 180-19-060 (amended 2024); SBE 2026 Public Charter Schools Report, https://sbe.wa.gov/sites/default/files/2026-02/2026%20Charter%20School%20Report_0.pdf',
    asOf: '2026-10-15',
    status: 'verified',
    reviewBy: '2027-05-01', // SBE announces changes by April 15 for the next school year
  },
  levy_equity: {
    text: 'Levy equity (enrichment) funding for charter schools depends on each biennial budget and is not assured. Model it at $0 unless the school has entered its own rate',
    source: 'Decision (Travis, 2026-10-15). Statute allows local effort assistance up to about $1,550 per student, subject to appropriation; a 2026 report cites a cut of about $7.5M (~$1,500 per student)',
    asOf: '2026-10-15',
    status: 'decided',
    reviewBy: '2027-07-01', // after the 2027-29 budget
  },
  small_school: {
    text: 'Small School Enhancement thresholds: 60 AAFTE for K-6, 20 for 7-8, 60 for 9-12. Below a threshold the enhancement ((threshold − AAFTE) × the Regular Ed rate) offsets lost students, so Regular Ed revenue holds at about threshold × rate; a school just above a threshold loses a full per-pupil rate for each student until it reaches the threshold. The real OSPI small-school allocation is staffing-based and more complex, so near a threshold flag the sensitivity rather than quoting a precise figure',
    source: "SchoolLaunch engine (calcSmallSchoolEnhancement); arithmetic correction checked 2026-10-15",
    asOf: '2026-10-15',
    status: 'verified',
  },
  market_size: {
    text: 'WA had 17 charter schools enrolling about 4,900 students in 2024-25 (SBE) — a small market with limited comparable data',
    source: 'SBE 2025 Charter Schools Report, https://sbe.wa.gov/sites/default/files/2025-10/2025%20Charter%20School%20Report.pdf',
    asOf: '2026-10-15',
    status: 'verified',
    reviewBy: '2027-03-01', // the next SBE report
  },
  template_version: {
    text: "Applicants submit the Commission's V11 financial template; the Commission's Financial Performance Framework was last updated August 2024",
    source: 'Decision (Travis, 2026-10-15); Commission FPF 08-08-24',
    asOf: '2026-10-15',
    status: 'decided',
  },
  lunch_reimbursement: {
    text: 'Federal school lunch reimbursement for SY 2026-27 (schools under 60% free/reduced): free $4.76, reduced-price $4.36, paid $0.45 per meal, plus 9¢ with menu certification — the food service model only breaks even at high participation',
    source: 'USDA, 91 FR 43597 (2026-07-16)',
    asOf: '2026-10-15',
    status: 'verified',
    reviewBy: '2027-07-15', // USDA publishes new rates each July
  },
  sped_caseload: {
    text: 'Washington law sets no special education caseload limit. Chapter 392-172A WAC requires that every eligible student receive a free appropriate public education as the IEP specifies, that special education be provided by appropriately qualified staff with a special education endorsement, and that paraeducators work under the supervision of a certificated special education teacher (WAC 392-172A-02090). Judge SPED staffing by whether the plan can deliver the IEP services its IEP count implies, never against a numeric cap',
    source: 'Chapter 392-172A WAC (full text has no caseload limit); WAC 392-172A-02090. Decision (Travis, 2026-10-15): follow what state law allows',
    asOf: '2026-10-15',
    status: 'verified',
  },
  regular_ed_rate: {
    text: "Regular Ed apportionment comes from the state's prototypical school funding formula (RCW 28A.150.260): statute sets the formula, not a dollar amount, and OSPI computes the per-AAFTE rate from it. SchoolLaunch's default base rate is that formula's result from OSPI apportionment data, before regionalization; the county regionalization factor (LEAP Document C3) is applied on top. Flag a base rate above the default, or a regionalization factor above the school's county factor, unless the founder documents the source",
    source: 'RCW 28A.150.260; OSPI apportionment data (DEFAULT_ASSUMPTIONS.regular_ed_per_pupil); LEAP Document C3 (src/lib/regionalization.ts). Decision (Travis, 2026-10-15): determined by statute',
    asOf: '2026-10-15',
    status: 'verified',
  },
} as const satisfies Record<string, WaFact>

export type WaFactId = keyof typeof WA_FACTS

/** One fact's text, for use inside a prompt. */
export function waFact(id: WaFactId): string {
  return WA_FACTS[id].text
}
