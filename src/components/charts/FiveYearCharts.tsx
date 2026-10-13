'use client'

import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { healthColor } from '@/lib/healthThresholds'
import type { FiveYearPoint } from '@/lib/chartData'
import { formatCurrency } from '@/lib/format'
import { CHROME, SERIES, compactMoney, linear, niceTicks, useElementWidth } from './chartUtils'
import { ChartTooltip } from './ChartTooltip'

/** Arrow-key and pointer handling shared by both five-year charts. */
function useYearCursor(count: number) {
  const [active, setActive] = useState<number | null>(null)
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      setActive((a) => Math.min(count - 1, Math.max(0, (a ?? 0) + step)))
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }
  const pick = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * count)
    setActive(Math.min(count - 1, Math.max(0, i)))
  }
  return { active, setActive, onKey, pick }
}

/** One-word verdict under a column: 'Meets Stage 1' → 'Meets', 'Needs attention' → 'Attention'. */
function columnVerdict(label: string): string {
  return label === 'Needs attention' ? 'Attention' : label.split(' ')[0]
}

const svgProps = 'block outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded'

/** Total revenue vs total expenses, Years 1–5, on one dollar axis. */
export function RevenueExpenseChart({ points, height = 220 }: { points: FiveYearPoint[]; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const { active, setActive, onKey, pick } = useYearCursor(points.length)
  if (points.length === 0) return null

  const values = points.flatMap((p) => [p.revenue, p.expenses])
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4)
  const tickLabels = ticks.map(compactMoney)
  const m = { top: 14, right: 16, bottom: 24, left: Math.max(...tickLabels.map((t) => t.length)) * 6.5 + 10 }
  const plotW = Math.max(10, width - m.left - m.right)
  const plotH = height - m.top - m.bottom
  const band = plotW / points.length
  const x = (i: number) => m.left + band * (i + 0.5)
  const y = linear(ticks[0], ticks[ticks.length - 1], m.top + plotH, m.top)
  const series = [
    { key: 'revenue' as const, label: 'Revenue', color: SERIES.primary },
    { key: 'expenses' as const, label: 'Expenses', color: SERIES.secondary },
  ]
  const a = active !== null ? points[active] : null
  const last = points[points.length - 1]

  return (
    <div>
      {/* Legend (always present for two series) */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-[2px] w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative w-full select-none">
        <svg
          width={width} height={height} role="img" tabIndex={0}
          aria-label={`Revenue and expenses, Years 1 to ${last.year}. Year ${last.year}: revenue ${formatCurrency(last.revenue)}, expenses ${formatCurrency(last.expenses)}.`}
          onKeyDown={onKey} onFocus={() => setActive((v) => v ?? 0)} onBlur={() => setActive(null)} className={svgProps}
        >
          {ticks.map((t, i) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? CHROME.axis : CHROME.grid} strokeWidth={1} />
              <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHROME.text}>{tickLabels[i]}</text>
            </g>
          ))}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + plotH} stroke={CHROME.axis} strokeWidth={1} />}
          {series.map((s) => (
            <g key={s.key}>
              <path
                d={points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('')}
                fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              />
              {points.map((p, i) => (i === points.length - 1 || i === active) && (
                <circle key={i} cx={x(i)} cy={y(p[s.key])} r={i === active ? 5 : 4} fill={s.color} stroke={CHROME.surface} strokeWidth={2} />
              ))}
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.year} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={CHROME.text}>Y{p.year}</text>
          ))}
          <rect x={m.left} y={m.top} width={plotW} height={plotH} fill="transparent" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} />
        </svg>
        {a && active !== null && (
          <ChartTooltip
            x={x(active)} y={Math.min(y(Math.max(a.revenue, a.expenses)), height - 100)} containerWidth={width}
            title={`Year ${a.year}`}
            rows={[
              { key: 'rev', color: SERIES.primary, label: 'revenue', value: formatCurrency(a.revenue) },
              { key: 'exp', color: SERIES.secondary, label: 'expenses', value: formatCurrency(a.expenses) },
              { key: 'net', label: 'net', value: formatCurrency(a.revenue - a.expenses) },
            ]}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Days of cash per year as columns colored by that year's band, with the target drawn as a
 * step (WA: 30 days in Stage 1, 60 from Year 3). Each column carries its value and verdict.
 */
export function DaysOfCashChart({ points, height = 220 }: { points: FiveYearPoint[]; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const { active, setActive, onKey, pick } = useYearCursor(points.length)
  if (points.length === 0) return null

  const ticks = niceTicks(Math.min(...points.map((p) => p.days)), Math.max(...points.flatMap((p) => [p.days, p.targetDays])), 4)
  const m = { top: 18, right: 12, bottom: 38, left: Math.max(...ticks.map((t) => String(t).length)) * 6.5 + 12 }
  const plotW = Math.max(10, width - m.left - m.right)
  const plotH = height - m.top - m.bottom
  const band = plotW / points.length
  const barW = Math.min(24, band * 0.5)
  const x = (i: number) => m.left + band * (i + 0.5)
  const y = linear(ticks[0], ticks[ticks.length - 1], m.top + plotH, m.top)
  const zero = y(0)
  const a = active !== null ? points[active] : null
  const targetColor = healthColor('meets', 'hexDot')

  // Column with a 4px rounded data end and a square baseline end (handles negative values).
  const column = (cx: number, value: number) => {
    const top = y(value)
    const h = Math.abs(zero - top)
    const r = Math.min(4, h)
    const left = cx - barW / 2
    if (value >= 0) {
      return `M${left},${zero}V${top + r}Q${left},${top} ${left + r},${top}H${left + barW - r}Q${left + barW},${top} ${left + barW},${top + r}V${zero}Z`
    }
    return `M${left},${zero}V${top - r}Q${left},${top} ${left + r},${top}H${left + barW - r}Q${left + barW},${top} ${left + barW},${top - r}V${zero}Z`
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: targetColor }} />
          Target days of cash
        </span>
      </div>
      <div ref={ref} className="relative w-full select-none">
        <svg
          width={width} height={height} role="img" tabIndex={0}
          aria-label={`Days of cash by year: ${points.map((p) => `Year ${p.year} ${p.days} days, ${p.daysLabel}`).join('; ')}.`}
          onKeyDown={onKey} onFocus={() => setActive((v) => v ?? 0)} onBlur={() => setActive(null)} className={svgProps}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? CHROME.axis : CHROME.grid} strokeWidth={1} />
              <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHROME.text}>{t}</text>
            </g>
          ))}
          {points.map((p, i) => (
            <g key={p.year}>
              {active === i && <rect x={x(i) - band / 2} y={m.top} width={band} height={plotH} fill="#F8FAFC" />}
              <path d={column(x(i), p.days)} fill={healthColor(p.daysStatus, 'hexDot')} />
              <text x={x(i)} y={p.days >= 0 ? y(p.days) - 5 : y(p.days) + 13} textAnchor="middle" fontSize={11} fontWeight={600} fill={CHROME.strong}>{p.days}</text>
              <text x={x(i)} y={height - 22} textAnchor="middle" fontSize={11} fill={CHROME.text}>Y{p.year}</text>
              <text x={x(i)} y={height - 8} textAnchor="middle" fontSize={10} fill={healthColor(p.daysStatus, 'hexFg')}>
                {columnVerdict(p.daysLabel)}
              </text>
            </g>
          ))}
          {/* Target step: one segment per year's band */}
          {points.map((p, i) => (
            <line key={`t-${p.year}`} x1={x(i) - band / 2 + 2} x2={x(i) + band / 2 - 2} y1={y(p.targetDays)} y2={y(p.targetDays)} stroke={targetColor} strokeWidth={1.5} strokeDasharray="5 4" />
          ))}
          <rect x={m.left} y={m.top} width={plotW} height={plotH} fill="transparent" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} />
        </svg>
        {a && active !== null && (
          <ChartTooltip
            x={x(active)} y={Math.min(y(Math.max(a.days, a.targetDays)), height - 100)} containerWidth={width}
            title={`Year ${a.year}`}
            rows={[
              { key: 'days', label: 'days of cash', value: `${a.days}`, pill: { text: a.daysLabel, className: healthColor(a.daysStatus, 'twPill') } },
              { key: 'target', label: 'target', value: `${a.targetDays}` },
              { key: 'cash', label: 'ending cash', value: formatCurrency(a.endingCash) },
            ]}
          />
        )}
      </div>
    </div>
  )
}
