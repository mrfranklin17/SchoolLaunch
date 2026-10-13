import type { Pathway } from './stateConfig'

/**
 * Pure rules behind SchoolSessionProvider (Phase 3): which school is current and which role
 * the user holds there. Every hook that used to resolve this on its own (useSchoolData,
 * usePermissions, StateConfigContext, Sidebar, useTour) now reads one answer, so the data a
 * page shows, the permissions it applies and the pathway it uses always describe the same
 * school.
 */

export type SchoolRole = 'school_ceo' | 'school_editor' | 'school_viewer' | 'org_admin' | 'super_admin'

export const SCHOOL_ROLES: readonly SchoolRole[] = ['school_ceo', 'school_editor', 'school_viewer']
export const ORG_ROLES: readonly SchoolRole[] = ['org_admin', 'super_admin']

/** One user_roles row, as the session loads it. */
export interface SessionRoleRow {
  role: SchoolRole
  school_id: string | null
  organization_id: string | null
  created_at: string
  tour_completed?: boolean | null
  completed_tours?: string[] | null
}

/** A school the user is a member of (a school-level role). */
export interface SessionSchool {
  id: string
  name: string
  pathway: Pathway
  role: SchoolRole
}

export interface ResolvedSession {
  /** The current school: the stored selection when the user is a member, else their CEO school, else the newest membership. */
  school: SessionSchool | null
  /** The role at the current school; for users with no school membership, their newest org-level role. */
  role: SchoolRole | null
  /** True when a stored selection no longer matches a membership and should be cleared. */
  clearSelection: boolean
}

/** Newest first, the order every rule below relies on. */
export function sortRolesNewestFirst<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
}

/**
 * @param roles every user_roles row for the user (any order)
 * @param schools name and pathway for each school the user is a member of
 * @param selectedId the school chosen in the switcher (sessionStorage), if any
 */
export function resolveSchoolSession(
  roles: SessionRoleRow[],
  schools: { id: string; name: string; pathway: Pathway | null }[],
  selectedId: string | null,
): ResolvedSession & { memberships: SessionSchool[] } {
  const sorted = sortRolesNewestFirst(roles)
  const memberships: SessionSchool[] = []
  for (const r of sorted) {
    if (!SCHOOL_ROLES.includes(r.role) || !r.school_id) continue
    if (memberships.some((m) => m.id === r.school_id)) continue
    const s = schools.find((x) => x.id === r.school_id)
    memberships.push({ id: r.school_id, name: s?.name ?? '', pathway: s?.pathway ?? 'wa_charter', role: r.role })
  }

  const selected = selectedId ? memberships.find((m) => m.id === selectedId) ?? null : null
  const school = selected ?? memberships.find((m) => m.role === 'school_ceo') ?? memberships[0] ?? null
  const orgRole = orgRoleRow(sorted)?.role ?? null

  return {
    memberships,
    school,
    role: school ? school.role : orgRole,
    clearSelection: !!selectedId && !selected,
  }
}

/** The user's newest org-level role row (org_admin / super_admin), or null. Drives the admin portfolio. */
export function orgRoleRow<T extends SessionRoleRow>(roles: T[]): T | null {
  return sortRolesNewestFirst(roles).find((r) => ORG_ROLES.includes(r.role)) ?? null
}

export interface Permissions {
  role: SchoolRole | null
  canEdit: boolean
  canManageTeam: boolean
  canResetSchool: boolean
  canEditIdentity: boolean
  canExport: boolean
  canUseAI: boolean
  isLoading: boolean
}

const EDIT_ROLES: SchoolRole[] = ['school_ceo', 'school_editor']
const CEO_ONLY: SchoolRole[] = ['school_ceo']

/** What the role at the current school may do. Viewers are read-only (RLS enforces the same). */
export function permissionsFor(role: SchoolRole | null, isLoading: boolean): Permissions {
  return {
    role,
    canEdit: role !== null && EDIT_ROLES.includes(role),
    canManageTeam: role !== null && CEO_ONLY.includes(role),
    canResetSchool: role !== null && CEO_ONLY.includes(role),
    canEditIdentity: role !== null && CEO_ONLY.includes(role),
    canExport: role !== null,
    canUseAI: role !== null,
    isLoading,
  }
}
