'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getStateConfig, type Pathway, type StateConfig } from '@/lib/stateConfig'
import {
  resolveSchoolSession,
  sortRolesNewestFirst,
  SCHOOL_ROLES,
  type SchoolRole,
  type SessionRoleRow,
  type SessionSchool,
} from '@/lib/schoolSession'

/** sessionStorage key for the school picked in the switcher (also written by login/invite flows). */
export const SELECTED_SCHOOL_KEY = 'sl_selected_school'

/**
 * Who is signed in, which school is current and what they may do there — resolved once per
 * app load (Phase 3). useSchoolData, usePermissions, useStateConfig, the Sidebar and the tour
 * all read this instead of each running their own auth + user_roles lookup with slightly
 * different rules for picking the school.
 */
export interface SchoolSession {
  loading: boolean
  userId: string | null
  email: string | null
  /** Every user_roles row, newest first. */
  roles: SessionRoleRow[]
  /** Schools the user is a member of (school-level roles), newest first. */
  memberships: SessionSchool[]
  /** The current school (see resolveSchoolSession). */
  school: SessionSchool | null
  /** The role at the current school, or the newest org-level role for org-only users. */
  role: SchoolRole | null
  /** The current school's pathway; wa_charter when there is no school. */
  pathway: Pathway
  config: StateConfig
  /** Re-run the lookup (e.g. after accepting an invitation or changing roles). */
  refresh: () => Promise<void>
}

const SchoolSessionContext = createContext<SchoolSession | null>(null)

export function useSchoolSession(): SchoolSession {
  const ctx = useContext(SchoolSessionContext)
  if (!ctx) throw new Error('useSchoolSession must be used within SchoolSessionProvider')
  return ctx
}

interface Resolved {
  userId: string | null
  email: string | null
  roles: SessionRoleRow[]
  memberships: SessionSchool[]
  school: SessionSchool | null
  role: SchoolRole | null
}

const EMPTY: Resolved = { userId: null, email: null, roles: [], memberships: [], school: null, role: null }

export function SchoolSessionProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [resolved, setResolved] = useState<Resolved>(EMPTY)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setResolved(EMPTY); return }

      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role, school_id, organization_id, created_at, tour_completed, completed_tours')
        .eq('user_id', user.id)
      const roles = sortRolesNewestFirst((roleRows ?? []) as SessionRoleRow[])

      const schoolIds = [...new Set(roles
        .filter((r) => SCHOOL_ROLES.includes(r.role) && r.school_id)
        .map((r) => r.school_id as string))]
      const { data: schools } = schoolIds.length > 0
        ? await supabase.from('schools').select('id, name, pathway').in('id', schoolIds)
        : { data: [] }

      const selectedId = typeof window !== 'undefined' ? sessionStorage.getItem(SELECTED_SCHOOL_KEY) : null
      const r = resolveSchoolSession(roles, (schools ?? []) as { id: string; name: string; pathway: Pathway | null }[], selectedId)
      if (r.clearSelection) sessionStorage.removeItem(SELECTED_SCHOOL_KEY)

      setResolved({ userId: user.id, email: user.email ?? null, roles, memberships: r.memberships, school: r.school, role: r.role })
    } catch (err) {
      console.error('Session lookup failed:', err)
      setResolved(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => { load() }, [load])

  const value = useMemo<SchoolSession>(() => {
    const pathway: Pathway = resolved.school?.pathway ?? 'wa_charter'
    return { ...resolved, loading, pathway, config: getStateConfig(pathway), refresh: load }
  }, [resolved, loading, load])

  return <SchoolSessionContext.Provider value={value}>{children}</SchoolSessionContext.Provider>
}
