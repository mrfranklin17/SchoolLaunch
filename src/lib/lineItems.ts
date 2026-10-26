/**
 * Labeled line items from an engine row (P2-FU-04). Every list here sums EXACTLY to the
 * engine total it stands for, so a table that lists these lines under that total adds up.
 * Pure functions over runProjections output; no engine math lives here.
 *
 * Revenue classification follows the engine:
 *   - WA Charter: operatingRevenue = the 14 Commission lines + recurring custom lines;
 *     interest, startup grants and one-time custom lines are non-operating.
 *   - Generic pathways: operatingRevenue = tuition or per-pupil + fees/fundraising + interest;
 *     only startup grants are non-operating.
 */
import type { MultiYearDetailedRow } from './budgetEngine'
import type { FinancialAssumptions } from './types'

export interface LineItem {
  /** Stable across years (custom lines key by their id), so years line up in one table. */
  key: string
  label: string
  amount: number
  /** Shown only when non-zero (in at least one year, for a multi-year table). */
  optional?: boolean
  /** Depreciation: an expense in net position, but no cash leaves the school. */
  nonCash?: boolean
}

type OpsSource = Pick<MultiYearDetailedRow, 'operations'>
type RevenueSource = Pick<MultiYearDetailedRow, 'revenue'>

/** The engine's built-in operations categories, in the Multi-Year table's order. */
export const OPERATIONS_CATEGORIES = [
  { key: 'facilities', label: 'Facilities' },
  { key: 'supplies', label: 'Supplies & Materials' },
  { key: 'contracted', label: 'Contracted Services' },
  { key: 'technology', label: 'Technology' },
  { key: 'authorizerFee', label: 'Authorizer Fee' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'foodService', label: 'Food Service' },
  { key: 'transportation', label: 'Transportation' },
  { key: 'curriculum', label: 'Curriculum & Materials' },
  { key: 'profDev', label: 'Professional Development' },
  { key: 'marketing', label: 'Marketing & Outreach' },
  { key: 'fundraising', label: 'Fundraising' },
] as const

export type OperationsCategoryKey = (typeof OPERATIONS_CATEGORIES)[number]['key']

/**
 * Operations lines whose Year 1 amount the Operations tab also keeps as a rate in
 * financial_assumptions: per student (amount ÷ Year 1 enrollment target) or per FTE (amount ÷
 * Year 1 FTE). Saving an amount saves the matching rate; chat-applied changes do the same.
 */
export const OPERATIONS_RATE_MAP: Record<string, { key: keyof FinancialAssumptions; perFte: boolean }> = {
  'Supplies & Materials': { key: 'supplies_per_student', perFte: false },
  'Contracted Services': { key: 'contracted_services_per_student', perFte: false },
  'Technology': { key: 'technology_per_student', perFte: false },
  'Curriculum & Materials': { key: 'curriculum_per_student', perFte: false },
  'Professional Development': { key: 'professional_development_per_fte', perFte: true },
  'Marketing & Outreach': { key: 'marketing_per_student', perFte: false },
  'Food Service': { key: 'food_service_per_student', perFte: false },
  'Transportation': { key: 'transportation_per_student', perFte: false },
}

export const CONTINGENCY_LABEL = 'Misc/Contingency'
export const DEPRECIATION_LABEL = 'Facility Depreciation (non-cash)'
export const FACILITY_INTEREST_LABEL = 'Facility Loan Interest'

/**
 * Operations lines for one engine row: the 12 built-in categories, contingency, each custom
 * expense line, then facility depreciation and loan interest when the school finances its
 * facility. Sums to row.operations.total.
 */
export function operationsLines(row: OpsSource): LineItem[] {
  const ops = row.operations
  const lines: LineItem[] = OPERATIONS_CATEGORIES.map((c) => ({ key: c.key, label: c.label, amount: ops[c.key] }))
  lines.push({ key: 'contingency', label: CONTINGENCY_LABEL, amount: ops.contingency })
  // Keyed by position + id: ids can repeat (legacy lines fall back to their name), and the
  // list is the same profile list every year, so a position lines up across years.
  const customExpense = ops.customExpense ?? []
  customExpense.forEach((c, i) => {
    lines.push({ key: `custom-expense:${i}:${c.id}`, label: c.name || 'Custom expense', amount: c.amount })
  })
  if (ops.depreciation !== undefined) {
    lines.push({ key: 'depreciation', label: DEPRECIATION_LABEL, amount: ops.depreciation, nonCash: true })
  }
  if (ops.interest !== undefined) {
    lines.push({ key: 'facilityInterest', label: FACILITY_INTEREST_LABEL, amount: ops.interest })
  }
  return lines
}

export interface RevenueOptions {
  /** 'wa_charter' runs the WA engine; anything else the generic engine (runProjections). */
  pathway?: string | null
  /** Generic pathways: 'tuition' or 'per_pupil' (labels only). */
  revenueModel?: string | null
}

export interface RevenueBreakdown {
  /** Sums to operatingTotal. */
  operating: LineItem[]
  /** row.revenue.operatingRevenue. */
  operatingTotal: number
  /** Sums to total − operatingTotal. */
  nonOperating: LineItem[]
  /** row.revenue.total. */
  total: number
}

const WA_OPERATING: { key: keyof MultiYearDetailedRow['revenue']; label: string; optional?: boolean }[] = [
  { key: 'regularEd', label: 'Regular Ed Apportionment' },
  { key: 'sped', label: 'SPED Apportionment' },
  { key: 'stateSped', label: 'State Special Education' },
  { key: 'facilitiesRev', label: 'Facilities Revenue' },
  { key: 'levyEquity', label: 'Levy Equity' },
  { key: 'titleI', label: 'Title I' },
  { key: 'idea', label: 'IDEA (Federal Special Ed)' },
  { key: 'lap', label: 'LAP' },
  { key: 'lapHighPoverty', label: 'LAP High Poverty' },
  { key: 'tbip', label: 'TBIP' },
  { key: 'hicap', label: 'HiCap' },
  { key: 'smallSchoolEnhancement', label: 'Small School Enhancement', optional: true },
  { key: 'foodServiceRev', label: 'Food Service (NSLP)', optional: true },
  { key: 'transportationRev', label: 'Transportation (State)', optional: true },
]

export function isWaPathway(pathway?: string | null): boolean {
  return pathway === 'wa_charter'
}

/** Revenue lines for one engine row, split the way the engine classifies them. */
export function revenueBreakdown(row: RevenueSource, opts: RevenueOptions = {}): RevenueBreakdown {
  const r = row.revenue
  const custom = r.customRevenue ?? []
  const grants: LineItem = { key: 'grants', label: 'Startup & Other Grants', amount: r.grantRevenue, optional: true }

  if (isWaPathway(opts.pathway)) {
    const operating: LineItem[] = WA_OPERATING.map((l) => ({
      key: l.key,
      label: l.label,
      amount: r[l.key] as number,
      ...(l.optional ? { optional: true } : {}),
    }))
    custom.forEach((c, i) => {
      if (c.recurring) operating.push({ key: `custom-revenue:${i}:${c.id}`, label: c.name || 'Custom revenue', amount: c.amount })
    })
    const nonOperating: LineItem[] = [
      { key: 'interest', label: 'Interest & Other Income', amount: r.interestIncome },
      grants,
    ]
    custom.forEach((c, i) => {
      if (!c.recurring) nonOperating.push({ key: `custom-revenue:${i}:${c.id}`, label: `${c.name || 'Custom revenue'} (one-time)`, amount: c.amount, optional: true })
    })
    return { operating, operatingTotal: r.operatingRevenue, nonOperating, total: r.total }
  }

  // Generic engine: regularEd carries tuition (net of aid) or per-pupil revenue; registration
  // fees and fundraising are folded into operatingRevenue without their own fields, and so is
  // interest income.
  const tuition = opts.revenueModel === 'tuition'
  const other = r.operatingRevenue - r.interestIncome - r.regularEd
  const operating: LineItem[] = [
    { key: 'regularEd', label: tuition ? 'Net Tuition Revenue' : 'Per-Pupil Revenue', amount: r.regularEd },
    { key: 'otherOperating', label: tuition ? 'Registration Fees & Fundraising' : 'Fundraising', amount: other, optional: true },
    { key: 'interest', label: 'Interest Income', amount: r.interestIncome, optional: true },
  ]
  return { operating, operatingTotal: r.operatingRevenue, nonOperating: [grants], total: r.total }
}

/** All revenue lines (operating, then non-operating). Sums to row.revenue.total. */
export function revenueLines(row: RevenueSource, opts: RevenueOptions = {}): LineItem[] {
  const b = revenueBreakdown(row, opts)
  return [...b.operating, ...b.nonOperating]
}

/** Drop optional lines that are $0. Never changes the sum. */
export function visibleLines(lines: LineItem[]): LineItem[] {
  return lines.filter((l) => !l.optional || l.amount !== 0)
}

export interface LineSeries {
  key: string
  label: string
  nonCash?: boolean
  /** One value per input year (0 where that year has no such line). */
  values: number[]
}

/**
 * Lines of several years as table rows, matched by key in first-seen order. Optional lines
 * that are $0 in every year are dropped (they add nothing to any year's sum).
 */
export function lineSeries(perYear: LineItem[][]): LineSeries[] {
  const order: string[] = []
  const meta = new Map<string, { label: string; nonCash?: boolean; optional: boolean }>()
  perYear.forEach((lines) => {
    for (const l of lines) {
      const m = meta.get(l.key)
      if (!m) {
        order.push(l.key)
        meta.set(l.key, { label: l.label, nonCash: l.nonCash, optional: !!l.optional })
      } else if (!l.optional) {
        m.optional = false
      }
    }
  })
  const series: LineSeries[] = []
  for (const key of order) {
    const m = meta.get(key)!
    const values = perYear.map((lines) => lines.filter((l) => l.key === key).reduce((s, l) => s + l.amount, 0))
    if (m.optional && values.every((v) => v === 0)) continue
    series.push({ key, label: m.label, ...(m.nonCash ? { nonCash: true } : {}), values })
  }
  return series
}

export function sumLines(lines: { amount: number }[]): number {
  return lines.reduce((s, l) => s + l.amount, 0)
}
