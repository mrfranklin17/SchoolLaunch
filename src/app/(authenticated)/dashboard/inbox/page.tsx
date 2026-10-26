'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useScenario } from '@/lib/ScenarioContext'
import { useSchoolSession } from '@/contexts/SchoolSessionContext'
import { useChangeRequests } from '@/contexts/ChangeRequestsContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { ChangePreviewCard } from '@/components/chat/ChangePreviewCard'
import { parsePlanChange, type PlanChange } from '@/lib/chatEdits'
import type { ChangeRequestRow, RequestStatus } from '@/lib/changeRequestStore'

const STATUS_LABEL: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: 'Waiting', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  applied: { label: 'Applied', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  declined: { label: 'Declined', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  withdrawn: { label: 'Withdrawn', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  undone: { label: 'Applied, then undone', className: 'bg-slate-100 text-slate-700 border-slate-200' },
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function changesOf(row: ChangeRequestRow): PlanChange[] | null {
  const parsed = (Array.isArray(row.changes) ? row.changes : []).map(parsePlanChange)
  return parsed.length > 0 && parsed.every((c) => c !== null) ? (parsed as PlanChange[]) : null
}

/**
 * Phase 6c: plan changes Editors sent from Ask SchoolLaunch. The Owner reviews each waiting
 * request on its preview card (Apply / Decline) and opening the page marks them read; an
 * Editor sees their own requests and can withdraw one still waiting.
 */
export default function InboxPage() {
  const { schoolData } = useScenario()
  const { role, userId, pathway } = useSchoolSession()
  const { refresh: refreshCounts } = useChangeRequests()
  const [supabase] = useState(() => createClient())
  const [rows, setRows] = useState<ChangeRequestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Requests resolved on this visit keep their card (and its Undo) until the page is left.
  const [resolvedHere, setResolvedHere] = useState<Set<string>>(() => new Set())
  const { schoolId, schoolName } = schoolData
  useDocumentTitle('Inbox', schoolName)

  const isOwner = role === 'school_ceo'
  const allowed = (isOwner || role === 'school_editor') && pathway === 'wa_charter'

  const load = useCallback(async () => {
    if (!schoolId || !allowed) return
    let query = supabase.from('change_requests').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(50)
    if (!isOwner && userId) query = query.eq('requested_by', userId)
    const { data, error: readError } = await query
    if (readError) {
      setError('Could not load the Inbox. Refresh to try again.')
      return
    }
    setError(null)
    setRows((data ?? []) as ChangeRequestRow[])
  }, [supabase, schoolId, allowed, isOwner, userId])

  useEffect(() => {
    if (!schoolId || !allowed) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async read; state is set after it resolves
    load().then(async () => {
      if (!isOwner) return
      // Opening the Inbox marks waiting requests read: the badge and the notice clear.
      await fetch('/api/change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, action: 'mark_read' }),
      }).catch(() => {})
      await refreshCounts()
    })
  }, [schoolId, allowed, isOwner, load, refreshCounts])

  if (!allowed) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Inbox" />
        <p className="text-sm text-slate-600">The Inbox holds plan changes your school&rsquo;s Editors send to the Owner from Ask SchoolLaunch.</p>
      </div>
    )
  }

  const waiting = (rows ?? []).filter((r) => r.status === 'pending' || resolvedHere.has(r.id))
  const earlier = (rows ?? []).filter((r) => r.status !== 'pending' && !resolvedHere.has(r.id))

  return (
    <div className="animate-fade-in max-w-4xl">
      <PageHeader
        title="Inbox"
        subtitle={isOwner ? 'Plan changes your team sent from Ask SchoolLaunch for you to review.' : 'Plan changes you sent to your Owner from Ask SchoolLaunch.'}
      />
      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
      {rows === null && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {rows !== null && (
        <>
          <section aria-labelledby="inbox-waiting" className="mb-8">
            <h2 id="inbox-waiting" className="text-base font-semibold text-slate-900 mb-3">
              {isOwner ? 'Waiting for your review' : 'Waiting for your Owner'}
              <span className="ml-2 text-sm font-normal text-slate-500">({waiting.filter((r) => r.status === 'pending').length})</span>
            </h2>
            {waiting.length === 0 ? (
              <p className="text-sm text-slate-600">
                {isOwner
                  ? 'Nothing waiting. When an Editor asks Ask SchoolLaunch for a change and sends it to you, it appears here.'
                  : <>Nothing waiting. Ask for a change in <Link href="/dashboard/ask" className="font-semibold text-teal-700 underline underline-offset-2">Ask SchoolLaunch</Link> and send it to your Owner from the preview card.</>}
              </p>
            ) : (
              <ul className="space-y-6">
                {waiting.map((r) => {
                  const changes = changesOf(r)
                  return (
                    <li key={r.id} className="space-y-2">
                      <p className="text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">{isOwner ? r.requester_name || 'A team member' : 'You'}</span>
                        <span className="text-slate-500"> · {when(r.created_at)}</span>
                      </p>
                      {r.note && (
                        <blockquote className="border-l-4 border-teal-200 bg-white px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap">{r.note}</blockquote>
                      )}
                      {changes ? (
                        <ChangePreviewCard
                          changes={changes}
                          request={{ id: r.id, mine: r.requested_by === userId && !isOwner }}
                          onResolved={() => { setResolvedHere((prev) => new Set(prev).add(r.id)); load() }}
                          fullWidth
                        />
                      ) : (
                        <p role="alert" className="text-sm text-red-700">This request can&rsquo;t be read.</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {earlier.length > 0 && (
            <section aria-labelledby="inbox-earlier">
              <h2 id="inbox-earlier" className="text-base font-semibold text-slate-900 mb-3">Earlier</h2>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {earlier.map((r) => {
                  const badge = STATUS_LABEL[r.status]
                  return (
                    <li key={r.id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                        <span className="text-slate-700">{isOwner ? r.requester_name || 'A team member' : 'You'}</span>
                        <span className="text-slate-500">· sent {when(r.created_at)}{r.resolved_at ? ` · ${badge.label.toLowerCase()} ${when(r.resolved_at)}` : ''}</span>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-slate-700">
                        {(Array.isArray(r.summary) ? r.summary : []).map((l) => (
                          <li key={l.label}>{l.label}: {l.before} → {l.after}</li>
                        ))}
                      </ul>
                      {r.note && <p className="mt-1 text-slate-600">Note: {r.note}</p>}
                      {r.status === 'declined' && r.decline_reason && <p className="mt-1 text-slate-600">Owner&rsquo;s reason: {r.decline_reason}</p>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
