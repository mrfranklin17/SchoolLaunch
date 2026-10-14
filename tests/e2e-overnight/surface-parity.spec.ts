import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { service, SID } from './_guard'
import { computeMultiYearDetailed, computeFPFScorecard, computeCarryForward } from '../../src/lib/budgetEngine'
import { DEFAULT_ASSUMPTIONS, type BudgetProjection, type GradeExpansionEntry, type SchoolProfile, type StaffingPosition } from '../../src/lib/types'

// Half (B): render parity + robustness smoke for test-columbia's CURRENT (lease-baseline)
// state. Soft assertions throughout (collect everything, never fail-fast). AI routes are
// stubbed so the run incurs zero LLM cost. globalTeardown restores test-columbia regardless.

const SHOTS = 'tests/e2e-overnight/_artifacts/screenshots'
mkdirSync(SHOTS, { recursive: true })

const SURFACES = [
  { name: 'overview', route: '/dashboard' },
  { name: 'revenue', route: '/dashboard/revenue' },
  { name: 'staffing', route: '/dashboard/staffing' },
  { name: 'operations', route: '/dashboard/operations' },
  { name: 'cashflow', route: '/dashboard/cashflow' },
  { name: 'multiyear', route: '/dashboard/multiyear' },
  { name: 'scorecard', route: '/dashboard/scorecard' },
  { name: 'scenarios', route: '/dashboard/scenarios' },
]

let expected: { revenueY1: number; dcohY1: number; reserveDaysY1: number }
const surfaceResults: Record<string, unknown>[] = []

test.beforeAll(async () => {
  const sb = service()
  const profile = (await sb.from('school_profiles').select('*').eq('school_id', SID).single()).data as SchoolProfile
  const positions = ((await sb.from('staffing_positions').select('*').eq('school_id', SID)).data || []) as StaffingPosition[]
  const projections = ((await sb.from('budget_projections').select('*').eq('school_id', SID)).data || []) as BudgetProjection[]
  const gep = ((await sb.from('grade_expansion_plan').select('*').eq('school_id', SID)).data || []) as GradeExpansionEntry[]
  const assumptions = { ...DEFAULT_ASSUMPTIONS, ...(profile.financial_assumptions || {}) }
  const preOpen = computeCarryForward(profile)
  const my = computeMultiYearDetailed(profile, positions.filter((p) => p.year === 1), projections, assumptions, preOpen, gep, positions, profile.startup_funding)
  const fpf = computeFPFScorecard(my, preOpen, false)
  expected = {
    revenueY1: my[0].revenue.total,
    dcohY1: (fpf.measures.find(m => m.name === 'Days of Cash')!.values[0] as number) ?? 0,
    reserveDaysY1: my[0].reserveDays,
  }
})

// Stub the app's own AI routes -> deterministic, zero-cost, no flakiness.
async function stubAI(page: Page) {
  await page.route('**/api/advisory**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ briefing: 'STUB', agents: [] }) }))
  await page.route('**/api/chat**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'STUB' }) }))
  await page.route('**/api/alignment**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ findings: [] }) }))
}

for (const surface of SURFACES) {
  test(`surface: ${surface.name}`, async ({ page }) => {
    const consoleErrors: string[] = []
    const netErrors: string[] = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
    page.on('response', r => { if (r.status() >= 400) netErrors.push(`${r.status()} ${r.url().slice(0, 120)}`) })
    await stubAI(page)

    const t0 = Date.now()
    await page.goto(surface.route, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    const nav = await page.evaluate(() => {
      const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime
      return { dcl: e?.domContentLoadedEventEnd ?? null, load: e?.loadEventEnd ?? null, fcp: fcp ?? null }
    })
    const wall = Date.now() - t0
    await page.screenshot({ path: `${SHOTS}/${surface.name}.png`, fullPage: true }).catch(() => {})

    // Soft parity: the engine's headline numbers should appear on data surfaces.
    const body = (await page.locator('body').innerText().catch(() => '')) || ''
    const parity: Record<string, unknown>[] = []
    if (['revenue', 'overview', 'multiyear'].includes(surface.name)) {
      const fmt = expected.revenueY1.toLocaleString('en-US')
      const present = body.includes(fmt) || body.includes('$' + fmt)
      parity.push({ metric: 'Y1 Total Revenue', expected: expected.revenueY1, present })
      expect.soft(present, `Y1 revenue ${fmt} present on ${surface.name}`).toBeTruthy()
    }
    if (['scorecard', 'overview', 'multiyear'].includes(surface.name)) {
      const present = new RegExp(`\\b${expected.dcohY1}\\b`).test(body) || new RegExp(`\\b${expected.reserveDaysY1}\\b`).test(body)
      parity.push({ metric: 'DCOH/reserveDays Y1', expected: `${expected.dcohY1}/${expected.reserveDaysY1}`, present })
      expect.soft(present, `DCOH ${expected.dcohY1} or reserveDays ${expected.reserveDaysY1} present on ${surface.name}`).toBeTruthy()
    }

    surfaceResults.push({ surface: surface.name, route: surface.route, wallMs: wall, nav, consoleErrors, netErrors, parity })
    writeFileSync('tests/e2e-overnight/_surface-results.json', JSON.stringify(surfaceResults, null, 2))

    // Robustness: surface must not throw a Next error boundary.
    expect.soft(body, `${surface.name} rendered (no fatal error boundary)`).not.toContain('Application error')
    expect.soft(consoleErrors.join('|'), `${surface.name} console errors`).not.toContain('Maximum update depth')
  })
}
