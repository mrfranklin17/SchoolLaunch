'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useScenario } from '@/lib/ScenarioContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useChangeRequests } from '@/contexts/ChangeRequestsContext'
import { toast } from '@/components/ui/Toast'
import { unsavedLabels } from '@/lib/unsavedChanges'
import { CHANGE_TAB, canApplyFromChat, describeChange, validateChange, type ChangeLine, type PlanChange, type PlanSnapshot } from '@/lib/chatEdits'
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

type Shown = { errors: string[] } | { lines: ChangeLine[]; preview: ChangePreview }
type Status =
  | 'proposed' | 'confirming' | 'applying' | 'applied' | 'undoing' | 'undone'
  | 'composing' | 'sending' | 'sent' | 'declining' | 'declined' | 'withdrawn'

const HEADER_NOTE: Record<Status, string> = {
  proposed: 'Preview — nothing has been saved',
  confirming: 'Preview — nothing has been saved',
  applying: 'Applying…',
  applied: 'Applied to your live plan',
  undoing: 'Undoing…',
  undone: 'Undone — your plan is back as it was',
  composing: 'Preview — nothing has been saved',
  sending: 'Sending…',
  sent: 'Sent to your Owner',
  declining: 'Preview — nothing has been saved',
  declined: 'Declined — nothing was changed',
  withdrawn: 'Withdrawn — nothing was changed',
}

/** The card shown for an Editor's request (Phase 6c): the Owner reviews it, the Editor can withdraw it. */
export interface CardRequest {
  id: string
  /** The viewer sent this request (Withdraw instead of Apply / Decline). */
  mine: boolean
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { ok: res.ok, data: await res.json().catch(() => ({})) }
  } catch {
    return { ok: false, data: { error: 'Network error — check your connection and try again.' } }
  }
}

/**
 * A change the chat proposed, shown as before → after with its effect on the school's
 * numbers. Owners can apply staffing, operations and grade-plan changes to the live plan
 * after a confirm step, then undo them from the card (Phase 6b). Editors send them to the
 * Owner with an optional note (6c); in the Inbox the Owner applies or declines a request and
 * its sender can withdraw it. Everyone sees the tab where the change can be made by hand.
 */
export function ChangePreviewCard({ changes, request, onResolved, fullWidth = false }: {
  changes: PlanChange[]
  request?: CardRequest
  /** Fill the container (the Inbox) instead of sitting in a chat column. */
  fullWidth?: boolean
  /** Called after the card applies, declines, withdraws or undoes (the Inbox reloads). */
  onResolved?: () => void
}) {
  const { schoolData, projectionInputs } = useScenario()
  const { canApplyPlanChanges, canEdit } = usePermissions()
  const { refresh: refreshInbox } = useChangeRequests()
  const [note, setNote] = useState('')
  const headingId = useId()
  const { schoolId, profile, allPositions, projections, gradeExpansionPlan, reload } = schoolData
  const [status, setStatus] = useState<Status>('proposed')
  const [frozen, setFrozen] = useState<Shown | null>(null)
  const [changeId, setChangeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const live = useMemo((): Shown => {
    const snapshot: PlanSnapshot = { profile, allPositions, projections, gradeExpansionPlan }
    // The plan may have changed since the chat proposed this (another tab, a teammate).
    const errors = changes.map((c) => validateChange(c, snapshot)).filter((e): e is string => !!e)
    if (errors.length > 0) return { errors }
    return {
      lines: changes.flatMap((c) => describeChange(c, snapshot)),
      preview: previewChanges(projectionInputs, snapshot, changes),
    }
  }, [changes, profile, allPositions, projections, gradeExpansionPlan, projectionInputs])
  // Once applied, the card keeps showing what was applied, not the reloaded plan.
  const result = frozen ?? live

  useEffect(() => {
    if (status === 'confirming' || status === 'composing' || status === 'declining') confirmRef.current?.focus()
  }, [status])

  /** After any outcome: the Inbox badge and list may have changed. */
  async function settled() {
    await refreshInbox()
    onResolved?.()
  }

  const tabs = [...new Map(changes.map((c) => [CHANGE_TAB[c.kind].href, CHANGE_TAB[c.kind]])).values()]
  const appliable = canApplyFromChat(changes)
  const unsaved = status === 'confirming' ? unsavedLabels() : []

  async function apply() {
    if ('errors' in live) return
    setStatus('applying')
    setError(null)
    const { ok, data } = await postJson('/api/plan-changes/apply', request
      ? { schoolId, requestId: request.id, expected: live.lines }
      : { schoolId, changes, expected: live.lines })
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not apply the change.')
      setStatus('proposed')
      return
    }
    setFrozen(live)
    setChangeId(typeof data.changeId === 'string' ? data.changeId : null)
    setStatus('applied')
    toast.success('Applied to your live plan')
    await reload()
    await settled()
  }

  /** Editor: send the change to the Owner with the note typed in the card. */
  async function send() {
    setStatus('sending')
    setError(null)
    const { ok, data } = await postJson('/api/change-requests', { schoolId, action: 'create', changes, note })
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not send the change.')
      setStatus('composing')
      return
    }
    setFrozen(live)
    setStatus('sent')
    toast.success('Sent to your Owner')
    await settled()
  }

  /** Owner: decline the request, with the reason typed in the card. */
  async function decline() {
    if (!request) return
    setError(null)
    const { ok, data } = await postJson('/api/change-requests', { schoolId, action: 'decline', requestId: request.id, reason: note })
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not decline the request.')
      return
    }
    setFrozen(live)
    setStatus('declined')
    await settled()
  }

  /** Requester: withdraw their pending request. */
  async function withdraw() {
    if (!request) return
    setError(null)
    const { ok, data } = await postJson('/api/change-requests', { schoolId, action: 'withdraw', requestId: request.id })
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not withdraw the request.')
      return
    }
    setFrozen(live)
    setStatus('withdrawn')
    await settled()
  }

  async function undo() {
    if (!changeId) return
    setStatus('undoing')
    setError(null)
    const { ok, data } = await postJson('/api/plan-changes/undo', { schoolId, changeId })
    if (!ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not undo the change.')
      setStatus('applied')
      return
    }
    setStatus('undone')
    toast.success('Change undone')
    await reload()
    await settled()
  }

  const tabLinks = (
    <>
      {tabs.map((t, i) => (
        <span key={t.href}>
          {i > 0 && (i === tabs.length - 1 ? ' and ' : ', ')}
          <Link href={t.href} className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800">
            {t.label}
          </Link>
        </span>
      ))}
    </>
  )
  const buttonPrimary = 'inline-flex items-center rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:bg-slate-300'
  const buttonSecondary = 'inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-400'

  return (
    <article
      aria-labelledby={headingId}
      data-testid="change-preview"
      className={`w-full ${fullWidth ? '' : 'sm:max-w-[75%] rounded-tl-sm'} min-w-0 bg-white border border-teal-200 rounded-2xl overflow-hidden`}
    >
      <header className="px-4 py-2.5 bg-teal-50 border-b border-teal-200 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-teal-800">
          {status === 'applied' ? 'Applied change' : status === 'undone' ? 'Undone change' : request ? 'Requested change' : 'Proposed change'}
        </h2>
        <span role="status" className="text-xs font-medium text-slate-600">{HEADER_NOTE[status]}</span>
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

      <footer className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-600 space-y-2">
        {error && <p role="alert" className="text-red-700">{error}</p>}

        {status === 'applied' || status === 'undoing' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Your live plan now uses these numbers.</span>
            {changeId && (
              <button type="button" onClick={undo} disabled={status === 'undoing'} className={buttonSecondary}>
                {status === 'undoing' ? 'Undoing…' : 'Undo'}
              </button>
            )}
          </div>
        ) : status === 'undone' ? (
          <p>The plan is back to how it was before this change.</p>
        ) : status === 'sent' ? (
          <p>
            Your Owner will see it in their <Link href="/dashboard/inbox" className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800">Inbox</Link> and can apply or decline it. You can follow it there.
          </p>
        ) : status === 'declined' ? (
          <p>Declined. Your team member will see this in their Inbox.</p>
        ) : status === 'withdrawn' ? (
          <p>Withdrawn. Your Owner no longer sees it as waiting.</p>
        ) : request?.mine ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Waiting for your Owner to review.</span>
            <button type="button" onClick={withdraw} className={buttonSecondary}>Withdraw</button>
          </div>
        ) : 'errors' in live ? (
          <p>To make a change now, use {tabLinks}.</p>
        ) : canApplyPlanChanges && appliable && status === 'declining' ? (
          <div role="group" aria-label="Decline this request" className="space-y-2">
            <label className="block font-semibold text-slate-800" htmlFor={`${headingId}-reason`}>Why are you declining it? (optional; your team member sees this)</label>
            <textarea
              id={`${headingId}-reason`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <div className="flex flex-wrap gap-2">
              <button ref={confirmRef} type="button" onClick={decline} className={buttonPrimary}>Decline request</button>
              <button type="button" onClick={() => setStatus('proposed')} className={buttonSecondary}>Cancel</button>
            </div>
          </div>
        ) : canApplyPlanChanges && appliable ? (
          status === 'confirming' ? (
            <div role="group" aria-label="Confirm applying to the live plan" className="space-y-2">
              <p className="font-semibold text-slate-800">
                This changes your live plan. Every tab, the scorecard and your exports will use the new numbers. You can undo it from this card.
              </p>
              {unsaved.length > 0 && (
                <p className="text-amber-700">You have unsaved edits ({unsaved.join(', ')}). They are not part of this change.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button ref={confirmRef} type="button" onClick={apply} className={buttonPrimary}>Apply to live plan</button>
                <button type="button" onClick={() => setStatus('proposed')} className={buttonSecondary}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button type="button" onClick={() => setStatus('confirming')} disabled={status === 'applying'} className={buttonPrimary}>
                {status === 'applying' ? 'Applying…' : 'Apply…'}
              </button>
              {request && (
                <button type="button" onClick={() => { setNote(''); setStatus('declining') }} disabled={status === 'applying'} className={buttonSecondary}>
                  Decline…
                </button>
              )}
              {!request && <span>or make it yourself on {tabLinks}.</span>}
            </div>
          )
        ) : canApplyPlanChanges ? (
          <p>Applying from chat covers staffing, operations and grade plan changes. To make this change, use {tabLinks}.</p>
        ) : canEdit && appliable && (status === 'composing' || status === 'sending') ? (
          <div role="group" aria-label="Send to your Owner" className="space-y-2">
            <label className="block font-semibold text-slate-800" htmlFor={`${headingId}-note`}>Add a note for your Owner (optional)</label>
            <textarea
              id={`${headingId}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <div className="flex flex-wrap gap-2">
              <button ref={confirmRef} type="button" onClick={send} disabled={status === 'sending'} className={buttonPrimary}>
                {status === 'sending' ? 'Sending…' : 'Send to Owner'}
              </button>
              <button type="button" onClick={() => setStatus('proposed')} disabled={status === 'sending'} className={buttonSecondary}>Cancel</button>
            </div>
          </div>
        ) : canEdit && appliable ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" onClick={() => setStatus('composing')} className={buttonPrimary}>Send to Owner…</button>
            <span>Your school&rsquo;s Owner applies changes from chat. Or make it yourself on {tabLinks}.</span>
          </div>
        ) : (
          <p>Applying or sending from chat covers staffing, operations and grade plan changes. To make this change, use {tabLinks}.</p>
        )}
      </footer>
    </article>
  )
}
