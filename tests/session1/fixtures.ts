import { test as base, expect, type Page, type BrowserContext } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

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
  eswaOrgAdmin: {
    email: 'admin@excellentschoolswa.org',
    password: 'excellent',
    label: 'ESWA Org Admin',
  } as TestAccount,
}

/**
 * Log in via the UI. Leaves the page at /dashboard (or wherever login redirects).
 */
export async function loginAs(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login')
  // Inputs get generated ids (FormField's useId), and the page also has magic-link and
  // reset forms, so scope to the password form and find fields by their labels.
  const form = page.locator('form').filter({ has: page.locator('input[type="password"]') }).first()
  await form.getByLabel('Email').fill(account.email)
  await form.getByLabel('Password').fill(account.password)
  await Promise.all([
    page.waitForURL(/\/(dashboard|select-school|onboarding|portfolio)/, { timeout: 30_000 }),
    form.locator('button[type="submit"]').first().click(),
  ])
  // If landed at select-school, pick the first school
  if (page.url().includes('/select-school')) {
    const firstSchool = page.locator('button, a').filter({ hasText: /./ }).first()
    await firstSchool.click().catch(() => { /* ignore */ })
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => { /* ignore */ })
  }
}

/**
 * Get the current school's id from sessionStorage or from the page context.
 * Returns null if not available.
 */
export async function getCurrentSchoolId(page: Page): Promise<string | null> {
  const id = await page.evaluate(() => {
    const fromSession = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('sl_selected_school')
      : null
    if (fromSession) return fromSession
    return null
  })
  if (id) return id
  return null
}

/**
 * Parse a currency-formatted string like "$1,234,567" or "$ 1,234" to a number.
 */
export function parseCurrency(s: string | null | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[^0-9.\-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Capture the session cookies from a browser context as a string usable in Cookie headers.
 */
export async function captureCookieHeader(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies()
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

/**
 * Download a blob from the server via the page's authenticated context.
 * Returns the file path of the saved artifact.
 */
export async function downloadCommissionExcel(page: Page, _schoolId: string, destPath: string): Promise<string> {
  // The dashboard Overview button is labelled "Export Excel" (WA charter) or "Export Plan"
  // (generic). We rely on the actual UI trigger to avoid re-implementing the payload
  // assembly (fetches scenarios, builds multi-year, etc).
  await page.goto('/dashboard')
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  const exportButton = page
    .getByRole('button', { name: /export excel|export plan/i })
    .first()
  await exportButton.click()
  const download = await downloadPromise
  await download.saveAs(destPath)
  return destPath
}

export interface ParsedCashFlow {
  months: string[] // 12 month labels in order
  rows: { label: string; values: number[] }[]
}

/**
 * Read the CASH FLOW tab from a downloaded Commission Excel file. Returns the month labels
 * and each row of monthly values.
 */
export function readCashFlowTab(xlsxPath: string): ParsedCashFlow {
  const wb = XLSX.readFile(xlsxPath)
  const sheet = wb.Sheets['CASH FLOW']
  if (!sheet) throw new Error('CASH FLOW tab not found in workbook')
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null })

  // Find the 'Month' header row — second row typically has months.
  let monthRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i][0]
    if (typeof first === 'string' && first.trim().toLowerCase() === 'month') {
      monthRowIdx = i
      break
    }
  }
  if (monthRowIdx < 0) throw new Error('Month row not found in CASH FLOW tab')
  const months = rows[monthRowIdx].slice(1, 13).map((m) => String(m ?? ''))

  const dataRows: { label: string; values: number[] }[] = []
  for (let i = monthRowIdx + 1; i < rows.length; i++) {
    const label = rows[i][0]
    if (label == null || label === '') continue
    if (typeof label !== 'string') continue
    const values = rows[i].slice(1, 13).map((v) => (typeof v === 'number' ? v : 0))
    // Only keep rows with 12 columns of numbers (monthly rows)
    const numericCount = values.filter((v) => typeof v === 'number').length
    if (numericCount >= 10) {
      dataRows.push({ label, values })
    }
    // Stop at the annual summary section
    if (typeof label === 'string' && /annual/i.test(label)) break
  }
  return { months, rows: dataRows }
}

/**
 * Read the P&L tab and return a row's Year N cell value by label.
 */
export function readPLRowYear(xlsxPath: string, label: string, yearIndex: number): number | null {
  const wb = XLSX.readFile(xlsxPath)
  const sheet = wb.Sheets['P&L']
  if (!sheet) throw new Error('P&L tab not found')
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null })
  for (const r of rows) {
    if (typeof r[0] === 'string' && r[0].trim() === label) {
      // Year 0 is column 1, Year 1 is column 2, etc. yearIndex=1 means Year 1 → column 2.
      const v = r[yearIndex + 1]
      return typeof v === 'number' ? v : null
    }
  }
  return null
}

/**
 * Create a Supabase service-role client for test fixtures that need to bypass RLS
 * (e.g., looking up a school's id by name, or verifying role assignments).
 */
export function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not set — load .env.local')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function loadEnvLocal(): Promise<void> {
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

export const test = base.extend<{ loadedEnv: void }>({
  loadedEnv: [async ({}, use) => {
    await loadEnvLocal()
    await use()
  }, { auto: true }],
})

export { expect }
