'use client'

import type { ReactNode } from 'react'

export interface TooltipRow {
  key: string
  /** Line key (series stroke color) shown before the label; omit for plain rows. */
  color?: string
  label: string
  value: string
  /** Small status pill after the value (text + color, never color alone). */
  pill?: { text: string; className: string }
}

/**
 * Hover/focus readout for the SVG charts. Values lead (strong), labels follow (muted).
 * Positioned in the chart container's pixel space and kept inside it.
 */
export function ChartTooltip({
  x, y, containerWidth, title, rows, footer,
}: {
  x: number
  y: number
  containerWidth: number
  title: string
  rows: TooltipRow[]
  footer?: ReactNode
}) {
  const width = 200
  const left = Math.min(Math.max(0, x + 12 + width > containerWidth ? x - width - 12 : x + 12), Math.max(0, containerWidth - width))
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y - 8), width }}
    >
      <div className="mb-1 font-semibold text-slate-700">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 py-0.5">
          {r.color && <span aria-hidden="true" className="inline-block h-[2px] w-3 rounded" style={{ background: r.color }} />}
          <span className="font-semibold tabular-nums text-slate-900">{r.value}</span>
          <span className="truncate text-slate-500">{r.label}</span>
          {r.pill && <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${r.pill.className}`}>{r.pill.text}</span>}
        </div>
      ))}
      {footer && <div className="mt-1 border-t border-slate-100 pt-1 text-[11px] text-slate-500">{footer}</div>}
    </div>
  )
}
