import { test, expect } from '@playwright/test'
import { escapeHtml, escapeHtmlKeepStrong } from '../../src/lib/html'
import { buildPortfolioPdfHtml, type PortfolioSchoolMetrics } from '../../src/lib/portfolioPdf'
import { hasOrgLevelRole, authenticateOrgRequest } from '../../src/lib/apiAuth'
import { buildNarrativeHtml, type NarrativePayload } from '../../src/app/api/export/narrative/route'
import { runProjections, computeFPFScorecard, computeGenericHealthScorecard, computeEnrollmentSensitivity, type ProjectionInputs } from '../../src/lib/budgetEngine'
import { getStateConfig } from '../../src/lib/stateConfig'
import { DEFAULT_ASSUMPTIONS, type SchoolProfile, type StaffingPosition, type BudgetProjection } from '../../src/lib/types'

/**
 * P2-FU-02 — the narrative and portfolio PDF routes return HTML that the dashboard writes into
 * a same-origin window (window.open + document.write), so a school or organization name, a
 * position title or AI text carrying markup would run with the viewer's session. Every such
 * string goes through escapeHtml, and the portfolio export is limited to org-level users.
 *
 * Run: npx playwright test tests/session4/export-html-escaping.spec.ts
 */

const XSS_IMG = '<img src=x onerror=alert(1)>'
const XSS_SCRIPT = '</script><script>alert(1)</script>'

test.describe('escapeHtml', () => {
  test('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
  test('null/undefined render empty; numbers render as text', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(42)).toBe('42')
  })
  test('escapeHtmlKeepStrong keeps bare <strong> only', () => {
    expect(escapeHtmlKeepStrong('<strong>1. Enrollment:</strong> <em>x</em>'))
      .toBe('<strong>1. Enrollment:</strong> &lt;em&gt;x&lt;/em&gt;')
    expect(escapeHtmlKeepStrong('<strong onclick="x">a</strong>'))
      .toBe('&lt;strong onclick=&quot;x&quot;&gt;a</strong>')
    expect(escapeHtmlKeepStrong(XSS_IMG)).not.toContain('<img')
  })
})

function school(name: string, extra: Partial<PortfolioSchoolMetrics> = {}): PortfolioSchoolMetrics {
  return {
    name, status: 'Active', pathway: 'wa_charter', gradeConfig: 'K-5', openingYear: 2027,
    enrollmentY1: 120, reserveDays: 45, personnelPct: 70.2, netPosition: 150000,
    totalRevenue: 1_800_000, totalExpenses: 1_650_000, fpfIssues: 0, readinessScore: 4,
    advisoryStatus: 'strong', onboardingComplete: true,
    multiYear: [{ year: 1, revenue: 1_800_000, expenses: 1_650_000, net: 150000, reserveDays: 45 }],
    scenarios: [{ name: 'Base Case', y1ReserveDays: 45 }],
    ...extra,
  }
}

test.describe('portfolio PDF HTML', () => {
  test('school, org, grade, scenario and date strings never render as markup', () => {
    const html = buildPortfolioPdfHtml({
      orgName: `Org ${XSS_SCRIPT}`,
      dateStr: XSS_IMG,
      schools: [school(XSS_IMG, {
        gradeConfig: XSS_SCRIPT,
        status: XSS_IMG,
        scenarios: [{ name: XSS_SCRIPT, y1ReserveDays: 10 }],
      })],
    })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('legitimate names with & and quotes are escaped exactly once', () => {
    const html = buildPortfolioPdfHtml({
      orgName: 'Excellent Schools & Partners',
      dateStr: 'October 13, 2026',
      schools: [school(`O'Brien "Arts" Academy`)],
    })
    expect(html).toContain('Excellent Schools &amp; Partners')
    expect(html).toContain('O&#39;Brien &quot;Arts&quot; Academy')
    expect(html).not.toContain('&amp;amp;')
    expect(html).not.toContain('&amp;#39;')
  })
})

/** Minimal stand-in for the Supabase client calls authenticateOrgRequest makes. */
function fakeClient(user: { id: string; email: string } | null, roles: { role: string; school_id: string | null; organization_id: string | null }[]) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: roles, error: null }) }) }),
  } as unknown as Parameters<typeof authenticateOrgRequest>[0]
}

test.describe('portfolio export auth (org-level roles only)', () => {
  test('hasOrgLevelRole', () => {
    expect(hasOrgLevelRole([{ role: 'org_admin' }])).toBe(true)
    expect(hasOrgLevelRole([{ role: 'school_ceo' }, { role: 'super_admin' }])).toBe(true)
    expect(hasOrgLevelRole([{ role: 'school_ceo' }, { role: 'school_editor' }, { role: 'school_viewer' }])).toBe(false)
    expect(hasOrgLevelRole([])).toBe(false)
    expect(hasOrgLevelRole(null)).toBe(false)
  })

  test('401 signed out, 403 for school-only roles, success for org admins', async () => {
    const out = await authenticateOrgRequest(fakeClient(null, []))
    expect('status' in out && out.status).toBe(401)

    const ceo = await authenticateOrgRequest(fakeClient({ id: 'u1', email: 'ceo@x.test' }, [{ role: 'school_ceo', school_id: 's1', organization_id: null }]))
    expect('status' in ceo && ceo.status).toBe(403)

    const admin = await authenticateOrgRequest(fakeClient({ id: 'u2', email: 'admin@x.test' }, [
      { role: 'school_viewer', school_id: 's1', organization_id: null },
      { role: 'org_admin', school_id: null, organization_id: 'o1' },
    ]))
    expect('user' in admin && admin.user.id).toBe('u2')
    expect('roles' in admin && admin.roles.map((r) => r.role)).toEqual(['org_admin'])
  })
})

// --- Narrative PDF -------------------------------------------------------------------------

const HOSTILE = [XSS_IMG, XSS_SCRIPT, '</title><script>alert(2)</script>']
const h = (i: number) => HOSTILE[i % HOSTILE.length]

function narrativePayload(pathway: 'wa_charter' | 'generic_private'): NarrativePayload {
  const positions: StaffingPosition[] = [
    { school_id: 's', year: 1, title: h(0), category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
    { school_id: 's', year: 1, title: h(1), category: 'certificated', fte: 5, annual_salary: 68000, position_type: 'teacher_elem', classification: 'Certificated', driver: 'per_pupil', students_per_position: 22 },
  ]
  const projections: BudgetProjection[] = [{ school_id: 's', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 150000, is_revenue: false }]
  const profile = {
    school_id: 's', region: h(2), planned_open_year: 2027, grade_config: h(0),
    target_enrollment_y1: 110, target_enrollment_y2: 130, target_enrollment_y3: 150, target_enrollment_y4: 170, target_enrollment_y5: 190,
    max_class_size: 24, pct_frl: 55, pct_iep: 12, pct_ell: 10, pct_hicap: 5, onboarding_complete: true, retention_rate: 92,
    financial_assumptions: {}, tuition_rate: 15000, financial_aid_pct: 0.1,
    startup_funding: [{ source: h(1), amount: 200000, type: h(2), status: 'received', selectedYears: [1], yearAllocations: { 1: 200000 } }],
    custom_revenue_lines: pathway === 'wa_charter'
      ? [{ id: 'c1', name: h(0), group: 'Other', driver: 'flat', amountY1: 10000, recurring: true }]
      : [{ key: 'registration_fees', label: h(0), amount: 22000 }],
    custom_expense_lines: [{ id: 'e1', name: h(1), group: 'Contracted Services', driver: 'flat', amountY1: 5000 }],
  } as unknown as SchoolProfile
  const inputs: ProjectionInputs = { pathway, profile, positions, projections, assumptions: DEFAULT_ASSUMPTIONS, preOpenCash: 150000, gradeExpansionPlan: [], allPositions: positions, startupFunding: profile.startup_funding }
  const multiYear = runProjections(inputs)
  const scorecard = pathway === 'wa_charter'
    ? computeFPFScorecard(multiYear, 150000, false)
    : computeGenericHealthScorecard(multiYear, 150000, getStateConfig(pathway), 15000, 0.1)
  return {
    schoolName: h(1),
    pathway,
    profile: profile as unknown as NarrativePayload['profile'],
    assumptions: DEFAULT_ASSUMPTIONS as unknown as NarrativePayload['assumptions'],
    positions: positions as unknown as NarrativePayload['positions'],
    projections,
    multiYear,
    sensitivity: computeEnrollmentSensitivity(inputs, 0.9),
    scorecard: scorecard as NarrativePayload['scorecard'],
    advisory: {
      briefing: h(0), generatedAt: h(1),
      agents: [{ id: 'a', name: h(0), icon: h(1), subtitle: h(2), status: 'risk', summary: h(1), actions: [h(0), h(2)] }],
    },
    scenarios: [{
      name: h(0),
      assumptions: { enrollment_fill_rate: 0.9, per_pupil_funding_adjustment: 0, personnel_cost_adjustment: 0, facility_cost_monthly: 10000, startup_capital: 150000 },
      results: { years: { '1': { enrollment: 99, total_revenue: 1500000, total_expenses: 1400000, net_position: 100000, reserve_days: 40, personnel_pct: 70, fpf_current_ratio: 'meets', fpf_days_cash: 'meets', fpf_total_margin: 'meets', fpf_enrollment_variance: 'approaches' } } },
      ai_analysis: h(2),
    }],
  }
}

test.describe('narrative PDF HTML', () => {
  for (const pathway of ['wa_charter', 'generic_private'] as const) {
    test(`${pathway}: request-body and AI strings never render as markup`, async () => {
      // The AI stub returns markup too; only bare <strong> may survive in the risk text.
      const ai = async () => `<strong>1. Risk:</strong> ${XSS_IMG}\n<strong>2. Risk:</strong> ${XSS_SCRIPT}`
      const html = await buildNarrativeHtml(narrativePayload(pathway), ai)
      expect(html).not.toContain('<img src=x')
      expect(html).not.toContain('<script>alert(')
      expect(html).not.toMatch(/<\/title>\s*<script/)
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
      expect(html).not.toContain('&amp;lt;') // escaped once, not twice
    })
  }

  test('numbers the template prints raw are coerced: a string in an engine row renders as NaN', async () => {
    const payload = narrativePayload('wa_charter')
    ;(payload.multiYear[0] as unknown as Record<string, unknown>).reserveDays = XSS_IMG
    ;(payload.multiYear[0] as unknown as Record<string, unknown>).enrollment = XSS_SCRIPT
    ;(payload.sensitivity as unknown as Record<string, unknown>).daysOfCash = XSS_IMG
    const html = await buildNarrativeHtml(payload, async () => '')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(')
  })
})
