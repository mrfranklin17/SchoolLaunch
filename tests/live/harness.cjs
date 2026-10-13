// Read-only live-test harness for production (https://schoollaunch.vercel.app) — see README.md.
// Every Supabase REST/storage write and every non-GET /api call is ABORTED unless the caller
// explicitly allows or stubs it, and recorded in log.blockedWrites. Never weaken this guard.
/* eslint-disable @typescript-eslint/no-require-imports -- a plain CommonJS script run with node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright')

const REPO = path.resolve(__dirname, '../..')
const BASE = process.env.LIVE_BASE_URL || 'https://schoollaunch.vercel.app'
// Cloud sessions ship Chromium here; elsewhere Playwright's own browser is used.
const CHROMIUM = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const SCHOOLS = {
  spokaneArts: '06ae181c-1b88-45ae-a4dc-95758c3e63fa',
  columbiaValley: '64b84ff8-2824-4ca4-9814-57fa39b23c26',
  rooted: '403976c6-e93e-4095-9741-38321870e7e4',
  newSchoolSample: '174429f5-da36-4d22-b17e-237a3f1011d8',
}
const ORG_ID = '00000000-0000-0000-0000-000000000001'

/** Credentials parsed from tests/session1/fixtures.ts at runtime. Never print them. */
function readAccounts() {
  const src = fs.readFileSync(path.join(REPO, 'tests/session1/fixtures.ts'), 'utf8')
  const out = {}
  const re = /(\w+):\s*\{\s*email:\s*'([^']+)',\s*password:\s*'([^']+)'/g
  let m
  while ((m = re.exec(src))) out[m[1]] = { email: m[2], password: m[3] }
  return out
}

/**
 * @param {object} opts
 * @param {string[]} [opts.allowApi]  /api path prefixes whose non-GET calls may pass through
 * @param {Record<string,(route:any)=>Promise<void>>} [opts.stubs]  /api path -> handler (fulfill/abort)
 */
async function newSession(opts = {}) {
  const allowApi = opts.allowApi || []
  const stubs = opts.stubs || {}
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {})
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
  const log = { blockedWrites: [], apiCalls: [], apiBodies: [], consoleErrors: [], pageErrors: [], failedResponses: [], scripts: new Set() }

  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()
    if (/\.supabase\.co\/(rest|storage)\/v1\//.test(url) && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      log.blockedWrites.push(`${method} ${url.replace(/\?.*/, '')}`)
      return route.abort('blockedbyclient')
    }
    const api = url.startsWith(BASE) ? new URL(url).pathname : null
    if (api && api.startsWith('/api/')) {
      log.apiCalls.push(`${method} ${api}`)
      if (method !== 'GET') log.apiBodies.push({ path: api, body: req.postData() })
      if (stubs[api]) return stubs[api](route)
      if (method !== 'GET' && !allowApi.some((p) => api.startsWith(p))) {
        log.blockedWrites.push(`BLOCKED-API ${method} ${api}`)
        return route.abort('blockedbyclient')
      }
    }
    return route.continue()
  })

  context.on('page', (page) => attach(page, log))
  const page = await context.newPage()
  attach(page, log)
  return { browser, context, page, log }
}

function attach(page, log) {
  page.on('console', (msg) => { if (msg.type() === 'error') log.consoleErrors.push(`${page.url()} :: ${msg.text().slice(0, 300)}`) })
  page.on('pageerror', (err) => log.pageErrors.push(`${page.url()} :: ${String(err && err.message || err).slice(0, 300)}`))
  page.on('response', (res) => {
    const u = res.url()
    if (res.status() >= 400) log.failedResponses.push(`${res.status()} ${res.request().method()} ${u.replace(/\?.*/, '').slice(0, 200)}`)
    if (/\/_next\/static\/chunks\/.*\.js/.test(u)) log.scripts.add(u)
  })
}

/** Log in through the real form. Resolves to the URL the app landed on. */
async function login(page, accountKey) {
  const acct = readAccounts()[accountKey]
  if (!acct) throw new Error(`no account ${accountKey}`)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto('/login', { waitUntil: 'networkidle' })
      const form = page.locator('form').filter({ has: page.locator('input[type=password]') }).first()
      await form.locator('input[type=email]').fill(acct.email)
      await form.locator('input[type=password]').fill(acct.password)
      await Promise.all([
        page.waitForURL(/\/(dashboard|select-school|onboarding|portfolio)/, { timeout: 45_000 }),
        form.locator('button[type=submit]').first().click(),
      ])
      await page.waitForLoadState('networkidle').catch(() => {})
      return page.url()
    } catch (e) {
      if (attempt === 1) throw e
    }
  }
}

/**
 * fetch() from inside the page (goes through the browser, its proxy, its cookies and the
 * route guard above). Use this for API checks; Playwright's context.request bypasses the
 * proxy here and fails DNS. Returns {status, body (first 500 chars)}.
 */
async function apiFetch(page, apiPath, { method = 'GET', body } = {}) {
  return page.evaluate(async ({ apiPath, method, body }) => {
    try {
      const res = await fetch(apiPath, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      })
      const text = await res.text()
      return { status: res.status, body: text.slice(0, 500) }
    } catch (e) {
      return { status: -1, body: String(e && e.message || e).slice(0, 200) }
    }
  }, { apiPath, method, body })
}

/**
 * The served JS chunk containing any of `needles`, or null. Use a string only the change under
 * test ships (an error message, a storage key) to prove production runs the merged build.
 */
async function servedBuildContains(page, log, needles) {
  const html = await page.content()
  const urls = new Set([...log.scripts, ...[...html.matchAll(/\/_next\/static\/[^"' ]+\.js/g)].map((m) => BASE + m[0])])
  for (const u of urls) {
    const hit = await page.evaluate(async ({ u, needles }) => {
      try { const t = await (await fetch(u)).text(); return needles.some((n) => t.includes(n)) } catch { return false }
    }, { u, needles })
    if (hit) return u
  }
  return null
}

/** One-line error text: Playwright call logs can include auth cookies, so never print them. */
function errLine(e) {
  return String((e && e.message) || e).split('\n')[0].slice(0, 300)
}

/** Wait for the dashboard to finish loading (skeletons gone) on the current page. */
async function settle(page, ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(ms)
}

/** Screenshot/output folder for one test area, outside the repo. */
function outDir(area) {
  const d = path.join(process.env.LIVE_OUT_DIR || path.join(os.tmpdir(), 'schoollaunch-live'), area)
  fs.mkdirSync(d, { recursive: true })
  return d
}

function summarize(log) {
  return {
    blockedWrites: log.blockedWrites,
    apiCalls: log.apiCalls,
    consoleErrors: [...new Set(log.consoleErrors)],
    pageErrors: [...new Set(log.pageErrors)],
    failedResponses: [...new Set(log.failedResponses)],
  }
}

const TABS = [
  '/dashboard', '/dashboard/revenue', '/dashboard/staffing', '/dashboard/operations',
  '/dashboard/cashflow', '/dashboard/multiyear', '/dashboard/scenarios',
  '/dashboard/ask', '/dashboard/advisory', '/dashboard/alignment', '/dashboard/scorecard',
  '/dashboard/settings',
]

module.exports = { BASE, SCHOOLS, ORG_ID, TABS, readAccounts, newSession, login, apiFetch, servedBuildContains, errLine, settle, outDir, summarize }
