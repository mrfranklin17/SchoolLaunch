import { test, expect } from '@playwright/test'
import { escapeHtml, escapeHtmlKeepStrong } from '../../src/lib/html'
import { buildPortfolioPdfHtml, type PortfolioSchoolMetrics } from '../../src/lib/portfolioPdf'
import { hasOrgLevelRole, authenticateOrgRequest } from '../../src/lib/apiAuth'

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
