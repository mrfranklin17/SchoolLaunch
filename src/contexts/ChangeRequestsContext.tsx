'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useSchoolSession } from '@/contexts/SchoolSessionContext'

/**
 * Phase 6c: counts behind the Inbox badge and the Owner's notice. The Owner's unread count is
 * pending requests not yet seen in the Inbox; an Editor sees how many of their own requests are
 * still pending. Re-read on every navigation and whenever a page calls refresh().
 */
export interface ChangeRequestCounts {
  /** Owner: pending requests not yet opened in the Inbox. */
  unread: number
  /** Owner: all pending requests. Editor: their own pending requests. */
  pending: number
  refresh: () => Promise<void>
}

const EMPTY: ChangeRequestCounts = { unread: 0, pending: 0, refresh: async () => {} }
const ChangeRequestsContext = createContext<ChangeRequestCounts>(EMPTY)

export function useChangeRequests(): ChangeRequestCounts {
  return useContext(ChangeRequestsContext)
}

export function ChangeRequestsProvider({ children }: { children: ReactNode }) {
  const { school, role, userId, pathway, loading } = useSchoolSession()
  const pathname = usePathname()
  const [supabase] = useState(() => createClient())
  const [counts, setCounts] = useState({ unread: 0, pending: 0 })
  const schoolId = school?.id ?? null
  const tracked = !loading && !!schoolId && pathway === 'wa_charter' && (role === 'school_ceo' || role === 'school_editor')

  const refresh = useCallback(async () => {
    if (!tracked || !schoolId) {
      setCounts({ unread: 0, pending: 0 })
      return
    }
    let query = supabase.from('change_requests').select('owner_read_at').eq('school_id', schoolId).eq('status', 'pending')
    if (role === 'school_editor' && userId) query = query.eq('requested_by', userId)
    const { data, error } = await query
    // The table is new: a failed read shows no badge rather than an error on every page.
    if (error || !data) return
    setCounts({
      pending: data.length,
      unread: role === 'school_ceo' ? data.filter((r) => !r.owner_read_at).length : 0,
    })
  }, [supabase, tracked, schoolId, role, userId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async read; state is set after it resolves
    refresh()
  }, [refresh, pathname])

  return (
    <ChangeRequestsContext.Provider value={{ ...counts, refresh }}>
      {children}
    </ChangeRequestsContext.Provider>
  )
}
