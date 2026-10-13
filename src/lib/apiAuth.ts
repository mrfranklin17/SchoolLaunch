import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export interface AuthResult {
  user: { id: string; email: string | null }
  supabase: SupabaseClient
  roles: { role: string; school_id: string | null; organization_id: string | null }[]
}

export interface AuthOptions {
  schoolId?: string
  requireRoles?: string[]
}

/**
 * Authenticates an API request and optionally verifies school access.
 *
 * Returns NextResponse on failure (401/403/400). Returns AuthResult on success.
 *
 * Usage:
 *   const auth = await authenticateRequest(request, { schoolId })
 *   if (auth instanceof NextResponse) return auth
 *   // auth.user, auth.supabase, auth.roles are available
 */
export async function authenticateRequest(
  request: NextRequest,
  options?: AuthOptions,
): Promise<AuthResult | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve schoolId: prefer explicit option, else look in body (best-effort).
  let schoolId = options?.schoolId
  if (!schoolId) {
    try {
      const cloned = request.clone()
      const body = await cloned.json().catch(() => null) as { schoolId?: string } | null
      if (body?.schoolId && typeof body.schoolId === 'string') {
        schoolId = body.schoolId
      }
    } catch {
      // Body may not be JSON or already consumed; caller should pass schoolId explicitly.
    }
  }

  if (!schoolId) {
    return NextResponse.json({ error: 'Missing schoolId' }, { status: 400 })
  }

  const { data: roles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role, school_id, organization_id')
    .eq('user_id', user.id)

  if (rolesError || !roles || roles.length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // super_admin has unrestricted access.
  const isSuperAdmin = roles.some((r) => r.role === 'super_admin')

  // Org membership for this school (for org_admin check).
  let schoolOrgId: string | null = null
  if (!isSuperAdmin) {
    const { data: schoolRow } = await supabase
      .from('schools')
      .select('organization_id')
      .eq('id', schoolId)
      .maybeSingle()
    schoolOrgId = schoolRow?.organization_id ?? null
  }

  const matchingRoles = isSuperAdmin
    ? roles
    : roles.filter((r) => {
        if (r.school_id === schoolId) return true
        if (r.role === 'org_admin' && schoolOrgId && r.organization_id === schoolOrgId) return true
        return false
      })

  if (matchingRoles.length === 0) {
    return NextResponse.json({ error: 'Forbidden: no access to this school' }, { status: 403 })
  }

  if (options?.requireRoles && options.requireRoles.length > 0) {
    const hasRequiredRole = isSuperAdmin || matchingRoles.some((r) => options.requireRoles!.includes(r.role))
    if (!hasRequiredRole) {
      return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 })
    }
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    supabase,
    roles: matchingRoles,
  }
}

/** Roles with org-level (portfolio) access: the admin check the Sidebar and login redirect use. */
export const ORG_LEVEL_ROLES = ['org_admin', 'super_admin']

/** True when any of the user's roles grants org-level (portfolio) access. */
export function hasOrgLevelRole(roles: { role: string }[] | null | undefined): boolean {
  return !!roles?.some((r) => ORG_LEVEL_ROLES.includes(r.role))
}

/**
 * Authenticates an org-level API request (portfolio endpoints), which no single schoolId scopes.
 *
 * Returns NextResponse 401 when signed out, 403 without an org_admin/super_admin role.
 * Returns AuthResult with the user's org-level roles on success. `client` is for tests only;
 * routes omit it and get the request's cookie-bound client.
 *
 * Usage:
 *   const auth = await authenticateOrgRequest()
 *   if (auth instanceof NextResponse) return auth
 */
export async function authenticateOrgRequest(client?: SupabaseClient): Promise<AuthResult | NextResponse> {
  const supabase = client ?? await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: roles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role, school_id, organization_id')
    .eq('user_id', user.id)

  if (rolesError || !hasOrgLevelRole(roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    supabase,
    roles: (roles ?? []).filter((r) => ORG_LEVEL_ROLES.includes(r.role)),
  }
}
