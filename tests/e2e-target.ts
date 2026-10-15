/**
 * T-INFRA-01: which database and app an e2e run writes to.
 *
 * The session4 e2e specs and the overnight harness sign up accounts, edit Spokane Arts and
 * test-columbia, and spend AI credits. They should run against a local Supabase stack (see
 * tests/README-e2e-local.md). Against production they refuse to start unless the run opts in
 * with E2E_ALLOW_PRODUCTION=1.
 */

export const PRODUCTION_PROJECT_REF = 'nlvlrznhiwuorxlapnej'
export const PRODUCTION_APP_HOST = 'schoollaunch.vercel.app'

export interface E2eTarget {
  supabaseUrl: string
  baseUrl: string
  /** True when either the database or the app under test is production. */
  production: boolean
}

export function e2eTarget(env: NodeJS.ProcessEnv = process.env): E2eTarget {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const baseUrl = env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
  let appHost = ''
  try { appHost = new URL(baseUrl).host } catch { /* leave empty */ }
  const production = supabaseUrl.includes(PRODUCTION_PROJECT_REF) || appHost === PRODUCTION_APP_HOST
  return { supabaseUrl, baseUrl, production }
}

/** Throw unless the run targets a non-production stack or explicitly allows production. */
export function assertE2eTargetAllowed(env: NodeJS.ProcessEnv = process.env): E2eTarget {
  const target = e2eTarget(env)
  if (target.production && env.E2E_ALLOW_PRODUCTION !== '1') {
    throw new Error(
      `E2E target is production (database ${target.supabaseUrl || 'unset'}, app ${target.baseUrl}). ` +
      'These specs write data and spend AI credits. Run them against the local stack ' +
      '(tests/README-e2e-local.md), or set E2E_ALLOW_PRODUCTION=1 to run against production on purpose.',
    )
  }
  return target
}
