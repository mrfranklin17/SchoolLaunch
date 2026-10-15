import { test as base, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { assertE2eTargetAllowed } from '../../e2e-target'

/**
 * Session 4 E2E fixtures.
 *
 * Shares login helpers + Supabase service-role access with session1 tests, but kept
 * separate so session1 imports don't leak in and break if fixtures.ts evolves.
 */

export interface TestAccount {
  email: string
  password: string
  label: string
}

export const ACCOUNTS = {
  spokaneArts: {
    email: 'travis@spokanearts.org',
    password: 'excellent',
    label: 'Spokane Arts Academy',
  } as TestAccount,
  columbiaValley: {
    email: 'test-columbia@schoollaunch.test',
    password: 'excellent',
    label: 'Columbia Valley Charter',
  } as TestAccount,
}

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) {
      const [, k, v] = m
      if (!process.env[k]) process.env[k] = v.replace(/^['"]|['"]$/g, '')
    }
  }
}

export async function loginAs(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login')
  // FormField generates ids via React useId(), so target by input type rather than id.
  await page.locator('input[type="email"]').fill(account.email)
  await page.locator('input[type="password"]').fill(account.password)
  await Promise.all([
    page.waitForURL(/\/(dashboard|select-school|onboarding|portfolio)/, { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ])
  if (page.url().includes('/select-school')) {
    const firstSchool = page.locator('button, a').filter({ hasText: /./ }).first()
    await firstSchool.click().catch(() => { /* ignore */ })
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => { /* ignore */ })
  }
}

export async function getCurrentSchoolId(page: Page): Promise<string | null> {
  const id = await page.evaluate(() => {
    const fromSession = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('sl_selected_school')
      : null
    return fromSession
  })
  return id ?? null
}

/**
 * Resolve school id for a given account via Supabase service role.
 * Falls back to inspecting the browser session if the direct resolution fails.
 */
export async function resolveSchoolIdForAccount(account: TestAccount): Promise<string> {
  const supabase = getSupabaseService()
  const like = account === ACCOUNTS.spokaneArts ? '%Spokane Arts%' : '%Columbia%'
  const { data, error } = await supabase
    .from('schools')
    .select('id, name')
    .ilike('name', like)
    .limit(1)
  if (error || !data || data.length === 0) {
    throw new Error(`Could not resolve school id for ${account.label}: ${error?.message ?? 'not found'}`)
  }
  return data[0].id as string
}

export function getSupabaseService(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase env vars not set — ensure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Tables a spec may grow on a shared account: rows it adds are removed on restore. */
const ADDED_ROW_TABLES = ['scenarios', 'alignment_security_events', 'alignment_reviews'] as const

/**
 * Snapshot a school's mutable rows and return a restore function. These specs edit a real
 * account (Spokane Arts), so call restore from test.afterEach: it runs even when the test
 * fails between an edit and its UI revert. Restore puts staffing_positions back exactly
 * (same ids and columns) and deletes rows added to ADDED_ROW_TABLES since the snapshot.
 */
export async function snapshotSchool(schoolId: string): Promise<() => Promise<void>> {
  const supabase = getSupabaseService()
  const { data: staffing, error } = await supabase.from('staffing_positions').select('*').eq('school_id', schoolId)
  if (error || !staffing) throw new Error(`snapshotSchool: could not read staffing_positions: ${error?.message}`)
  const existing = new Map<string, Set<string>>()
  for (const t of ADDED_ROW_TABLES) {
    const { data, error: e } = await supabase.from(t).select('id').eq('school_id', schoolId)
    if (e || !data) throw new Error(`snapshotSchool: could not read ${t}: ${e?.message}`)
    existing.set(t, new Set(data.map((r) => r.id as string)))
  }

  return async () => {
    const { error: delErr } = await supabase.from('staffing_positions').delete().eq('school_id', schoolId)
    if (delErr) throw new Error(`restore: staffing delete failed (rows unchanged): ${delErr.message}`)
    const { error: insErr } = await supabase.from('staffing_positions').insert(staffing)
    if (insErr) {
      const out = path.resolve(process.cwd(), `staffing-snapshot-${schoolId}.json`)
      fs.writeFileSync(out, JSON.stringify(staffing))
      throw new Error(`🚨 restore: staffing re-insert failed — rows saved to ${out}: ${insErr.message}`)
    }
    for (const t of ADDED_ROW_TABLES) {
      const { data } = await supabase.from(t).select('id').eq('school_id', schoolId)
      const added = (data ?? []).map((r) => r.id as string).filter((id) => !existing.get(t)!.has(id))
      if (added.length) {
        const { error: e } = await supabase.from(t).delete().in('id', added)
        if (e) throw new Error(`restore: could not remove ${added.length} added ${t} row(s): ${e.message}`)
      }
    }
  }
}

export async function assertDevServerUp(): Promise<void> {
  const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
  try {
    const res = await fetch(base + '/login', { method: 'GET' })
    if (!res.ok && res.status !== 200) {
      throw new Error(`Dev server at ${base} returned ${res.status}`)
    }
  } catch (err) {
    throw new Error(
      `Dev server not reachable at ${base}. Start it with \`npm run dev\` before running this suite. Underlying error: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export const test = base.extend<{ loadedEnv: void }>({
  loadedEnv: [async ({}, use) => {
    loadEnvLocal()
    // T-INFRA-01: refuse production unless E2E_ALLOW_PRODUCTION=1.
    assertE2eTargetAllowed()
    await assertDevServerUp()
    await use()
  }, { auto: true }],
})

export { expect }
