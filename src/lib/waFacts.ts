/**
 * WA charter facts the AI is given (AI-EXP-01 step 2). One entry per fact, with its source and
 * the date it was checked, so every prompt states the same vetted fact and a correction lands
 * everywhere at once. The numeric FPF and health bands live in healthThresholds.ts; this module
 * holds the prose facts.
 *
 * status:
 * - 'verified'   checked against the cited primary source on `asOf`
 * - 'decided'    a modeling decision by Travis (the source says why it's a decision)
 * - 'unreviewed' carried over from the original prompts, awaiting Travis's review
 *   (docs/wa-facts-review.md, section B)
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
  funding_channel: {
    text: "WA charter schools receive per-pupil funding through OSPI's Charter School Revolving Fund",
    source: 'Original prompt; name not confirmed (OFM budget documents show an "SPI — Charter Schools Apportionment" line)',
    asOf: '2026-10-15',
    status: 'unreviewed',
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
    text: 'A 0.5 FTE SPED teacher cannot legally case-manage more than ~12-15 IEPs depending on service intensity',
    source: 'Original prompt; no WA statute or WAC caseload cap found (review doc B4)',
    asOf: '2026-10-15',
    status: 'unreviewed',
  },
  regular_ed_red_flag: {
    text: 'Per-pupil rates above $12,500 for Regular Ed without regionalization documentation',
    source: 'Original prompt (review doc B5)',
    asOf: '2026-10-15',
    status: 'unreviewed',
  },
} as const satisfies Record<string, WaFact>

export type WaFactId = keyof typeof WA_FACTS

/** One fact's text, for use inside a prompt. */
export function waFact(id: WaFactId): string {
  return WA_FACTS[id].text
}
