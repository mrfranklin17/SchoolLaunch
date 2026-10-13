import {
  evaluateDaysOfCash,
  evaluatePersonnelPct,
  healthColor,
  healthPathway,
  type HealthPathway,
  type HealthStatus,
} from './healthThresholds'
import { escapeHtml as esc } from './html'

// Portfolio PDF (print-ready HTML) built from the portfolio page's export payload. Kept free of
// next/server so it can be unit tested. Every request-body value that is not run through a number
// formatter here is escaped: the page writes this HTML into a same-origin window (P2-FU-02).

export interface PortfolioSchoolMetrics {
  name: string
  status: string
  /** 'wa_charter' or 'generic' health-threshold family (absent on older payloads: WA). */
  pathway?: string
  gradeConfig: string
  openingYear: number
  enrollmentY1: number
  reserveDays: number
  personnelPct: number
  netPosition: number
  totalRevenue: number
  totalExpenses: number
  fpfIssues: number
  readinessScore: number
  advisoryStatus: string
  onboardingComplete: boolean
  multiYear: Array<{ year: number; revenue: number; expenses: number; net: number; reserveDays: number }>
  scenarios: Array<{ name: string; y1ReserveDays: number }> | null
}

export interface PortfolioPdfPayload {
  orgName: string
  schools: PortfolioSchoolMetrics[]
  dateStr: string
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`
  // Number(): a non-numeric body value prints as NaN instead of passing through as markup.
  return `$${Number(n).toLocaleString()}`
}

// Print colors and verdicts come from the shared health bands (R-HEALTH-01). WA schools use
// Commission Stage 1/2 Days of Cash bands by year and the founding-year personnel band for
// Year 1 figures; generic schools use the generic benchmarks.
const fg = (status: HealthStatus) => healthColor(status, 'hexFg')

/** Days-of-cash color for the given operating year (Year 1 unless a multi-year cell). */
function rColor(days: number, hp: HealthPathway, year = 1): string {
  return fg(evaluateDaysOfCash(days, year, hp).status)
}

/** Year 1 personnel % color. */
function pColor(pct: number, hp: HealthPathway): string {
  return fg(evaluatePersonnelPct(pct, 1, hp).status)
}

/** Sign color for net position. */
function nColor(net: number): string {
  return fg(net >= 0 ? 'meets' : 'fails')
}

export function buildPortfolioPdfHtml({ orgName, schools, dateStr }: PortfolioPdfPayload): string {
  const onboarded = schools.filter(s => s.onboardingComplete)
  const meetingStage1 = onboarded.filter(s => s.fpfIssues === 0).length
  const avgDays = onboarded.length > 0 ? Math.round(onboarded.reduce((s, sc) => s + sc.reserveDays, 0) / onboarded.length) : 0
  const avgPct = onboarded.length > 0 ? (onboarded.reduce((s, sc) => s + sc.personnelPct, 0) / onboarded.length).toFixed(1) : '0'
  const hpOf = (s: PortfolioSchoolMetrics) => healthPathway(s.pathway)
  // Portfolio-wide averages use the generic bands only when every onboarded school is generic.
  const portfolioHp: HealthPathway = onboarded.length > 0 && onboarded.every((s) => hpOf(s) === 'generic') ? 'generic' : 'wa_charter'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  body { font-family: 'DM Sans', sans-serif; color: #1e293b; margin: 0; padding: 40px; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin-top: 32px; margin-bottom: 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; padding: 6px 8px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 10px; text-transform: uppercase; color: #64748b; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  .metric-card { display: inline-block; width: 23%; background: #f8fafc; border-radius: 8px; padding: 12px 16px; margin-right: 2%; vertical-align: top; }
  .metric-label { font-size: 9px; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
  .metric-value { font-size: 20px; font-weight: 700; }
  .page-break { page-break-before: always; }
  .footer { font-size: 9px; color: #94a3b8; text-align: center; margin-top: 40px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
  .badge-green { background: ${healthColor('meets', 'hexBg')}; color: ${healthColor('meets', 'hexFg')}; }
  .badge-yellow { background: ${healthColor('approaching', 'hexBg')}; color: ${healthColor('approaching', 'hexFg')}; }
  .badge-red { background: ${healthColor('fails', 'hexBg')}; color: ${healthColor('fails', 'hexFg')}; }
</style>
</head>
<body>

<h1>${esc(orgName)} — Portfolio Financial Summary</h1>
<p style="color:#64748b;margin-bottom:24px;">Generated ${esc(dateStr)}</p>

<div style="margin-bottom:24px;">
  <div class="metric-card"><div class="metric-label">Total Schools</div><div class="metric-value">${schools.length}</div></div>
  <div class="metric-card"><div class="metric-label">Meeting FPF Stage 1</div><div class="metric-value" style="color:${fg(meetingStage1 === onboarded.length ? 'meets' : 'approaching')}">${meetingStage1}/${onboarded.length}</div></div>
  <div class="metric-card"><div class="metric-label">Avg Reserve Days</div><div class="metric-value" style="color:${onboarded.length > 0 ? rColor(avgDays, portfolioHp) : '#94a3b8'}">${avgDays}</div></div>
  <div class="metric-card"><div class="metric-label">Avg Personnel %</div><div class="metric-value" style="color:${onboarded.length > 0 ? pColor(Number(avgPct), portfolioHp) : '#94a3b8'}">${avgPct}%</div></div>
</div>

<h2>Portfolio Risk Overview</h2>
<table>
  <thead>
    <tr>
      <th>School</th><th>Status</th><th>Enrollment</th><th style="text-align:right;">Reserve Days</th>
      <th style="text-align:right;">Personnel %</th><th style="text-align:right;">Net Position</th><th>FPF</th><th>Ready</th>
    </tr>
  </thead>
  <tbody>
    ${schools.map(s => `<tr>
      <td style="font-weight:600;">${esc(s.name)}</td>
      <td>${s.onboardingComplete ? esc(s.status) : 'Setup Incomplete'}</td>
      <td>${esc(s.enrollmentY1 || '—')}</td>
      <td style="text-align:right;color:${s.onboardingComplete ? rColor(s.reserveDays, hpOf(s)) : '#94a3b8'};font-weight:600;">${s.onboardingComplete ? `${esc(s.reserveDays)}d` : '—'}</td>
      <td style="text-align:right;color:${s.onboardingComplete ? pColor(s.personnelPct, hpOf(s)) : '#94a3b8'};font-weight:600;">${s.onboardingComplete ? `${s.personnelPct.toFixed(1)}%` : '—'}</td>
      <td style="text-align:right;color:${nColor(s.netPosition ?? 0)};font-weight:600;">${s.onboardingComplete ? fmt(s.netPosition) : '—'}</td>
      <td>${s.onboardingComplete ? (s.fpfIssues === 0 ? '<span class="badge badge-green">Meets</span>' : `<span class="badge badge-red">${esc(s.fpfIssues)} Issues</span>`) : '—'}</td>
      <td>${esc(s.readinessScore)}/5</td>
    </tr>`).join('')}
  </tbody>
</table>

${onboarded.length > 0 ? `
<div class="page-break"></div>
<h2>Per-School Financial Snapshots</h2>

${onboarded.map(s => `
<div style="margin-bottom:24px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;">
  <h3 style="margin:0 0 4px 0;font-size:14px;">${esc(s.name)}</h3>
  <p style="font-size:11px;color:#64748b;margin:0 0 12px 0;">${esc(s.gradeConfig)} · ${esc(s.enrollmentY1)} students Year 1 · Opening ${esc(s.openingYear)}</p>

  <div style="display:flex;gap:12px;margin-bottom:12px;">
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:8px 12px;">
      <div style="font-size:9px;color:#64748b;text-transform:uppercase;">Reserve Days</div>
      <div style="font-size:16px;font-weight:700;color:${rColor(s.reserveDays, hpOf(s))};">${esc(s.reserveDays)}d</div>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:8px 12px;">
      <div style="font-size:9px;color:#64748b;text-transform:uppercase;">Personnel %</div>
      <div style="font-size:16px;font-weight:700;color:${pColor(s.personnelPct, hpOf(s))};">${s.personnelPct.toFixed(1)}%</div>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:8px 12px;">
      <div style="font-size:9px;color:#64748b;text-transform:uppercase;">Net Position</div>
      <div style="font-size:16px;font-weight:700;color:${nColor(s.netPosition)};">${fmt(s.netPosition)}</div>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:8px 12px;">
      <div style="font-size:9px;color:#64748b;text-transform:uppercase;">Readiness</div>
      <div style="font-size:16px;font-weight:700;">${esc(s.readinessScore)}/5</div>
    </div>
  </div>

  ${s.multiYear.length > 0 ? `
  <table style="font-size:11px;">
    <thead><tr><th>Year</th><th style="text-align:right;">Revenue</th><th style="text-align:right;">Expenses</th><th style="text-align:right;">Net</th><th style="text-align:right;">Days</th></tr></thead>
    <tbody>
      ${s.multiYear.map(yr => `<tr>
        <td>Year ${esc(yr.year)}</td>
        <td style="text-align:right;">${fmt(yr.revenue)}</td>
        <td style="text-align:right;">${fmt(yr.expenses)}</td>
        <td style="text-align:right;color:${nColor(yr.net)}">${fmt(yr.net)}</td>
        <td style="text-align:right;color:${rColor(yr.reserveDays, hpOf(s), yr.year)}">${esc(yr.reserveDays)}d</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ` : ''}

  ${s.scenarios && s.scenarios.length > 0 ? `
  <div style="margin-top:8px;font-size:11px;">
    <strong>Scenarios:</strong>
    ${s.scenarios.map(sc => `<span style="margin-left:8px;color:${rColor(sc.y1ReserveDays, hpOf(s))}">${esc(sc.name)}: ${esc(sc.y1ReserveDays)}d</span>`).join(' ·')}
  </div>
  ` : ''}
</div>
`).join('')}
` : ''}

<div class="footer">SchoolLaunch Portfolio Report · ${esc(orgName)} · Generated ${esc(dateStr)}</div>

</body>
</html>`
}
