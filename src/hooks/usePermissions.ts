'use client'

import { useSchoolSession } from '@/contexts/SchoolSessionContext'
import { permissionsFor, type Permissions, type SchoolRole } from '@/lib/schoolSession'

export type { Permissions, SchoolRole }

/** What the user may do at the current school (resolved once by SchoolSessionProvider). */
export function usePermissions(): Permissions {
  const { role, loading } = useSchoolSession()
  return permissionsFor(role, loading)
}
