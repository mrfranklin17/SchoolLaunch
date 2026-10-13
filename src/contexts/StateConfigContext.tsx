'use client'

import { useSchoolSession } from '@/contexts/SchoolSessionContext'
import type { StateConfig, Pathway } from '@/lib/stateConfig'

interface StateConfigContextValue {
  config: StateConfig
  pathway: Pathway
  loading: boolean
}

/**
 * The current school's pathway config. Since Phase 3 this reads SchoolSessionProvider, so the
 * pathway always belongs to the same school useSchoolData loads (it used to come from an
 * unordered first user_roles row, which could be a different school for multi-school users).
 */
export function useStateConfig(): StateConfigContextValue {
  const { config, pathway, loading } = useSchoolSession()
  return { config, pathway, loading }
}
