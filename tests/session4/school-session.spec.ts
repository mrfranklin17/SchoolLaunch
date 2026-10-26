import { test, expect } from '@playwright/test'
import {
  resolveSchoolSession,
  permissionsFor,
  orgRoleRow,
  sortRolesNewestFirst,
  type SessionRoleRow,
} from '../../src/lib/schoolSession'

/**
 * Phase 3 — SchoolSessionProvider resolves the user's current school and role once, and
 * useSchoolData, usePermissions, useStateConfig, the Sidebar, the tour and the admin portfolio
 * all read that answer. These are the rules it applies, pinned against the role shapes that
 * exist in production (single CEO, multi-school members, org admins who also hold a school
 * role, a stale switcher selection).
 *
 * Run: npx playwright test tests/session4/school-session.spec.ts
 */

const SCHOOLS = [
  { id: 'wa', name: 'Spokane Arts Academy', pathway: 'wa_charter' as const },
  { id: 'gen', name: 'Columbia Valley Prep', pathway: 'generic_private' as const },
  { id: 'old', name: 'Legacy School', pathway: null },
]

function row(role: SessionRoleRow['role'], school_id: string | null, created_at: string, organization_id: string | null = null): SessionRoleRow {
  return { role, school_id, organization_id, created_at }
}

test.describe('resolveSchoolSession', () => {
  test('single CEO: their school, CEO role, nothing to clear', () => {
    const r = resolveSchoolSession([row('school_ceo', 'wa', '2026-01-01')], SCHOOLS, null)
    expect(r.school).toEqual({ id: 'wa', name: 'Spokane Arts Academy', pathway: 'wa_charter', role: 'school_ceo' })
    expect(r.role).toBe('school_ceo')
    expect(r.clearSelection).toBe(false)
  })

  test('a valid switcher selection wins, with the role held at that school', () => {
    const roles = [row('school_ceo', 'wa', '2026-01-01'), row('school_viewer', 'gen', '2026-03-01')]
    const r = resolveSchoolSession(roles, SCHOOLS, 'gen')
    expect(r.school?.id).toBe('gen')
    expect(r.role).toBe('school_viewer')
    expect(r.school?.pathway).toBe('generic_private')
  })

  test('a selection the user is no longer a member of falls back and is cleared', () => {
    const roles = [row('school_editor', 'gen', '2026-03-01'), row('school_ceo', 'wa', '2026-01-01')]
    const r = resolveSchoolSession(roles, SCHOOLS, 'removed-school')
    expect(r.school?.id).toBe('wa') // the CEO school
    expect(r.role).toBe('school_ceo')
    expect(r.clearSelection).toBe(true)
  })

  test('without a selection, the CEO school beats a newer membership', () => {
    const roles = [row('school_viewer', 'gen', '2026-05-01'), row('school_ceo', 'wa', '2026-01-01')]
    expect(resolveSchoolSession(roles, SCHOOLS, null).school?.id).toBe('wa')
  })

  test('no CEO school: the newest membership, whatever order the rows arrive in', () => {
    const roles = [row('school_viewer', 'wa', '2026-01-01'), row('school_editor', 'gen', '2026-04-01')]
    const r = resolveSchoolSession(roles, SCHOOLS, null)
    expect(r.school?.id).toBe('gen')
    expect(r.role).toBe('school_editor')
    expect(r.memberships.map((m) => m.id)).toEqual(['gen', 'wa'])
  })

  test('org-only user: no school, the org-level role', () => {
    const r = resolveSchoolSession([row('org_admin', null, '2026-02-01', 'org1')], SCHOOLS, null)
    expect(r.school).toBeNull()
    expect(r.role).toBe('org_admin')
    expect(r.memberships).toEqual([])
  })

  test('org admin who is also an editor: the school role governs the dashboard', () => {
    const roles = [row('org_admin', null, '2026-01-01', 'org1'), row('school_editor', 'wa', '2026-06-01')]
    const r = resolveSchoolSession(roles, SCHOOLS, null)
    expect(r.school?.id).toBe('wa')
    expect(r.role).toBe('school_editor')
  })

  test('the pathway follows the current school; a missing pathway defaults to wa_charter', () => {
    const roles = [row('school_editor', 'gen', '2026-01-01'), row('school_viewer', 'old', '2026-02-01')]
    expect(resolveSchoolSession(roles, SCHOOLS, 'gen').school?.pathway).toBe('generic_private')
    expect(resolveSchoolSession(roles, SCHOOLS, 'old').school?.pathway).toBe('wa_charter')
  })

  test('duplicate rows for one school keep the newest role', () => {
    const roles = [row('school_viewer', 'wa', '2026-01-01'), row('school_editor', 'wa', '2026-02-01')]
    const r = resolveSchoolSession(roles, SCHOOLS, null)
    expect(r.memberships).toHaveLength(1)
    expect(r.role).toBe('school_editor')
  })

  test('no roles at all', () => {
    const r = resolveSchoolSession([], SCHOOLS, 'wa')
    expect(r.school).toBeNull()
    expect(r.role).toBeNull()
    expect(r.clearSelection).toBe(true)
  })
})

test.describe('orgRoleRow (admin portfolio)', () => {
  test('newest org-level row, ignoring school roles', () => {
    const roles = [
      row('school_ceo', 'wa', '2026-09-01'),
      row('org_admin', null, '2026-01-01', 'org-old'),
      row('super_admin', null, '2026-03-01', 'org-new'),
    ]
    expect(orgRoleRow(roles)?.organization_id).toBe('org-new')
    expect(orgRoleRow([row('school_ceo', 'wa', '2026-01-01')])).toBeNull()
  })
})

test('sortRolesNewestFirst does not mutate its input', () => {
  const roles = [row('school_ceo', 'a', '2026-01-01'), row('school_ceo', 'b', '2026-02-01')]
  expect(sortRolesNewestFirst(roles).map((r) => r.school_id)).toEqual(['b', 'a'])
  expect(roles.map((r) => r.school_id)).toEqual(['a', 'b'])
})

test.describe('permissionsFor', () => {
  test('CEO: everything', () => {
    expect(permissionsFor('school_ceo', false)).toEqual({
      role: 'school_ceo', canEdit: true, canManageTeam: true, canResetSchool: true,
      canEditIdentity: true, canExport: true, canUseAI: true, canApplyPlanChanges: true, isLoading: false,
    })
  })
  test('editor: edits, but no team, reset or identity', () => {
    const p = permissionsFor('school_editor', false)
    expect([p.canEdit, p.canManageTeam, p.canResetSchool, p.canEditIdentity, p.canExport, p.canUseAI, p.canApplyPlanChanges])
      .toEqual([true, false, false, false, true, true, false])
  })
  test('viewer: read-only, can still export and ask', () => {
    const p = permissionsFor('school_viewer', false)
    expect([p.canEdit, p.canManageTeam, p.canExport, p.canUseAI]).toEqual([false, false, true, true])
  })
  test('org admin on the dashboard is read-only', () => {
    expect(permissionsFor('org_admin', false).canEdit).toBe(false)
  })
  test('no role (loading or signed out): nothing', () => {
    const p = permissionsFor(null, true)
    expect([p.canEdit, p.canExport, p.canUseAI, p.isLoading]).toEqual([false, false, false, true])
  })
})
