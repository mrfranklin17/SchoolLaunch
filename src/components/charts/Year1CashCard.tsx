'use client'

import type { ReactNode } from 'react'
import type { MonthlyCashFlow } from '@/lib/budgetEngine'
import { healthColor, healthPathway } from '@/lib/healthThresholds'
import { lowestPointIndex, monthlyCashSeries, reserveLines } from '@/lib/chartData'
import { formatCurrency } from '@/lib/format'
import { MonthlyCashChart } from './MonthlyCashChart'

/**
 * Card around the Year 1 month-end cash chart, shared by the Cash Flow tab and Overview.
 * `cashFlow` is computeMonthlyCashFlow's output for the same engine row passed as `row`.
 */
export function Year1CashCard({
  cashFlow,
  row,
  pathway,
  compact = false,
  action,
}: {
  cashFlow: MonthlyCashFlow
  row: { totalExpenses: number; operations: { depreciation?: number } }
  pathway: string | null | undefined
  compact?: boolean
  action?: ReactNode
}) {
  const hp = healthPathway(pathway)
  const depreciation = row.operations.depreciation ?? 0
  const points = monthlyCashSeries(cashFlow.months, row.totalExpenses, depreciation, 1, hp)
  const lines = reserveLines(row.totalExpenses, depreciation, 1, hp)
  const low = lowestPointIndex(points)
  if (points.length === 0) return null

  const lowPoint = points[low]
  const target = lines[0]
  const belowTarget = points.filter((p) => p.status === 'approaching' || p.status === 'fails').map((p) => p.month)
  const lowMonthsText = cashFlow.lowScheduleMonths.length > 0
    ? `Shaded months (${cashFlow.lowScheduleMonths.join(', ')}) have the smallest ${cashFlow.usesOspiSchedule ? 'OSPI apportionment payments' : 'scheduled payments'}.`
    : ''
  const summary = target
    ? belowTarget.length === 0
      ? `Cash stays above the ${target.days}-day line all year.`
      : `Cash dips below the ${target.days}-day line in ${belowTarget.join(', ')}.`
    : ''

  return (
    <div data-tour="cash-chart" className={`bg-white border border-slate-200 rounded-xl shadow-sm mb-6 ${compact ? 'p-5' : 'p-6'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <div>
          <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Year 1 Month-End Cash</h2>
          <p className="text-sm text-slate-600 mt-1">
            Lowest: <strong className="text-slate-800">{formatCurrency(lowPoint.balance)}</strong> in {lowPoint.month}
            {lowPoint.days !== null && <> (≈ {Math.round(lowPoint.days)} days of cash)</>}. {summary}
          </p>
        </div>
        {action}
      </div>
      <MonthlyCashChart
        points={points}
        lines={lines}
        lowMonths={cashFlow.lowScheduleMonths}
        compact={compact}
        height={compact ? 180 : 260}
        ariaLabel={`Year 1 month-end cash balance from ${points[0].month} to ${points[points.length - 1].month}. ${summary} Lowest ${formatCurrency(lowPoint.balance)} in ${lowPoint.month}.`}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
        {lines.map((l) => (
          <span key={l.days} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: healthColor(l.status, 'hexDot') }} />
            {l.label} · {formatCurrency(l.dollars, 'compact')}
          </span>
        ))}
        {lowMonthsText && <span className="text-slate-400">{lowMonthsText}</span>}
      </div>
    </div>
  )
}
