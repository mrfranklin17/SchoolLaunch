'use client'

import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { healthColor, type HealthStatus } from '@/lib/healthThresholds'
import { lowestPointIndex, type MonthlyCashPoint, type ReserveLine } from '@/lib/chartData'
import { formatCurrency } from '@/lib/format'
import { CHROME, SERIES, compactMoney, linear, niceTicks, useElementWidth } from './chartUtils'
import { ChartTooltip } from './ChartTooltip'

const STATUS_TEXT: Record<HealthStatus, string> = {
  meets: 'Above target',
  approaching: 'Below target',
  fails: 'Below floor',
  na: 'N/A',
}

/**
 * Year 1 month-end cash balance (Sep–Aug) against the year's Days-of-Cash lines. Months
 * with the smallest scheduled payments are shaded; months under the target get a status
 * marker; the lowest month is labeled. Hover or arrow keys give each month's readout.
 */
export function MonthlyCashChart({
  points,
  lines,
  lowMonths = [],
  height = 240,
  compact = false,
  ariaLabel,
}: {
  points: MonthlyCashPoint[]
  lines: ReserveLine[]
  lowMonths?: string[]
  height?: number
  compact?: boolean
  ariaLabel: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  if (points.length === 0) return null

  const values = [...points.map((p) => p.balance), ...lines.map((l) => l.dollars)]
  const ticks = niceTicks(Math.min(...values), Math.max(...values), compact ? 3 : 4)
  const tickLabels = ticks.map(compactMoney)
  const m = { top: 14, right: 12, bottom: 24, left: Math.max(...tickLabels.map((t) => t.length)) * 6.5 + 10 }
  const plotW = Math.max(10, width - m.left - m.right)
  const plotH = height - m.top - m.bottom
  const band = plotW / points.length
  const x = (i: number) => m.left + band * (i + 0.5)
  const y = linear(ticks[0], ticks[ticks.length - 1], m.top + plotH, m.top)
  const baseline = y(Math.max(ticks[0], 0))
  const low = lowestPointIndex(points)
  const labelEvery = band < 26 ? 2 : 1

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('')
  const area = `${path}L${x(points.length - 1).toFixed(1)},${baseline.toFixed(1)}L${x(0).toFixed(1)},${baseline.toFixed(1)}Z`

  function pick(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * points.length)
    setActive(Math.min(points.length - 1, Math.max(0, i)))
  }
  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? low) + step)))
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  const a = active !== null ? points[active] : null

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setActive((v) => v ?? low)}
        onBlur={() => setActive(null)}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded"
      >
        {/* Shaded months: the smallest scheduled payments (WA: OSPI Nov and May) */}
        {points.map((p, i) => lowMonths.includes(p.month) && (
          <rect key={`low-${p.month}`} x={x(i) - band / 2} y={m.top} width={band} height={plotH} fill="#F1F5F9" />
        ))}

        {/* Grid + y ticks */}
        {ticks.map((t, i) => (
          <g key={t}>
            <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? CHROME.axis : CHROME.grid} strokeWidth={1} />
            <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHROME.text} className="tabular-nums">{tickLabels[i]}</text>
          </g>
        ))}

        {/* Days-of-Cash lines: status-colored rules; the card's legend names them */}
        {lines.map((l) => (
          <line key={l.days} x1={m.left} x2={m.left + plotW} y1={y(l.dollars)} y2={y(l.dollars)} stroke={healthColor(l.status, 'hexDot')} strokeWidth={1.5} strokeDasharray="5 4" />
        ))}

        {/* Balance: 10% wash + 2px line */}
        <path d={area} fill={SERIES.primary} opacity={0.1} />
        <path d={path} fill="none" stroke={SERIES.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* Crosshair */}
        {active !== null && (
          <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + plotH} stroke={CHROME.axis} strokeWidth={1} />
        )}

        {/* Markers: months under the target (status color), the lowest month, the hovered month */}
        {points.map((p, i) => {
          const flagged = p.status === 'approaching' || p.status === 'fails'
          if (!flagged && i !== low && i !== active) return null
          return (
            <circle
              key={`pt-${p.month}`}
              cx={x(i)} cy={y(p.balance)} r={i === active ? 5 : 4}
              fill={flagged ? healthColor(p.status, 'hexDot') : SERIES.primary}
              stroke={CHROME.surface} strokeWidth={2}
            />
          )
        })}

        {/* Direct label on the lowest month */}
        {low >= 0 && (
          <text
            x={Math.min(Math.max(x(low), m.left + 40), m.left + plotW - 40)}
            y={y(points[low].balance) + 18 > m.top + plotH ? y(points[low].balance) - 10 : y(points[low].balance) + 18}
            textAnchor="middle" fontSize={11} fontWeight={600} fill={CHROME.strong}
          >
            Low {compactMoney(points[low].balance)}
          </text>
        )}

        {/* X labels */}
        {points.map((p, i) => (i % labelEvery === 0 || i === low) && (
          <text key={`x-${p.month}`} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={i === low ? CHROME.strong : CHROME.text} fontWeight={i === low ? 600 : 400}>
            {p.month}
          </text>
        ))}

        {/* Hit layer: the whole plot finds the nearest month */}
        <rect
          x={m.left} y={m.top} width={plotW} height={plotH} fill="transparent"
          onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)}
        />
      </svg>

      {a && active !== null && (
        <ChartTooltip
          x={x(active)}
          y={Math.min(y(a.balance), height - 120)}
          containerWidth={width}
          title={`${a.month} month-end`}
          rows={[
            {
              key: 'bal', color: SERIES.primary, label: 'cash balance', value: formatCurrency(a.balance),
              pill: a.status !== 'na' ? { text: STATUS_TEXT[a.status], className: healthColor(a.status, 'twPill') } : undefined,
            },
            ...(a.days !== null ? [{ key: 'days', label: 'days of cash', value: `${Math.round(a.days)}` }] : []),
            { key: 'net', label: 'net this month', value: `${a.netCashFlow >= 0 ? '+' : '−'}${formatCurrency(Math.abs(a.netCashFlow))}` },
          ]}
          footer={lowMonths.includes(a.month) ? 'Smaller scheduled payment this month' : undefined}
        />
      )}
    </div>
  )
}
