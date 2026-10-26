'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useChangeRequests } from '@/contexts/ChangeRequestsContext'
import { useSchoolSession } from '@/contexts/SchoolSessionContext'

const DISMISS_KEY = 'sl_change_request_notice_dismissed'

/**
 * Phase 6c: tells the Owner, on whatever page they land after logging in, that team members
 * sent plan changes for review. Hidden on the Inbox itself; Dismiss hides it for this browser
 * session until a new request arrives.
 */
export default function ChangeRequestNotice() {
  const pathname = usePathname()
  const { role } = useSchoolSession()
  const { unread } = useChangeRequests()
  const [dismissedAt, setDismissedAt] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const v = window.sessionStorage.getItem(DISMISS_KEY)
      return v === null ? null : Number(v)
    } catch {
      return null
    }
  })

  // Dismissed at this unread count (or more): stay hidden until the count goes up.
  if (role !== 'school_ceo' || unread === 0 || pathname === '/dashboard/inbox' || (dismissedAt !== null && unread <= dismissedAt)) return null

  function dismiss() {
    setDismissedAt(unread)
    try { window.sessionStorage.setItem(DISMISS_KEY, String(unread)) } catch { /* storage unavailable: hide for this page only */ }
  }

  return (
    <div role="status" className="mb-4 bg-teal-50 border border-teal-200 rounded-xl pl-5 pr-5 md:pr-16 py-3 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
      <span className="text-sm text-teal-800">
        {unread === 1 ? 'A team member sent you a plan change to review.' : `Team members sent you ${unread} plan changes to review.`}
      </span>
      <div className="flex items-center gap-3">
        <Link href="/dashboard/inbox" className="text-sm font-semibold text-teal-700 hover:text-teal-900 underline underline-offset-2">
          Review in Inbox
        </Link>
        <button type="button" onClick={dismiss} className="text-sm text-slate-600 hover:text-slate-800">
          Dismiss
        </button>
      </div>
    </div>
  )
}
