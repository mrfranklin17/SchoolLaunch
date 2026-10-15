import { test, expect } from '@playwright/test'
import { AGENTS, DATA_BOUNDARIES } from '../../src/app/api/advisory/route'

/**
 * Advisor expertise, step 1: advisors work only from the school context they're given. It has
 * Year 1 staffing and operations, categorical revenue, monthly cash and the five-year cash
 * trajectory, and none of: district salary scales, waitlists, AAFTE assumption, Year 0
 * itemization, accounting system, signatories, later-year staffing. Checks that need those are
 * questions for the founder; they must not reappear as red flags or status rules.
 *
 * Run: npx playwright test tests/session4/advisor-data-boundaries.spec.ts
 */

test('the shared rule forbids invented figures and keeps unknowns out of the status', () => {
  expect(DATA_BOUNDARIES).toMatch(/Never invent a number or fact/)
  expect(DATA_BOUNDARIES).toMatch(/An unknown on its own never sets your status/)
  expect(DATA_BOUNDARIES).toMatch(/inside Contracted Services/)
})

test('the seven WA advisors are all present', () => {
  expect(AGENTS.map((a) => a.id)).toEqual([
    'commission_reviewer', 'enrollment_realist', 'staffing_advisor', 'compliance_officer',
    'operations_analyst', 'board_finance_chair', 'school_cfo',
  ])
})

// Red flags / status rules that depend on data the context can't show.
const UNCHECKABLE = [
  /salaries 10%\+ below district/i,
  /below the surrounding district's comparable/i,
  /no waitlist strategy documented/i,
  /AAFTE assumption >95%/,
  /Year 0 startup costs <\$250K/,
  /No annual audit budgeted/,
  /No D&O insurance budgeted/,
  /second financial signatory/,
  /in any year/i,
  /No accounting system named/i,
  /No payroll service identified/i,
  /Y2 in cash flow detail/,
]

for (const pattern of UNCHECKABLE) {
  test(`no advisor relies on unavailable data: ${pattern}`, () => {
    const hits = AGENTS.filter((a) => pattern.test(a.systemPrompt)).map((a) => a.id)
    expect(hits).toEqual([])
  })
}
