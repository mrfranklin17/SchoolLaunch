/**
 * Data shaping for the dashboard charts (Cash Flow, Overview, Multi-Year). Pure functions over
 * engine output so the charts plot exactly the numbers the tables show.
 */
import type { CashFlowMonth } from './budgetEngine'
import {
  classify, evaluateDaysOfCash, getDaysOfCashBand,
  type HealthPathway, type HealthStatus, type HealthVerdict,
} from './healthThresholds'

export interface ReserveLine {
  /** Days of cash this line stands for (e.g. 30 = Stage 1 target). */
  days: number
  /** The same reserve in dollars: days × daily cash expense. */
  dollars: number
  /** 'meets' for the target line, 'approaching' for the floor below it. */
  status: Extract<HealthVerdict, 'meets' | 'approaching'>
  label: string
}

export interface MonthlyCashPoint {
  month: string
  /** Cash on hand at month end. */
  balance: number
  netCashFlow: number
  /** Month-end balance expressed as days of the year's cash expenses. */
  days: number | null
  /** The balance read against the year's Days-of-Cash band. */
  status: HealthStatus
}

/** Daily cash expense used by the Days-of-Cash formula: (expenses − depreciation) / 365. */
export function dailyCashExpense(totalExpenses: number, depreciation = 0): number {
  return (totalExpenses - depreciation) / 365
}

/**
 * The year's Days-of-Cash band drawn as dollar lines on a cash-balance chart. WA Year 1-2 is
 * Stage 1 (target 30 days, floor 21); Year 3+ is Stage 2 (60 / 30); generic schools 60 / 30.
 */
export function reserveLines(
  totalExpenses: number,
  depreciation: number,
  year: number,
  pathway: HealthPathway,
): ReserveLine[] {
  const daily = dailyCashExpense(totalExpenses, depreciation)
  if (!(daily > 0)) return []
  const band = getDaysOfCashBand(year, pathway)
  const name = band.stage ? `Stage ${band.stage}` : 'benchmark'
  return [
    { days: band.meetsAt, dollars: band.meetsAt * daily, status: 'meets', label: `${band.meetsAt} days (${name} target)` },
    { days: band.approachingAt, dollars: band.approachingAt * daily, status: 'approaching', label: `${band.approachingAt} days (${name} floor)` },
  ]
}

/** Month-end balances from computeMonthlyCashFlow, each read against the year's band. */
export function monthlyCashSeries(
  months: CashFlowMonth[],
  totalExpenses: number,
  depreciation: number,
  year: number,
  pathway: HealthPathway,
): MonthlyCashPoint[] {
  const daily = dailyCashExpense(totalExpenses, depreciation)
  const band = getDaysOfCashBand(year, pathway)
  return months.map((m) => {
    const days = daily > 0 ? m.cumulativeBalance / daily : null
    return {
      month: m.month,
      balance: m.cumulativeBalance,
      netCashFlow: m.netCashFlow,
      days,
      status: days === null ? 'na' : classify(days, band),
    }
  })
}

/** Index of the lowest month-end balance (the first one on ties), or -1 for no months. */
export function lowestPointIndex(points: { balance: number }[]): number {
  let idx = -1
  points.forEach((p, i) => { if (idx < 0 || p.balance < points[idx].balance) idx = i })
  return idx
}

export interface FiveYearPoint {
  year: number
  revenue: number
  expenses: number
  endingCash: number
  days: number
  /** Days of cash read against that year's band (Stage 1 for Years 1-2, Stage 2 after). */
  daysStatus: HealthStatus
  daysLabel: string
  /** The year's Days-of-Cash target, which steps up at Stage 2. */
  targetDays: number
}

/** Five-year trend rows from the engine's multi-year output. */
export function fiveYearSeries(
  rows: { year: number; revenue: { total: number }; totalExpenses: number; endingCash: number; reserveDays: number }[],
  pathway: HealthPathway,
): FiveYearPoint[] {
  return rows.map((r) => {
    const evaluation = evaluateDaysOfCash(r.reserveDays, r.year, pathway)
    return {
      year: r.year,
      revenue: r.revenue.total,
      expenses: r.totalExpenses,
      endingCash: r.endingCash,
      days: r.reserveDays,
      daysStatus: evaluation.status,
      daysLabel: evaluation.short,
      targetDays: evaluation.band.meetsAt,
    }
  })
}
