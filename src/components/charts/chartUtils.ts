'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Shared pieces for the dashboard's hand-rolled SVG charts. Series hues are categorical
 * slots 1-2 of the validated dataviz palette (CVD-separated on white); the green / amber /
 * red status hues come only from healthThresholds.ts, so a series never looks like a verdict.
 */
export const SERIES = {
  primary: '#2a78d6',
  secondary: '#eb6834',
} as const

/** Chart chrome: hairline grid and axis text in the app's slate tokens. */
export const CHROME = {
  grid: '#E2E8F0',
  axis: '#CBD5E1',
  text: '#64748B',
  strong: '#0F172A',
  surface: '#FFFFFF',
} as const

/** Round step (1, 2, 2.5 or 5 × 10^n) that splits a span into about `count` intervals. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return step * mag
}

/**
 * Clean axis ticks covering [min, max]; the domain always includes 0 so bars and areas
 * grow from a real baseline and a negative balance shows below it.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  let lo = Math.min(0, min)
  let hi = Math.max(0, max)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (hi === lo) hi = lo + 1
  const step = niceStep(hi - lo, count)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

/** Linear scale from a domain to a pixel range. */
export function linear(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * k
}

/** Compact currency for axis ticks and direct labels: $0, $250K, $1.2M, −$40K. */
export function compactMoney(n: number): string {
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${sign}$${trim(a / 1_000_000)}M`
  if (a >= 1_000) return `${sign}$${trim(a / 1_000)}K`
  return `${sign}$${Math.round(a)}`
}

function trim(v: number): string {
  const fixed = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

/** Width of a container element, tracked with ResizeObserver so SVG text stays at real pixel size. */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // The observer reports the element's size once on observe (before paint), then on change.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}
