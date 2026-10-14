// R-REV-03 / R-REV-07: shared model for custom revenue and expense lines.
//
// One JSONB array per kind (custom_revenue_lines, custom_expense_lines), one
// CustomLine shape for both. Math lives here and in computeMultiYearDetailed so
// pages and the Commission export stay pure readers (single source of truth).
//
// Back-compatibility: the GENERIC pathway already stores a flat legacy shape in
// custom_revenue_lines ({ key, label, amount }) consumed by computeGenericProjections.
// The readers below tolerate that shape (name <- label, amountY1 <- amount, driver
// defaults to 'flat') and ignore unknown fields, so the Generic pathway is untouched.

export type CustomLineDriver = 'per_pupil' | 'per_fte' | 'flat' | 'inflation' | 'pct_revenue'

const DRIVERS: CustomLineDriver[] = ['per_pupil', 'per_fte', 'flat', 'inflation', 'pct_revenue']

/** Raw shape as stored (all optional; tolerant of legacy + partial input). */
export interface CustomLine {
  id?: string
  name?: string
  group?: string
  driver?: CustomLineDriver
  amountY1?: number
  rate?: number              // pct_revenue percent (EXPENSE-ONLY, R-REV-07 pass 2)
  escalation?: number | null
  recurring?: boolean        // revenue: true -> operatingRevenue, false -> non-operating. default true.
  perYearOverrides?: Record<number, number> | null
  // legacy generic flat shape:
  key?: string
  label?: string
  amount?: number
}

/** Fully-resolved line used by the engine. */
export interface NormalizedCustomLine {
  id: string
  name: string
  group: string
  driver: CustomLineDriver
  amountY1: number
  rate: number
  escalation: number | null
  recurring: boolean
  perYearOverrides: Record<number, number> | null
}

/** Display name: prefer `name`, fall back to legacy `label`. */
export function customLineName(l: CustomLine): string {
  if (typeof l.name === 'string' && l.name.length > 0) return l.name
  if (typeof l.label === 'string' && l.label.length > 0) return l.label
  return ''
}

/** Base Y1 amount: prefer `amountY1`, fall back to legacy `amount`. */
export function customLineBaseY1(l: CustomLine): number {
  const v = typeof l.amountY1 === 'number' ? l.amountY1
    : typeof l.amount === 'number' ? l.amount
    : 0
  return Number.isFinite(v) ? v : 0
}

/** Normalize one raw entry; returns null for null / non-object garbage (P-UX-11 lesson). */
export function normalizeCustomLine(raw: unknown): NormalizedCustomLine | null {
  if (raw == null || typeof raw !== 'object') return null
  const l = raw as CustomLine
  const driver: CustomLineDriver = DRIVERS.includes(l.driver as CustomLineDriver)
    ? (l.driver as CustomLineDriver)
    : 'flat'
  let overrides: Record<number, number> | null = null
  if (l.perYearOverrides && typeof l.perYearOverrides === 'object') {
    overrides = {}
    for (const k of Object.keys(l.perYearOverrides)) {
      const v = (l.perYearOverrides as Record<string, unknown>)[k]
      if (typeof v === 'number' && Number.isFinite(v)) overrides[Number(k)] = v
    }
  }
  return {
    id: typeof l.id === 'string' && l.id ? l.id : (typeof l.key === 'string' && l.key ? l.key : customLineName(l) || 'custom'),
    name: customLineName(l),
    group: typeof l.group === 'string' ? l.group : '',
    driver,
    amountY1: customLineBaseY1(l),
    rate: typeof l.rate === 'number' && Number.isFinite(l.rate) ? l.rate : 0,
    escalation: typeof l.escalation === 'number' ? l.escalation : null,
    recurring: l.recurring !== false, // default true
    perYearOverrides: overrides,
  }
}

/** Read + normalize a custom_*_lines column value. Non-arrays fail safe to []. */
export function readCustomLines(raw: unknown): NormalizedCustomLine[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeCustomLine).filter((l): l is NormalizedCustomLine => l !== null)
}

export interface CustomLineYearContext {
  enrollment: number      // year-y enrollment
  enrollmentY1: number    // year-1 enrollment (ratio base)
  fte: number             // year-y total FTE
  fteY1: number           // year-1 total FTE (ratio base)
  escalatorMult: number   // escalator^(y-1): revEscalator for revenue, opsEscalator for expense
  recurringRevenueBase?: number // R-REV-07: finalized recurring operating revenue for the year (pct_revenue base)
}

/**
 * Per-year dollar amount for the four ratio drivers. amountY1 is the single
 * source of truth; the per-year value is derived (never separately persisted).
 * perYearOverrides[year] supersedes the driver for that year.
 * pct_revenue returns 0 here (expense-only; the caller computes it after revenue
 * is finalized, R-REV-07 pass 2).
 */
export function customLineYearAmount(line: NormalizedCustomLine, year: number, ctx: CustomLineYearContext): number {
  const ov = line.perYearOverrides
  if (ov && typeof ov[year] === 'number' && Number.isFinite(ov[year])) return Math.round(ov[year])
  const base = line.amountY1
  switch (line.driver) {
    case 'per_pupil': {
      const ratio = ctx.enrollmentY1 > 0 ? ctx.enrollment / ctx.enrollmentY1 : 1
      return Math.round(base * ratio * ctx.escalatorMult)
    }
    case 'per_fte': {
      const ratio = ctx.fteY1 > 0 ? ctx.fte / ctx.fteY1 : 1
      return Math.round(base * ratio * ctx.escalatorMult)
    }
    case 'inflation':
      return Math.round(base * ctx.escalatorMult)
    case 'pct_revenue':
      // R-REV-07 (expense): rate percent x finalized recurring operating revenue for
      // the year. The caller computes this AFTER revenue (incl custom recurring) is
      // final, in the authorizerFee slot. Base excludes one-time money and is not
      // reduced by expenses, so multiple pct_revenue lines never compound.
      return Math.round((line.rate / 100) * (ctx.recurringRevenueBase ?? 0))
    case 'flat':
    default:
      return Math.round(base)
  }
}

export interface CustomLinePreset {
  name: string
  group: string
  driver: CustomLineDriver
}

/**
 * R-REV-03 WA Charter custom REVENUE pre-seed picklist. Sources: SESSION_1_GAPS.md
 * s4 / V11 INPUTS R41-R76. OSPI account codes in names where applicable; not invented.
 * NOTE: OSPI 3121 (SPED General Apportionment) is intentionally NOT pre-seeded - the
 * Cedar Grove reconciliation maps SchoolLaunch's existing SPED apportionment to 3121,
 * so a custom 3121 line would double-count. CSP is not a preset: a CSP startup funding source
 * becomes recurring operating revenue through the csp_operating_revenue switch (R-REV-04).
 */
export const CUSTOM_REVENUE_PRESETS: CustomLinePreset[] = [
  { name: 'Title II (Federal)', group: 'Federal', driver: 'per_pupil' },
  { name: 'Title III (Federal)', group: 'Federal', driver: 'per_pupil' },
  { name: 'State Food Service (4198)', group: 'Program Revenue', driver: 'per_pupil' },
  { name: 'Transportation Operations (4199)', group: 'Program Revenue', driver: 'per_pupil' },
  { name: 'OSPI Special Purpose Unassigned (6100)', group: 'Other', driver: 'flat' },
  { name: 'Sale of Goods/Supplies/Services (2200)', group: 'Other', driver: 'flat' },
]

/** R-REV-07 expense category groups (V11 non-personnel structure). */
export const CUSTOM_EXPENSE_GROUPS = ['Contracted Services', 'School Operations', 'Facility O&M'] as const

/**
 * R-REV-07 WA Charter custom EXPENSE pre-seed picklist. NEW-only (27): the V11
 * sub-lines that have no existing first-class SchoolLaunch ops line. The 10 OVERLAP
 * lines (e.g. Technology, Insurance, Building/Land Rent, supplies, food, transportation)
 * are intentionally NOT seeded - they already have built-in homes and appear in the
 * export, so seeding them would double-count (the 3121 lesson). Computed/out-of-scope
 * lines are also excluded: Oversight Fee (= authorizer fee), Reserves/Contingency,
 * Interest Expense and Depreciation (P-FIN-01/02), and the personnel echoes.
 * Source: tests/audit/v11-cedar-grove/session2/v11_values.json. Drivers are sensible
 * defaults the founder can change in the editor.
 */
export const CUSTOM_EXPENSE_PRESETS: CustomLinePreset[] = [
  // Contracted Services (8)
  { name: 'Accounting / Audit', group: 'Contracted Services', driver: 'flat' },
  { name: 'Legal', group: 'Contracted Services', driver: 'flat' },
  { name: 'Management Company Fee', group: 'Contracted Services', driver: 'pct_revenue' },
  { name: 'Payroll Services', group: 'Contracted Services', driver: 'per_fte' },
  { name: 'Nurse Services', group: 'Contracted Services', driver: 'per_pupil' },
  { name: 'Special Ed Services', group: 'Contracted Services', driver: 'per_pupil' },
  { name: 'Titlement Services', group: 'Contracted Services', driver: 'per_pupil' },
  { name: 'All Other Contracted Services', group: 'Contracted Services', driver: 'flat' },
  // School Operations (13)
  { name: 'Board Expenses', group: 'School Operations', driver: 'flat' },
  { name: 'Special Ed Supplies', group: 'School Operations', driver: 'per_pupil' },
  { name: 'School Ops Equipment/Furniture', group: 'School Operations', driver: 'flat' },
  { name: 'Telephone', group: 'School Operations', driver: 'flat' },
  { name: 'Student Testing & Assessment', group: 'School Operations', driver: 'per_pupil' },
  { name: 'Field Trips', group: 'School Operations', driver: 'per_pupil' },
  { name: 'Student Services Other', group: 'School Operations', driver: 'flat' },
  { name: 'Office Expense', group: 'School Operations', driver: 'flat' },
  { name: 'Staff Recruitment', group: 'School Operations', driver: 'flat' },
  { name: 'Stipends/Bonuses', group: 'School Operations', driver: 'per_fte' },
  { name: 'Extra Curricular', group: 'School Operations', driver: 'per_pupil' },
  { name: 'Misc. Operating Expenses', group: 'School Operations', driver: 'flat' },
  { name: 'All Other School Operations', group: 'School Operations', driver: 'flat' },
  // Facility O&M (6)
  { name: 'Janitorial Services', group: 'Facility O&M', driver: 'inflation' },
  { name: 'Repairs & Maintenance', group: 'Facility O&M', driver: 'inflation' },
  { name: 'Facility Equipment/Furniture', group: 'Facility O&M', driver: 'flat' },
  { name: 'Security Services', group: 'Facility O&M', driver: 'inflation' },
  { name: 'Utilities', group: 'Facility O&M', driver: 'inflation' },
  { name: 'All Other Facilities', group: 'Facility O&M', driver: 'flat' },
]
