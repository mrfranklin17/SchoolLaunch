import { test, expect } from '@playwright/test'
import { EVAL_CASES, evalSchool } from '../evals/advisorFixtures'
import { CASE_CHECKS, scorePanel, unmatchedFigures, type Panel, type PanelAgent } from '../evals/advisorChecks'
import { AGENTS } from '../../src/app/api/advisory/route'
import { DEFAULT_ASSUMPTIONS } from '../../src/lib/types'

/**
 * AI-EXP-01 step 3, offline: the advisor eval's fixtures really contain their planted problem
 * (and the control none), and the scoring does what it says. The eval itself calls the real AI
 * and runs on demand (tests/evals/README.md).
 *
 * Run: npx playwright test tests/session4/advisor-eval-fixtures.spec.ts
 */

const school = (id: string) => evalSchool(EVAL_CASES.find((c) => c.id === id)!)

test('every case has checks, and every advisor a check names exists', () => {
  const ids = new Set(AGENTS.map((a) => a.id))
  expect(Object.keys(CASE_CHECKS).sort()).toEqual(EVAL_CASES.map((c) => c.id).sort())
  for (const [caseId, checks] of Object.entries(CASE_CHECKS)) {
    for (const named of checks.flatMap((c) => c.id.match(/[a-z]+_[a-z_]+/g) ?? [])) {
      expect(ids.has(named), `${caseId}: ${named}`).toBe(true)
    }
  }
})

test('control: positive net and at least 60 days of cash every year; rate, SPED and back office in order', () => {
  const { multiYear, request } = school('control')
  for (const r of multiYear) {
    expect(r.net, `Y${r.year} net`).toBeGreaterThan(0)
    expect(r.reserveDays, `Y${r.year} days`).toBeGreaterThanOrEqual(60)
  }
  expect(request.agentContext).toContain('Special Education (SPED) Teacher: 3 FTE')
  expect(request.agentContext).toContain('CFO/Finance/Business Manager')
  expect(request.agentContext).toContain(`Regular Ed base rate $${DEFAULT_ASSUMPTIONS.regular_ed_per_pupil.toLocaleString()} per AAFTE`)
})

test('year3_cliff: positive through Year 2, negative from Year 3 as the grant ends', () => {
  const { multiYear } = school('year3_cliff')
  expect(multiYear[0].net).toBeGreaterThan(0)
  expect(multiYear[1].net).toBeGreaterThan(0)
  for (const r of multiYear.slice(2)) expect(r.net, `Y${r.year} net`).toBeLessThan(0)
  expect(multiYear[2].reserveDays).toBeLessThan(multiYear[1].reserveDays)
})

test('sped_understaffed: 14% IEP with one 0.5 FTE SPED teacher', () => {
  const { request } = school('sped_understaffed')
  expect(request.agentContext).toMatch(/IEP[^\n]*14%|14%[^\n]*IEP/)
  expect(request.agentContext).toContain('Special Education (SPED) Teacher: 0.5 FTE')
  expect(request.agentContext.match(/SPED\) Teacher:/g)).toHaveLength(1)
})

test('thin_back_office: no business manager and $8,000 of Contracted Services', () => {
  const { request } = school('thin_back_office')
  expect(request.agentContext).not.toContain('CFO/Finance/Business Manager')
  expect(request.agentContext).toMatch(/Contracted Services: \$8,000\b/)
})

test('regular_ed_rate: the base rate is above the default and the factor matches the county', () => {
  const { request } = school('regular_ed_rate')
  expect(request.agentContext).toContain('STATE RATES: Regular Ed base rate $13,900 per AAFTE (platform default from OSPI apportionment data: $11,812); regionalization factor 1.220 (county factor for King County (Seattle, Bellevue, Kent): 1.220)')
})

const panelWith = (agents: Partial<PanelAgent>[], briefing = 'Your Year 3 deficit and SPED staffing need work.'): Panel => ({
  briefing,
  agents: AGENTS.map((a) => ({ id: a.id, status: 'strong' as const, summary: 'Fine.', actions: [], ...agents.find((x) => x.id === a.id) })),
})

test('scoring: a panel that catches the problem passes; one that misses it or fails does not', () => {
  const caught = panelWith([{ id: 'staffing_advisor', status: 'risk', summary: 'One 0.5 FTE SPED teacher for about 40 IEP students cannot deliver their services.' }])
  expect(scorePanel('sped_understaffed', caught).every((c) => c.pass)).toBe(true)

  const missed = panelWith([])
  expect(scorePanel('sped_understaffed', missed).find((c) => c.id === 'staffing_advisor flags it')!.pass).toBe(false)

  const failed = panelWith([{ id: 'compliance_officer', failed: true }])
  expect(scorePanel('control', failed).find((c) => c.id === 'panel complete')!.pass).toBe(false)

  const risky = panelWith([{ id: 'commission_reviewer', status: 'risk' }])
  expect(scorePanel('control', risky).find((c) => c.id === 'no advisor reports risk')!.detail).toBe('commission_reviewer')
})

test('scoring: corrected claims are caught wherever they appear', () => {
  const capped = panelWith([{ id: 'staffing_advisor', summary: 'A 0.5 FTE SPED teacher cannot legally case-manage 40 IEPs.' }])
  expect(scorePanel('control', capped).find((c) => c.id === 'no advisor invents a legal SPED caseload cap')!.pass).toBe(false)
  const correct = panelWith([{ id: 'staffing_advisor', summary: 'Washington sets no caseload limit, but 40 IEPs need more than 0.5 FTE.' }])
  expect(scorePanel('control', correct).find((c) => c.id === 'no advisor invents a legal SPED caseload cap')!.pass).toBe(true)
  const trueUp = panelWith([], 'The January true-up will cut your funding.')
  expect(scorePanel('control', trueUp).find((c) => c.id.includes('October'))!.pass).toBe(false)
})

test('unmatched figures: context figures (exact or rounded) pass, invented ones are listed', () => {
  const context = 'Total Revenue: $5,361,678\nContracted Services: $8,000\nEnrollment: 288 students'
  const panel = panelWith([{ id: 'school_cfo', summary: 'Revenue of $5.36M ($5,361,678) with $8,000 of contracts; budget $45,000 for an audit.' }], 'About $5,362K of revenue.')
  expect(unmatchedFigures(panel, context)).toEqual(['$45,000'])
})
