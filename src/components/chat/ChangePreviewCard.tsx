'use client'

import { useId, useMemo } from 'react'
import Link from 'next/link'
import { useScenario } from '@/lib/ScenarioContext'
import { CHANGE_TAB, describeChange, validateChange, type ChangeLine, type PlanChange, type PlanSnapshot } from '@/lib/chatEdits'
import { PREVIEW_YEARS, previewChanges, type ChangePreview, type MetricFormat } from '@/lib/chatPreview'
import { formatCurrency, formatDays, formatPercent } from '@/lib/format'

function fmt(n: number, format: MetricFormat): string {
  switch (format) {
    case 'currency': return formatCurrency(n)
    case 'days': return formatDays(n)
    case 'percent': return formatPercent(n, 1)
    case 'students': return `${Math.round(n)}`
  }
}

/** Signed difference, e.g. "+$42,000" or "−3 days"; null when unchanged at display precision. */
function delta(before: number, after: number, format: MetricFormat): string | null {
  const d = after - before
  const shown = format === 'percent' ? Math.round(d * 10) / 10 : Math.round(d)
  if (shown === 0) return null
  const sign = shown > 0 ? '+' : '−'
  const abs = Math.abs(shown)
  switch (format) {
    case 'currency': return `${sign}${formatCurrency(abs)}`
    case 'days': return `${sign}${abs} days`
    case 'percent': return `${sign}${abs.toFixed(1)} pts`
    case 'students': return `${sign}${abs}`
  }
}

/**
 * Phase 6a: a change the chat proposed, shown as before → after with its effect on the
 * school's numbers. Preview only: nothing is saved, and the card links to the tabs where the
 * founder can make the change today.
 */
export function ChangePreviewCard({ changes }: { changes: PlanChange[] }) {
  const { schoolData, projectionInputs } = useScenario()
  const headingId = useId()
  const { profile, allPositions, projections, gradeExpansionPlan } = schoolData

  const result = useMemo((): { errors: string[] } | { lines: ChangeLine[]; preview: ChangePreview } => {
    const snapshot: PlanSnapshot = { profile, allPositions, projections, gradeExpansionPlan }
    // The plan may have changed since the chat proposed this (another tab, a teammate).
    const errors = changes.map((c) => validateChange(c, snapshot)).filter((e): e is string => !!e)
    if (errors.length > 0) return { errors }
    return {
      lines: changes.flatMap((c) => describeChange(c, snapshot)),
      preview: previewChanges(projectionInputs, snapshot, changes),
    }
  }, [changes, profile, allPositions, projections, gradeExpansionPlan, projectionInputs])

  const tabs = [...new Map(changes.map((c) => [CHANGE_TAB[c.kind].href, CHANGE_TAB[c.kind]])).values()]

  return (
    <article
      aria-labelledby={headingId}
      data-testid="change-preview"
      className="w-full sm:max-w-[75%] min-w-0 bg-white border border-teal-200 rounded-2xl rounded-tl-sm overflow-hidden"
    >
      <header className="px-4 py-2.5 bg-teal-50 border-b border-teal-200 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-teal-800">Proposed change</h2>
        <span className="text-xs font-medium text-slate-600">Preview only — nothing has been saved</span>
      </header>

      {'errors' in result ? (
        <div role="alert" className="px-4 py-3 text-sm text-red-700">
          This change no longer fits your current plan, so it can&rsquo;t be previewed:
          <ul className="mt-1 list-disc pl-5">
            {result.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      ) : (
        <>
          <ul className="px-4 py-3 space-y-1.5 text-sm border-b border-slate-100">
            {result.lines.map((l) => (
              <li key={l.label} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-slate-700">{l.label}:</span>
                <span className="text-slate-500 line-through decoration-slate-400">{l.before}</span>
                <span aria-hidden="true" className="text-slate-500">→</span>
                <span className="sr-only">changes to</span>
                <span className="font-semibold text-slate-900">{l.after}</span>
              </li>
            ))}
          </ul>

          <div className="px-4 py-3 overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Effect on the plan, before and after the change</caption>
              <thead>
                <tr className="text-left text-slate-500">
                  <th scope="col" className="font-medium pb-1.5 pr-2">Effect</th>
                  {PREVIEW_YEARS.map((y) => (
                    <th key={y} scope="col" className="font-medium pb-1.5 pl-2 text-right">Year {y}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.preview.metrics.map((m) => (
                  <tr key={m.label} className="border-t border-slate-100">
                    <th scope="row" className="font-normal text-slate-600 py-1.5 pr-2 text-left">{m.label}</th>
                    {PREVIEW_YEARS.map((y, i) => {
                      const d = delta(m.before[i], m.after[i], m.format)
                      return (
                        <td key={y} className="py-1.5 pl-2 text-right tabular-nums">
                          <span className={d ? 'font-semibold text-slate-900' : 'text-slate-600'}>{fmt(m.after[i], m.format)}</span>
                          {d && <span className="block text-[11px] text-slate-500">{d} (was {fmt(m.before[i], m.format)})</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="border-t border-slate-100">
                  <th scope="row" className="font-normal text-slate-600 py-1.5 pr-2 text-left">Commission measures met</th>
                  {PREVIEW_YEARS.map((y, i) => {
                    const { before, after, total } = result.preview.fpfMeets
                    return (
                      <td key={y} className="py-1.5 pl-2 text-right tabular-nums">
                        <span className={before[i] !== after[i] ? 'font-semibold text-slate-900' : 'text-slate-600'}>{after[i]} of {total}</span>
                        {before[i] !== after[i] && <span className="block text-[11px] text-slate-500">was {before[i]}</span>}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <footer className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">
        Applying changes from chat is coming soon. To make this change now, use{' '}
        {tabs.map((t, i) => (
          <span key={t.href}>
            {i > 0 && (i === tabs.length - 1 ? ' and ' : ', ')}
            <Link href={t.href} className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800">
              {t.label}
            </Link>
          </span>
        ))}
        .
      </footer>
    </article>
  )
}
