import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { authenticateOrgRequest } from '@/lib/apiAuth'

interface SchoolMetrics {
  name: string
  status: string
  enrollmentY1: number
  reserveDays: number
  personnelPct: number
  netPosition: number
  fpfIssues: number
  readinessScore: number
  advisoryStatus: string
  onboardingComplete: boolean
  multiYear: Array<{ year: number; revenue: number; expenses: number; net: number; reserveDays: number }>
  scenarios: Array<{ name: string; assumptions: Record<string, number>; y1ReserveDays: number }> | null
}

export async function POST(request: Request) {
  // Org-level users only (org_admin / super_admin), like the portfolio PDF (P2-FU-02).
  const auth = await authenticateOrgRequest()
  if (auth instanceof NextResponse) return auth

  const { orgName, schools } = await request.json() as { orgName: string; schools: SchoolMetrics[] }

  const wb = XLSX.utils.book_new()

  // Tab 1: Summary
  const summaryRows = [
    ['Portfolio Financial Summary', orgName],
    ['Generated', new Date().toLocaleDateString()],
    [],
    ['Total Schools', schools.length],
    ['Onboarding Complete', schools.filter(s => s.onboardingComplete).length],
    ['Meeting FPF Stage 1', schools.filter(s => s.onboardingComplete && s.fpfIssues === 0).length],
    ['Average Reserve Days', schools.filter(s => s.onboardingComplete).length > 0
      ? Math.round(schools.filter(s => s.onboardingComplete).reduce((s, sc) => s + sc.reserveDays, 0) / schools.filter(s => s.onboardingComplete).length)
      : 'N/A'],
    ['Average Personnel %', schools.filter(s => s.onboardingComplete).length > 0
      ? `${(schools.filter(s => s.onboardingComplete).reduce((s, sc) => s + sc.personnelPct, 0) / schools.filter(s => s.onboardingComplete).length).toFixed(1)}%`
      : 'N/A'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')

  // Tab 2: School Metrics
  const metricsHeader = ['School', 'Status', 'Enrollment', 'Reserve Days', 'Personnel %', 'Net Position', 'FPF Issues', 'Readiness', 'Advisory']
  const metricsRows = schools.map(s => [
    s.name,
    s.onboardingComplete ? s.status : 'Setup Incomplete',
    s.enrollmentY1,
    s.onboardingComplete ? s.reserveDays : 'N/A',
    s.onboardingComplete ? `${s.personnelPct.toFixed(1)}%` : 'N/A',
    s.onboardingComplete ? s.netPosition : 'N/A',
    s.onboardingComplete ? s.fpfIssues : 'N/A',
    `${s.readinessScore}/5`,
    s.advisoryStatus,
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([metricsHeader, ...metricsRows]), 'School Metrics')

  // Tab 3: 5-Year Projections
  const projRows: (string | number)[][] = []
  for (const s of schools.filter(sc => sc.onboardingComplete)) {
    projRows.push([s.name])
    projRows.push(['Year', 'Revenue', 'Expenses', 'Net Position', 'Reserve Days'])
    for (const yr of s.multiYear) {
      projRows.push([`Year ${yr.year}`, yr.revenue, yr.expenses, yr.net, yr.reserveDays])
    }
    projRows.push([])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(projRows), '5-Year Projections')

  // Tab 4: Scenarios
  const scenRows: (string | number)[][] = [['SCENARIO ANALYSIS']]
  for (const s of schools.filter(sc => sc.scenarios && sc.scenarios.length > 0)) {
    scenRows.push([], [s.name])
    scenRows.push(['Scenario', 'Enrollment Fill', 'Funding Adj', 'Personnel Adj', 'Facility/mo', 'Startup Capital', 'Y1 Reserve Days'])
    for (const sc of (s.scenarios || [])) {
      scenRows.push([
        sc.name,
        `${Math.round((sc.assumptions.enrollment_fill_rate || 0) * 100)}%`,
        `${((sc.assumptions.per_pupil_funding_adjustment || 0) * 100).toFixed(0)}%`,
        `${((sc.assumptions.personnel_cost_adjustment || 0) * 100).toFixed(0)}%`,
        sc.assumptions.facility_cost_monthly || 0,
        sc.assumptions.startup_capital || 0,
        sc.y1ReserveDays,
      ])
    }
  }
  if (scenRows.length > 1) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scenRows), 'Scenarios')
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${orgName.replace(/[^a-zA-Z0-9]/g, '_')}_Portfolio_Summary.xlsx"`,
    },
  })
}
