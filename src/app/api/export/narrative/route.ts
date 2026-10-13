import { NextRequest, NextResponse } from 'next/server'
import { callAnthropic } from '@/lib/anthropic-client'
import { getStateConfig, type Pathway } from '@/lib/stateConfig'
import { authenticateRequest } from '@/lib/apiAuth'
import { escapeHtml as esc, escapeHtmlKeepStrong } from '@/lib/html'
import {
  computeMonthlyCashFlow,
  beginningCashOf,
  personnelPctOfRevenue,
  facilityPctOfRevenue,
  breakEvenEnrollment,
  type MultiYearDetailedRow,
  type EnrollmentSensitivity,
  type FPFMeasure,
  type GenericHealthMeasure,
} from '@/lib/budgetEngine'
import {
  evaluateDaysOfCash,
  evaluateFacilityPct,
  evaluatePersonnelPct,
  getDaysOfCashBand,
  getFacilityPctBand,
  getPersonnelHealthBand,
  healthPathway,
  fpfStageForYear,
  fromFpfStatus,
  fromGenericColor,
  healthColor,
} from '@/lib/healthThresholds'

// --- Types matching the POST body ---
interface Position {
  title: string
  category: 'certificated' | 'classified' | 'admin'
  fte: number
  annual_salary: number
}

interface Projection {
  category: string
  subcategory: string
  amount: number
  is_revenue: boolean
}

interface FundingSource {
  source: string
  amount: number
  type: string
  status: string
}

/** FPF measures carry per-year statuses; the generic health scorecard's values are objects. */
function isFpfMeasure(m: FPFMeasure | GenericHealthMeasure): m is FPFMeasure {
  return Array.isArray((m as FPFMeasure).statuses)
}

interface RevenueLine {
  subcategory: string
  amount: number
  /** Display formula; undefined = derive from the line name, '' = none. */
  formula?: string
}

export interface NarrativePayload {
  schoolName: string
  pathway?: string
  profile: {
    grade_config: string
    target_enrollment_y1: number
    target_enrollment_y2: number
    target_enrollment_y3: number
    target_enrollment_y4: number
    pct_frl: number
    pct_iep: number
    pct_ell: number
    pct_hicap: number
    max_class_size: number
    planned_open_year: number
    region: string
    startup_funding?: FundingSource[] | null
  }
  assumptions: {
    per_pupil_rate: number
    levy_equity_per_student: number
    benefits_load_pct: number
    authorizer_fee_pct: number
    regular_ed_per_pupil: number
    sped_per_pupil: number
    state_sped_per_pupil: number
    facilities_per_pupil: number
    lap_per_pupil: number
    lap_high_poverty_per_pupil: number
    tbip_per_pupil: number
    hicap_per_pupil: number
    title_i_per_pupil: number
    idea_per_pupil: number
    revenue_cola_pct: number
    aafte_pct: number
    interest_rate_on_cash: number
    regionalization_factor: number
    food_service_revenue_per_pupil: number
    transportation_revenue_per_pupil: number
  }
  positions: Position[]
  projections: Projection[]
  /** The pathway engine's 5-year rows (runProjections on saved data). Every Year-N figure comes from here. */
  multiYear: MultiYearDetailedRow[]
  /** computeEnrollmentSensitivity(projectionInputs, 0.9): Year-1 revenue at reduced enrollment, expenses held at base. */
  sensitivity?: EnrollmentSensitivity
  /** WA: the Commission FPF scorecard. Other pathways: the generic financial health scorecard. */
  scorecard?: {
    measures: (FPFMeasure | GenericHealthMeasure)[]
  }
  advisory?: {
    briefing: string
    agents: {
      id: string
      name: string
      icon: string
      subtitle: string
      status: 'strong' | 'needs_attention' | 'risk'
      summary: string
      actions: string[]
    }[]
    generatedAt: string
  }
  scenarios?: {
    name: string
    assumptions: { enrollment_fill_rate: number; per_pupil_funding_adjustment: number; personnel_cost_adjustment: number; facility_cost_monthly: number; startup_capital: number }
    results: { years: Record<string, { enrollment: number; total_revenue: number; total_expenses: number; net_position: number; reserve_days: number; personnel_pct: number; fpf_current_ratio: string; fpf_days_cash: string; fpf_total_margin: string; fpf_enrollment_variance: string }> } | null
    ai_analysis?: string | null
  }[]
}

function fmtDollars(n: number): string {
  // Number(): a non-numeric body value (e.g. a JSONB amount) prints as NaN, never as markup.
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return fmtDollars(n)
}

function pct(n: number, total: number): string {
  return total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%'
}

const MONTH_NAMES: Record<string, string> = {
  Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December', Jan: 'January', Feb: 'February',
  Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August',
}

async function generateAIContent(prompt: string, context: string): Promise<string> {
  try {
    const response = await callAnthropic({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: `${context}\n\n${prompt}` }],
    })
    const block = response.content[0]
    return block.type === 'text' ? block.text : ''
  } catch (err) {
    console.error('AI generation failed:', err)
    return ''
  }
}

export async function POST(request: NextRequest) {
  const data: NarrativePayload & { schoolId?: string } = await request.json()

  const auth = await authenticateRequest(request, { schoolId: data.schoolId })
  if (auth instanceof NextResponse) return auth

  if (!Array.isArray(data.multiYear) || data.multiYear.length === 0) {
    return NextResponse.json({ error: 'multiYear projections are required' }, { status: 400 })
  }

  return new NextResponse(await buildNarrativeHtml(data, generateAIContent), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * The print-ready narrative page for a payload with engine rows. `generate` writes the AI
 * executive summary and risk analysis (tests pass a stub). The dashboard writes this HTML into a
 * same-origin tab, so every request-body and AI string is escaped (P2-FU-02); only numbers
 * (engine-row values coerced with Number() below, and our own formatting) are interpolated raw.
 */
export async function buildNarrativeHtml(
  data: NarrativePayload,
  generate: (prompt: string, context: string) => Promise<string>,
): Promise<string> {
  const {
    schoolName, profile, assumptions, positions,
    scorecard, advisory, scenarios,
    pathway: rawPathway,
  } = data
  // The template prints these engine values raw (charts, tables, prose), so coerce them here:
  // a malformed request body can then only render NaN, never markup.
  const multiYear = data.multiYear.map((r) => ({
    ...r,
    year: Number(r.year),
    enrollment: Number(r.enrollment),
    reserveDays: Number(r.reserveDays),
  }))
  const sensitivity = data.sensitivity
    ? (Object.fromEntries(
        Object.entries(data.sensitivity).map(([k, v]) => [k, Number(v)]),
      ) as unknown as NonNullable<NarrativePayload['sensitivity']>)
    : data.sensitivity

  // Pathway detection for generic vs WA-specific content
  const pathway = (rawPathway || 'wa_charter') as Pathway
  const isWaCharter = pathway === 'wa_charter'
  const hp = healthPathway(pathway)
  const pathwayConfig = getStateConfig(pathway)
  // The generic engine books its primary revenue (tuition or per-pupil funding) in regularEd.
  const primaryRevenueLabel = isWaCharter ? 'Regular Ed Apportionment'
    : pathwayConfig.revenue_model === 'tuition' ? 'Net Tuition Revenue' : 'Per-Pupil Funding'
  // Benefits load the pathway's engine applies (WA: founder assumption; others: pathway config),
  // so the Personnel table's rows sum to the engine's personnel total.
  const benefitsRate = isWaCharter ? assumptions.benefits_load_pct / 100 : pathwayConfig.benefits_load

  // Every Year-1 figure comes from the engine's Year-1 row (the same row the dashboard shows).
  const y1 = multiYear[0]
  const y1Rev = y1.revenue
  const enrollment = y1.enrollment
  const y1Revenue = y1Rev.total
  const y1OperatingRevenue = y1Rev.operatingRevenue
  const y1Personnel = y1.personnel.total
  const y1Operations = y1.operations.total
  const y1Expenses = y1.totalExpenses
  const y1Net = y1.net
  const y1ReserveDays = y1.reserveDays
  const y1BreakEven = breakEvenEnrollment(y1)
  const y1PersonnelPct = personnelPctOfRevenue(y1)
  const y1FacilityPct = facilityPctOfRevenue(y1)
  const personnelHealth = evaluatePersonnelPct(y1PersonnelPct, 1, hp)
  const facilityHealth = evaluateFacilityPct(y1FacilityPct)
  const facilityMaxPct = getFacilityPctBand().approachingAt
  const daysOfCashHealth = (days: number, year: number) => evaluateDaysOfCash(days, year, hp)
  // Reserve-day reference lines: WA Stage 1 / Stage 2 standards; generic concern / healthy benchmarks.
  const reserveFloorDays = isWaCharter ? getDaysOfCashBand(1, hp).meetsAt : getDaysOfCashBand(1, hp).approachingAt
  const reserveTargetDays = getDaysOfCashBand(3, hp).meetsAt
  const fillPct = sensitivity ? Math.round(sensitivity.fillRate * 100) : 90

  // Year-1 monthly cash flow from the engine row, starting from the year's beginning cash.
  const cashFlow = computeMonthlyCashFlow(y1, beginningCashOf(y1), { pathway })
  const lowMonthPct = cashFlow.lowScheduleMonths.length > 0
    ? (cashFlow.months.find((m) => m.month === cashFlow.lowScheduleMonths[0])?.apportionmentPct ?? 0) * 100
    : 0
  const lowMonthNames = cashFlow.lowScheduleMonths.map((m) => MONTH_NAMES[m] || m).join(' and ')

  // Canonical revenue lines from the engine row (matches Excel export names); the rows sum to
  // Total Revenue. Named lines get a formula; custom, grant and unlisted lines do not.
  const revenueLines: RevenueLine[] = [
    { subcategory: primaryRevenueLabel, amount: y1Rev.regularEd },
    { subcategory: 'SPED Apportionment', amount: y1Rev.sped },
    { subcategory: 'State Special Education', amount: y1Rev.stateSped },
    { subcategory: 'Facilities Revenue', amount: y1Rev.facilitiesRev },
    { subcategory: 'Levy Equity', amount: y1Rev.levyEquity },
    { subcategory: 'Small School Enhancement', amount: y1Rev.smallSchoolEnhancement },
    { subcategory: 'Title I', amount: y1Rev.titleI },
    { subcategory: 'IDEA (Federal Special Ed)', amount: y1Rev.idea },
    { subcategory: 'LAP (Learning Assistance)', amount: y1Rev.lap },
    { subcategory: 'LAP High Poverty', amount: y1Rev.lapHighPoverty },
    { subcategory: 'TBIP (Bilingual)', amount: y1Rev.tbip },
    { subcategory: 'Highly Capable', amount: y1Rev.hicap },
    { subcategory: 'Food Service (NSLP)', amount: y1Rev.foodServiceRev },
    { subcategory: 'Transportation (State)', amount: y1Rev.transportationRev },
    ...(y1Rev.customRevenue ?? []).map((c) => ({
      subcategory: `${c.name}${c.recurring === false ? ' (one-time)' : ''}`,
      amount: c.amount,
      formula: '',
    })),
    { subcategory: 'Startup Grants (one-time)', amount: y1Rev.grantRevenue, formula: '' },
    { subcategory: 'Interest & Other Income', amount: y1Rev.interestIncome },
  ]
  // The generic engine folds fee and other operating revenue into the total without a named line.
  const unlistedRevenue = y1Revenue - revenueLines.reduce((s, r) => s + (r.amount || 0), 0)
  if (unlistedRevenue >= 1) revenueLines.push({ subcategory: 'Other Operating Revenue', amount: unlistedRevenue, formula: '' })
  const revenueProjections = revenueLines.filter((r) => r.amount > 0)

  const fundingSources = profile.startup_funding || []
  const totalFunding = fundingSources.reduce((s, f) => s + f.amount, 0)
  const securedFunding = fundingSources.filter((f) => f.status === 'received' || f.status === 'pledged').reduce((s, f) => s + f.amount, 0)
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const totalFte = positions.reduce((s, p) => s + p.fte, 0)
  const teacherCount = positions.filter((p) => p.category === 'certificated' && /teacher/i.test(p.title)).reduce((s, p) => s + p.fte, 0)
  const studentTeacherRatio = teacherCount > 0 ? Math.round(enrollment / teacherCount) : 0

  // Build school context for AI calls
  const schoolContext = `School: ${schoolName}
Grade configuration: ${profile.grade_config}, Region: ${profile.region}
Year 1 enrollment: ${enrollment} students, Max class size: ${profile.max_class_size}
Demographics: ${profile.pct_frl}% FRL, ${profile.pct_iep}% IEP, ${profile.pct_ell}% ELL, ${profile.pct_hicap}% HiCap
Total Revenue: ${fmtDollars(y1Revenue)} (operating revenue ${fmtDollars(y1OperatingRevenue)})
Total Personnel: ${fmtDollars(y1Personnel)} (${y1PersonnelPct.toFixed(1)}% of operating revenue)
Total Operations: ${fmtDollars(y1Operations)}
Net Position: ${fmtDollars(y1Net)}
Reserve Days: ${y1ReserveDays}
Break-Even Enrollment: ${y1BreakEven} students
Facility Cost: ${y1FacilityPct.toFixed(1)}% of operating revenue
Staff: ${totalFte} FTE total, ${teacherCount} teachers, ${studentTeacherRatio}:1 student-teacher ratio
${sensitivity ? `Conservative (${fillPct}% enrollment, ${sensitivity.enrollment} students, expenses held at base): Revenue ${fmtDollars(sensitivity.totalRevenue)}, Net ${fmtDollars(sensitivity.netPosition)}, Reserve Days ${sensitivity.daysOfCash}
` : ''}Multi-year: Y1 net ${fmtDollars(multiYear[0]?.net || 0)}, Y2 net ${fmtDollars(multiYear[1]?.net || 0)}, Y3 net ${fmtDollars(multiYear[2]?.net || 0)}, Y4 net ${fmtDollars(multiYear[3]?.net || 0)}, Y5 net ${fmtDollars(multiYear[4]?.net || 0)}
Startup funding: ${fmtDollars(totalFunding)} total, ${fmtDollars(securedFunding)} secured`

  // Generate AI content in parallel
  const [executiveSummary, riskAnalysis] = await Promise.all([
    generate(
      isWaCharter
        ? `Write a 2-3 paragraph executive summary for a charter school financial plan being submitted to the Washington State Charter School Commission. Be specific with numbers. Be direct about risks. Write in third person (e.g., "The school projects..." not "You project..."). This should read like a professional financial document, not a conversation. Do not use markdown formatting — output plain text with paragraph breaks only.`
        : `Write a 2-3 paragraph executive summary for a school financial plan. Be specific with numbers. Be direct about risks. Write in third person (e.g., "The school projects..." not "You project..."). This should read like a professional financial document, not a conversation. Do not use markdown formatting — output plain text with paragraph breaks only.`,
      schoolContext,
    ),
    generate(
      isWaCharter
        ? `Based on this school's financial model, identify the top 5 financial risks and provide a specific mitigation strategy for each. Format as numbered items. Each risk should have a bold title (use <strong> tags), followed by the risk description and mitigation in 2-3 sentences. Write for a Charter School Commission reviewer — be specific and reference the school's actual numbers. Do not use markdown — use plain HTML inline formatting only (<strong> tags).`
        : `Based on this school's financial model, identify the top 5 financial risks and provide a specific mitigation strategy for each. Format as numbered items. Each risk should have a bold title (use <strong> tags), followed by the risk description and mitigation in 2-3 sentences. Write for a school board or financial reviewer — be specific and reference the school's actual numbers. Do not use markdown — use plain HTML inline formatting only (<strong> tags).`,
      schoolContext,
    ),
  ])

  // Revenue composition bar chart SVG — engine Year-1 lines as a share of operating revenue
  const effectiveRegularEd = y1Rev.regularEd || 0
  const spedApport = y1Rev.sped || 0
  const stateSpedRev = y1Rev.stateSped || 0
  const facilitiesRev = y1Rev.facilitiesRev || 0
  const levyEquity = y1Rev.levyEquity || 0
  const titleI = y1Rev.titleI || 0
  const idea = y1Rev.idea || 0
  const lap = y1Rev.lap || 0
  const lapHighPov = y1Rev.lapHighPoverty || 0
  const tbip = y1Rev.tbip || 0
  const hicap = y1Rev.hicap || 0
  const smallSchoolEnhancement = y1Rev.smallSchoolEnhancement || 0
  const totalRev = y1OperatingRevenue || 1

  const barSegments = [
    { label: isWaCharter ? 'Regular Ed' : primaryRevenueLabel, amount: effectiveRegularEd, color: '#1B2A4A' },
    { label: 'SPED Apport', amount: spedApport, color: '#3D5A80' },
    { label: 'State SpEd', amount: stateSpedRev, color: '#4A6FA5' },
    { label: 'Facilities', amount: facilitiesRev, color: '#5A7FA0' },
    { label: 'Levy Equity', amount: levyEquity, color: '#2D4A7A' },
    { label: 'Title I', amount: titleI, color: '#0F6E56' },
    { label: 'IDEA', amount: idea, color: '#16A085' },
    { label: 'LAP', amount: lap, color: '#2ECC71' },
    { label: 'LAP High Pov', amount: lapHighPov, color: '#27AE60' },
    { label: 'TBIP', amount: tbip, color: '#3498DB' },
    { label: 'HiCap', amount: hicap, color: '#9B59B6' },
    { label: 'Small School Enh', amount: smallSchoolEnhancement, color: '#E67E22' },
  ].filter((s) => s.amount > 0)

  let barX = 0
  const barWidth = 700
  const barSvg = barSegments.map((s) => {
    const w = (s.amount / totalRev) * barWidth
    const segment = `<rect x="${barX}" y="0" width="${w}" height="36" fill="${s.color}" />`
    barX += w
    return segment
  }).join('\n')

  const barLegend = barSegments.map((s) =>
    `<span style="display:inline-flex;align-items:center;margin-right:16px;font-size:10px;color:#475569;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${s.color};margin-right:4px;"></span>
      ${esc(s.label)} (${pct(s.amount, totalRev)})
    </span>`
  ).join('')

  // Reserve days line chart SVG
  const chartW = 500
  const chartH = 140
  const maxDays = Math.max(90, ...multiYear.map((y) => Math.abs(y.reserveDays)))
  const yScale = (d: number) => chartH - 20 - ((d + maxDays) / (maxDays * 2)) * (chartH - 40)
  const xStep = chartW / 5
  const linePoints = multiYear.map((y, i) => `${50 + (i + 1) * xStep},${yScale(y.reserveDays)}`).join(' ')
  const dotsSvg = multiYear.map((y, i) => {
    const color = healthColor(daysOfCashHealth(y.reserveDays, y.year).status, 'hexFg')
    return `<circle cx="${50 + (i + 1) * xStep}" cy="${yScale(y.reserveDays)}" r="5" fill="${color}" />
     <text x="${50 + (i + 1) * xStep}" y="${yScale(y.reserveDays) - 12}" text-anchor="middle" font-size="11" font-weight="600" fill="${color}">${y.reserveDays}d</text>`
  }).join('\n')

  // Revenue formula strings — show regionalized rates. Rates are the resolved assumptions as-is
  // (P-UX-26: an explicit $0 is honored, so no default fallbacks here).
  const regionFactor = assumptions.regionalization_factor || 1.0
  function rateWithRegion(base: number, regionalized: boolean = true): string {
    if (!regionalized || regionFactor === 1.0) return fmtDollars(base)
    return `${fmtDollars(base)} × ${regionFactor} = ${fmtDollars(Math.round(base * regionFactor))}`
  }

  // WA formulas only: the generic engine reads its rates from the pathway config, not these assumptions.
  function revenueFormula(sub: string): string {
    if (!isWaCharter) return ''
    const aafte = y1.aafte
    switch (sub) {
      case 'Regular Ed Apportionment': return `${aafte} AAFTE × ${rateWithRegion(assumptions.regular_ed_per_pupil)}`
      case 'SPED Apportionment': return `${aafte} AAFTE × ${profile.pct_iep}% IEP × ${rateWithRegion(assumptions.sped_per_pupil)}`
      case 'State Special Education': return `${Math.round(enrollment * profile.pct_iep / 100)} SPED students × ${rateWithRegion(assumptions.state_sped_per_pupil)}`
      case 'Facilities Revenue': return `${aafte} AAFTE × ${fmtDollars(assumptions.facilities_per_pupil)}`
      case 'State Apportionment': return `${enrollment} students × ${fmtDollars(assumptions.per_pupil_rate)}/student`
      case 'Levy Equity': return `${aafte} AAFTE × ${fmtDollars(assumptions.levy_equity_per_student)}`
      case 'Small School Enhancement': return 'Grade band AAFTE below prototypical minimums (K-6: 60, 7-8: 20, 9-12: 60)'
      case 'Title I': return profile.pct_frl > 40 ? `${enrollment} × ${profile.pct_frl}% FRL × ${fmtDollars(assumptions.title_i_per_pupil)}` : 'Not eligible (FRL < 40%)'
      case 'IDEA (Federal Special Ed)': return `${enrollment} × ${profile.pct_iep}% IEP × ${fmtDollars(assumptions.idea_per_pupil)}`
      case 'LAP (Learning Assistance)': return `${enrollment} × ${profile.pct_frl}% FRL × ${fmtDollars(assumptions.lap_per_pupil)}`
      case 'LAP High Poverty': return `${enrollment} × ${profile.pct_frl}% FRL × ${fmtDollars(assumptions.lap_high_poverty_per_pupil)}`
      case 'TBIP (Bilingual)': return `${enrollment} × ${profile.pct_ell}% ELL × ${fmtDollars(assumptions.tbip_per_pupil)}`
      case 'Highly Capable': return `${enrollment} × ${profile.pct_hicap}% HiCap × ${fmtDollars(assumptions.hicap_per_pupil)}`
      case 'Food Service (NSLP)': return `${enrollment} × ${fmtDollars(assumptions.food_service_revenue_per_pupil)}/student`
      case 'Transportation (State)': return `${enrollment} × ${fmtDollars(assumptions.transportation_revenue_per_pupil)}/student`
      case 'Interest & Other Income': return `${assumptions.interest_rate_on_cash}% on cash balance`
      default: return ''
    }
  }

  // Operations table: the engine's Year-1 operations lines, so the rows sum to Total Operations.
  const ops = y1.operations
  const opsGroups: { group: string; rows: { label: string; amount: number }[] }[] = [
    { group: 'Facilities & Occupancy', rows: [
      { label: 'Facilities', amount: ops.facilities },
      { label: 'Insurance', amount: ops.insurance },
      { label: 'Facility Depreciation (non-cash)', amount: ops.depreciation ?? 0 },
      { label: 'Facility Interest', amount: ops.interest ?? 0 },
    ] },
    { group: 'Instructional', rows: [
      { label: 'Supplies & Materials', amount: ops.supplies },
      { label: 'Technology', amount: ops.technology },
      { label: 'Curriculum & Materials', amount: ops.curriculum },
      { label: 'Professional Development', amount: ops.profDev },
    ] },
    { group: 'Student Services', rows: [
      { label: 'Food Service', amount: ops.foodService },
      { label: 'Transportation', amount: ops.transportation },
    ] },
    { group: 'Administrative', rows: [
      { label: 'Contracted Services', amount: ops.contracted },
      { label: 'Authorizer Fee', amount: ops.authorizerFee },
      { label: 'Marketing & Outreach', amount: ops.marketing },
      { label: 'Fundraising', amount: ops.fundraising },
    ] },
    { group: 'Other', rows: [
      { label: 'Misc/Contingency', amount: ops.contingency },
      ...(ops.customExpense ?? []).map((c) => ({ label: c.name, amount: c.amount })),
    ] },
  ]

  function buildOpsTable(): string {
    let html = ''
    for (const { group, rows } of opsGroups) {
      const groupRows = rows.filter((r) => r.amount)
      if (groupRows.length === 0) continue
      const groupTotal = groupRows.reduce((s, r) => s + r.amount, 0)
      html += `<tr class="group-header"><td colspan="3" style="background:#F1F5F9;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#475569;padding:8px 16px;">${esc(group)}</td></tr>`
      for (const row of groupRows) {
        html += `<tr><td style="padding:8px 16px;padding-left:28px;">${esc(row.label)}</td><td style="text-align:right;padding:8px 16px;">${fmtDollars(row.amount)}</td><td style="text-align:right;padding:8px 16px;color:#64748B;">${pct(row.amount, y1OperatingRevenue)}</td></tr>`
      }
      html += `<tr style="background:#F8FAFC;"><td style="padding:6px 16px;padding-left:28px;font-weight:600;font-size:11px;color:#475569;">Subtotal</td><td style="text-align:right;padding:6px 16px;font-weight:600;font-size:11px;color:#475569;">${fmtDollars(groupTotal)}</td><td style="text-align:right;padding:6px 16px;font-weight:600;font-size:11px;color:#475569;">${pct(groupTotal, y1OperatingRevenue)}</td></tr>`
    }
    return html
  }

  // Personnel health assessment — shared year-aware bands (healthThresholds.ts). The PDF
  // reports Year-1 figures, so WA schools are evaluated against the founding-year band.
  function personnelAssessment(): string {
    const label = personnelHealth.status === 'meets' ? 'Healthy range' : personnelHealth.short
    return `<span style="color:${healthColor(personnelHealth.status, 'hexFg')};font-weight:600;">${label}</span> — ${personnelHealth.long}`
  }

  // Sensitivity narrative (engine re-run at the reduced fill rate, expenses held at base)
  function sensitivityNarrative(s: EnrollmentSensitivity): string {
    if (s.netPosition >= 0) {
      return `Under conservative enrollment assumptions (${fillPct}% of target, ${s.enrollment} students), the school still projects a surplus of ${fmtDollars(s.netPosition)} with ${s.daysOfCash} reserve days. This indicates a financial model with meaningful margin for enrollment variability. The school could sustain below-target enrollment in Year 1 without requiring emergency budget adjustments.`
    }
    return `Under conservative enrollment assumptions (${fillPct}% of target, ${s.enrollment} students), the school projects a deficit of ${fmtDollars(Math.abs(s.netPosition))} with ${s.daysOfCash} reserve days. This indicates the financial model has limited margin for enrollment shortfalls. The school should prioritize student recruitment, maintain contingency plans for below-target enrollment, and identify specific expense reductions that could be triggered if enrollment falls below ${y1BreakEven} students.`
  }

  // Facility callout — shared facility band (healthThresholds.ts), % of operating revenue
  function facilityCallout(): string {
    const p = y1FacilityPct.toFixed(1)
    const st = facilityHealth.status
    const style = `background:${healthColor(st, 'hexBg')};border:1px solid ${healthColor(st, 'hexBorder')};border-radius:8px;padding:14px 18px;margin-top:16px;font-size:12px;color:${healthColor(st, 'hexFg')};`
    if (st === 'meets' || st === 'na') return `<div style="${style}"><strong>Facility costs represent ${p}% of operating revenue.</strong> This is within the healthy range. Industry standard: &le;${facilityMaxPct}% of revenue.</div>`
    if (st === 'approaching') return `<div style="${style}"><strong>Facility costs represent ${p}% of operating revenue.</strong> Approaching the ${facilityMaxPct}% threshold that lenders and authorizers monitor. Industry standard: &le;${facilityMaxPct}%.</div>`
    return `<div style="${style}"><strong>Warning: Facility costs represent ${p}% of operating revenue.</strong> This exceeds the ${facilityMaxPct}% threshold. Most lenders require facility costs below ${facilityMaxPct}% for financing.${isWaCharter ? ' The Charter Commission may flag this.' : ''}</div>`
  }

  // Scorecard page. WA sends the Commission FPF scorecard (per-year statuses, stage targets);
  // other pathways send the generic health scorecard (per-year value objects with a color).
  const scorecardMeasures = scorecard?.measures ?? []
  const fpfMeasures = scorecardMeasures.filter(isFpfMeasure)
  const genericMeasures = scorecardMeasures.filter((m): m is GenericHealthMeasure => !isFpfMeasure(m))
  const scorecardFooter = `<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>`

  function fpfScorecardHtml(measures: FPFMeasure[]): string {
    const firstStage2 = (year: number) => fpfStageForYear(year) === 2 && fpfStageForYear(year - 1) === 1
    return `
<!-- PAGE: Commission FPF Scorecard -->
<div class="page-break"></div>
<h2>Commission Financial Performance Framework</h2>
<p style="font-size:12px;color:#64748B;margin-bottom:16px;">Years 1-2 evaluated against Stage 1 thresholds (lenient). Years 3-5 evaluated against Stage 2 thresholds (strict).</p>

<table style="width:100%;border-collapse:collapse;font-size:11px;">
  <thead>
    <tr style="background:#F8FAFC;border-bottom:2px solid #E2E8F0;">
      <th style="text-align:left;padding:6px 8px;color:#64748B;">Measure</th>
      ${multiYear.map((r) => {
        const stage = fpfStageForYear(r.year)
        return `<th style="text-align:center;padding:6px 4px;color:#64748B;${stage === 2 ? 'background:#F1F5F9;' : ''}${firstStage2(r.year) ? 'border-left:2px solid #94A3B8;' : ''}">Y${r.year}<br><span style="font-size:9px;font-weight:normal;">Stage ${stage}</span></th>`
      }).join('')}
      <th style="text-align:center;padding:6px 4px;color:#64748B;font-size:10px;">S1 Target</th>
      <th style="text-align:center;padding:6px 4px;color:#64748B;font-size:10px;">S2 Target</th>
    </tr>
  </thead>
  <tbody>
    ${measures.filter(m => !m.note).map(m => `
    <tr style="border-bottom:1px solid #F1F5F9;">
      <td style="padding:6px 8px;color:#334155;font-weight:500;">${esc(m.name)}</td>
      ${m.values.map((v, i) => {
        const status = fromFpfStatus(m.statuses[i])
        const display = v === null || v === undefined ? 'N/A' : typeof v === 'number' ? (m.name.includes('Ratio') || m.name.includes('Asset') ? v.toFixed(2) : m.name.includes('Margin') ? `${v.toFixed(1)}%` : m.name.includes('Days') ? `${v}d` : m.name.includes('Variance') ? `${v}%` : m.name.includes('Cash Flow') || m.name.includes('Revenue') ? fmtCompact(v) : String(v)) : String(v)
        return `<td style="text-align:center;padding:6px 4px;background:${healthColor(status, 'hexBg')};color:${healthColor(status, 'hexFg')};font-weight:600;${firstStage2(i + 1) ? 'border-left:2px solid #94A3B8;' : ''}">${esc(display)}</td>`
      }).join('')}
      <td style="text-align:center;padding:6px 4px;font-size:10px;color:#64748B;">${esc(m.stage1Target)}</td>
      <td style="text-align:center;padding:6px 4px;font-size:10px;color:#64748B;">${esc(m.stage2Target)}</td>
    </tr>`).join('')}
  </tbody>
</table>

${scorecardFooter}
`
  }

  function genericScorecardHtml(measures: GenericHealthMeasure[]): string {
    return `
<!-- PAGE: Financial Health Scorecard -->
<div class="page-break"></div>
<h2>Financial Health Scorecard</h2>
<p style="font-size:12px;color:#64748B;margin-bottom:16px;">Each year is evaluated against the same financial health benchmarks (healthy, watch and concern ranges).</p>

<table style="width:100%;border-collapse:collapse;font-size:11px;">
  <thead>
    <tr style="background:#F8FAFC;border-bottom:2px solid #E2E8F0;">
      <th style="text-align:left;padding:6px 8px;color:#64748B;">Measure</th>
      ${multiYear.map((r) => `<th style="text-align:center;padding:6px 4px;color:#64748B;">Y${r.year}</th>`).join('')}
      <th style="text-align:center;padding:6px 4px;color:#64748B;font-size:10px;">Healthy</th>
      <th style="text-align:center;padding:6px 4px;color:#64748B;font-size:10px;">Watch</th>
      <th style="text-align:center;padding:6px 4px;color:#64748B;font-size:10px;">Concern</th>
    </tr>
  </thead>
  <tbody>
    ${measures.filter(m => m.applicable !== false).map(m => `
    <tr style="border-bottom:1px solid #F1F5F9;">
      <td style="padding:6px 8px;color:#334155;font-weight:500;">${esc(m.name)}</td>
      ${multiYear.map((r) => {
        const v = Array.isArray(m.values) ? m.values.find((x) => x && x.year === r.year) : undefined
        const status = fromGenericColor(v?.status)
        return `<td style="text-align:center;padding:6px 4px;background:${healthColor(status, 'hexBg')};color:${healthColor(status, 'hexFg')};font-weight:600;">${esc(v?.formatted ?? 'N/A')}</td>`
      }).join('')}
      <td style="text-align:center;padding:6px 4px;font-size:10px;color:#64748B;">${esc(m.healthy)}</td>
      <td style="text-align:center;padding:6px 4px;font-size:10px;color:#64748B;">${esc(m.watch)}</td>
      <td style="text-align:center;padding:6px 4px;font-size:10px;color:#64748B;">${esc(m.concern)}</td>
    </tr>`).join('')}
  </tbody>
</table>

${scorecardFooter}
`
  }

  function scorecardSection(): string {
    if (fpfMeasures.length > 0) return fpfScorecardHtml(fpfMeasures)
    if (genericMeasures.length > 0) return genericScorecardHtml(genericMeasures)
    return ''
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(schoolName)} — Financial Plan</title>
<style>
  @page { margin: 0.75in; size: letter; }
  @media print {
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
    body { font-size: 10.5pt; }
    table { page-break-inside: avoid; }
    .metric-cards { page-break-inside: avoid; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #1E293B;
    line-height: 1.6;
    background: #fff;
    padding: 0;
  }
  .container { max-width: 800px; margin: 0 auto; padding: 0 24px; }

  /* Print bar */
  .print-bar {
    position: sticky; top: 0; z-index: 100;
    background: #1B2A4A; color: #fff; padding: 12px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .print-bar button {
    background: #0F6E56; color: #fff; border: none; padding: 10px 24px;
    border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .print-bar button:hover { background: #0D5C48; }

  /* Cover */
  .cover {
    height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    page-break-after: always;
  }
  .cover h1 { font-size: 36px; color: #1B2A4A; margin-bottom: 8px; font-weight: 700; }
  .cover .subtitle { font-size: 20px; color: #475569; margin-bottom: 6px; }
  .cover .prepared { font-size: 14px; color: #64748B; margin-top: 32px; line-height: 1.8; }
  .cover .logo { margin-top: 60px; font-size: 14px; color: #94A3B8; letter-spacing: 2px; text-transform: uppercase; }

  /* Section headings */
  h2 {
    font-size: 22px; color: #1B2A4A; margin-bottom: 18px;
    padding-bottom: 8px; border-bottom: 3px solid #0F6E56;
  }
  h3 { font-size: 15px; color: #1B2A4A; margin: 20px 0 10px; }

  /* Metric cards */
  .metric-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
  .metric-card {
    border-radius: 10px; padding: 16px 18px; text-align: center;
    border: 1px solid #E2E8F0;
  }
  .metric-card .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 4px; }
  .metric-card .value { font-size: 24px; font-weight: 700; }
  .metric-card .sub { font-size: 11px; color: #64748B; margin-top: 2px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
  table th {
    background: #1B2A4A; color: #fff; font-weight: 600;
    padding: 10px 16px; text-align: left; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  table th:not(:first-child) { text-align: right; }
  table td { padding: 8px 16px; border-bottom: 1px solid #E2E8F0; }
  table tr:nth-child(even) { background: #F8FAFC; }
  table .total-row { background: #F1F5F9; font-weight: 700; }
  table .total-row td { border-top: 2px solid #CBD5E1; }

  /* Footer */
  .page-footer {
    margin-top: 40px; padding-top: 12px; border-top: 1px solid #E2E8F0;
    font-size: 10px; color: #94A3B8; text-align: center;
  }

  /* Narrative */
  .narrative { font-size: 13px; line-height: 1.7; color: #334155; margin-bottom: 24px; }
  .narrative p { margin-bottom: 12px; }

  /* Callout */
  .callout {
    background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px;
    padding: 14px 18px; font-size: 12px; color: #166534; margin: 16px 0;
  }
  .callout.warning { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
  .callout.caution { background: #FFFBEB; border-color: #FDE68A; color: #92400E; }

  /* Positive/negative */
  .positive { color: #0F6E56; }
  .negative { color: #D85A30; }
  .highlight-row { background: #FFFBEB !important; }
</style>
</head>
<body>

<!-- Print bar -->
<div class="print-bar no-print">
  <div>
    <strong>${esc(schoolName)}</strong> &mdash; Financial Plan Preview
  </div>
  <button onclick="window.print()">Print or Save as PDF</button>
</div>

<div class="container">

<!-- PAGE 1: Cover -->
<div class="cover">
  <h1>${esc(schoolName)}</h1>
  <div class="subtitle">Financial Plan &mdash; Year 1 through Year 5</div>
  <div class="subtitle" style="font-size:16px;color:#64748B;">${esc(profile.grade_config)} &bull; ${esc(profile.region || (isWaCharter ? 'Washington State' : ''))}</div>
  <div class="prepared">
    ${isWaCharter ? 'Prepared for the<br/><strong>Washington State Charter School Commission</strong>' : `<strong>${esc(schoolName)} Financial Plan</strong>`}<br/><br/>
    ${esc(dateStr)}
  </div>
  <div class="logo">SchoolLaunch</div>
</div>

<!-- PAGE 2: Executive Summary -->
<div class="page-break"></div>
<h2>Executive Summary</h2>

<div class="metric-cards">
  <div class="metric-card" style="background:${y1Net >= 0 ? '#ECFDF5' : '#FEF2F2'};">
    <div class="label">Year 1 Net Position</div>
    <div class="value" style="color:${y1Net >= 0 ? '#0F6E56' : '#D85A30'};">${fmtCompact(y1Net)}</div>
    <div class="sub">${y1Net >= 0 ? 'Surplus' : 'Deficit'}</div>
  </div>
  ${(() => {
    // Days of cash against the Year-1 band: WA Commission Stage 1; generic reserve benchmark.
    const dc = daysOfCashHealth(y1ReserveDays, 1)
    return `<div class="metric-card" style="background:${healthColor(dc.status, 'hexBg')};">
    <div class="label">Reserve Days</div>
    <div class="value" style="color:${healthColor(dc.status, 'hexFg')};">${y1ReserveDays}</div>
    <div class="sub">${dc.short} &bull; ${isWaCharter ? 'Stage 2' : 'Target'}: ${getDaysOfCashBand(3, hp).target}</div>
  </div>`
  })()}
  <div class="metric-card" style="background:${healthColor(personnelHealth.status, 'hexBg')};">
    <div class="label">Personnel % of Revenue</div>
    <div class="value" style="color:${healthColor(personnelHealth.status, 'hexFg')};">${y1PersonnelPct.toFixed(1)}%</div>
    <div class="sub">Target: ${isWaCharter ? getPersonnelHealthBand(1).label : personnelHealth.band.target}</div>
  </div>
  <div class="metric-card">
    <div class="label">Break-Even Enrollment</div>
    <div class="value" style="color:#1B2A4A;">${y1BreakEven}</div>
    <div class="sub">Target: ${enrollment} students</div>
  </div>
</div>

<div class="narrative">
  ${executiveSummary ? executiveSummary.split('\n\n').map((p: string) => `<p>${esc(p.trim())}</p>`).join('') : `<p>${esc(schoolName)} projects Year 1 revenue of ${fmtDollars(y1Revenue)} based on ${enrollment} enrolled students${isWaCharter ? ` at ${fmtDollars(assumptions.per_pupil_rate)} per-pupil state apportionment plus categorical grants` : ''}. Total Year 1 expenses are projected at ${fmtDollars(y1Expenses)}, resulting in a net position of ${fmtDollars(y1Net)} and ${y1ReserveDays} reserve days of operating cash.</p>${sensitivity ? `<p>Under a conservative enrollment scenario (${fillPct}% of target, ${sensitivity.enrollment} students), net position ${sensitivity.netPosition >= 0 ? 'remains positive at ' + fmtDollars(sensitivity.netPosition) : 'shifts to a deficit of ' + fmtDollars(Math.abs(sensitivity.netPosition))}, indicating ${sensitivity.netPosition >= 0 ? 'meaningful financial resilience' : 'limited margin for enrollment shortfalls'}.</p>` : ''}`}
</div>

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

<!-- PAGE 3: Revenue -->
<div class="page-break"></div>
<h2>Revenue Projections &mdash; Year 1</h2>

<table>
  <thead>
    <tr>
      <th>Revenue Source</th>
      <th>Formula</th>
      <th>Year 1 Amount</th>
    </tr>
  </thead>
  <tbody>
    ${revenueProjections.map((p) =>
      `<tr><td>${esc(p.subcategory)}</td><td style="text-align:right;font-size:11px;color:#64748B;">${esc(p.formula ?? revenueFormula(p.subcategory))}</td><td style="text-align:right;">${fmtDollars(p.amount)}</td></tr>`
    ).join('')}
    <tr class="total-row"><td>Total Revenue</td><td></td><td style="text-align:right;">${fmtDollars(y1Revenue)}</td></tr>
  </tbody>
</table>

<div style="margin:20px 0;">
  <div style="font-size:11px;font-weight:600;color:#475569;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Revenue Composition</div>
  <svg width="100%" viewBox="0 0 700 36" style="border-radius:6px;overflow:hidden;">
    ${barSvg}
  </svg>
  <div style="margin-top:8px;">${barLegend}</div>
</div>

${isWaCharter && regionFactor !== 1.0 ? `<div class="callout" style="margin-bottom:12px;">Per-pupil rates are adjusted by a regionalization factor of <strong>${esc(regionFactor)}</strong> (${esc(profile.region)}) reflecting the state&rsquo;s location-based funding adjustment per LEAP Document C3.</div>` : ''}
${!isWaCharter ? '' : profile.pct_frl > 40 ? `<div class="callout">Title I Schoolwide program eligible &mdash; FRL rate of ${esc(profile.pct_frl)}% exceeds the 40% federal threshold.</div>` : `<div class="callout caution">Title I Schoolwide program not eligible &mdash; FRL rate of ${esc(profile.pct_frl)}% is below the 40% federal threshold.</div>`}

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

<!-- PAGE 4: Personnel -->
<div class="page-break"></div>
<h2>Personnel Plan &mdash; Year 1</h2>

<table>
  <thead>
    <tr>
      <th>Position</th>
      <th>Category</th>
      <th>FTE</th>
      <th>Salary</th>
      <th>Benefits (${Number((benefitsRate * 100).toFixed(1))}%)</th>
      <th>Total Cost</th>
    </tr>
  </thead>
  <tbody>
    ${positions.map((p) => {
      const cost = p.fte * p.annual_salary
      const benefits = Math.round(cost * benefitsRate)
      return `<tr><td>${esc(p.title)}</td><td style="text-align:left;text-transform:capitalize;">${esc(p.category)}</td><td style="text-align:right;">${p.fte.toFixed(1)}</td><td style="text-align:right;">${fmtDollars(p.annual_salary)}</td><td style="text-align:right;">${fmtDollars(benefits)}</td><td style="text-align:right;">${fmtDollars(cost + benefits)}</td></tr>`
    }).join('')}
    <tr class="total-row"><td>Total</td><td></td><td style="text-align:right;">${totalFte.toFixed(1)} FTE</td><td></td><td></td><td style="text-align:right;">${fmtDollars(y1Personnel)}</td></tr>
  </tbody>
</table>

<div style="display:flex;gap:16px;margin:16px 0;">
  <div style="background:${healthColor(personnelHealth.status, 'hexBg')};border-radius:8px;padding:14px 20px;flex:1;">
    <div style="font-size:11px;color:#64748B;text-transform:uppercase;">Personnel % of Revenue</div>
    <div style="font-size:28px;font-weight:700;color:${healthColor(personnelHealth.status, 'hexFg')};">${y1PersonnelPct.toFixed(1)}%</div>
    <div style="font-size:11px;margin-top:4px;">${personnelAssessment()}</div>
  </div>
  <div style="background:#F8FAFC;border-radius:8px;padding:14px 20px;flex:1;border:1px solid #E2E8F0;">
    <div style="font-size:11px;color:#64748B;text-transform:uppercase;">Student-to-Teacher Ratio</div>
    <div style="font-size:28px;font-weight:700;color:#1B2A4A;">${studentTeacherRatio}:1</div>
    <div style="font-size:11px;color:#64748B;margin-top:4px;">${teacherCount} teachers for ${enrollment} students</div>
  </div>
</div>

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

<!-- PAGE 5: Operations -->
<div class="page-break"></div>
<h2>Operations Budget &mdash; Year 1</h2>

<table>
  <thead>
    <tr>
      <th>Category</th>
      <th>Amount</th>
      <th>% of Revenue</th>
    </tr>
  </thead>
  <tbody>
    ${buildOpsTable()}
    <tr class="total-row"><td>Total Operations</td><td style="text-align:right;">${fmtDollars(y1Operations)}</td><td style="text-align:right;">${pct(y1Operations, y1OperatingRevenue)}</td></tr>
  </tbody>
</table>

${facilityCallout()}

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

<!-- PAGE 6: Cash Flow -->
<div class="page-break"></div>
<h2>Month-by-Month Cash Flow Projection</h2>
<p style="font-size:12px;color:#64748B;margin-bottom:16px;">Year 1 (September through August) using the ${cashFlow.usesOspiSchedule ? 'OSPI apportionment payment schedule' : 'projected payment schedule'}. Starting balance from pre-opening funding.${cashFlow.totals.depreciationExcluded > 0 ? ` Non-cash facility depreciation (${fmtDollars(cashFlow.totals.depreciationExcluded)}) is excluded from monthly outflows.` : ''}</p>

<table>
  <thead>
    <tr>
      <th>Month</th>
      <th>${cashFlow.usesOspiSchedule ? 'Apport. %' : 'Scheduled %'}</th>
      <th>${cashFlow.usesOspiSchedule ? 'Apport. $' : 'Scheduled $'}</th>
      <th>Other Rev.</th>
      <th>Total In</th>
      <th>Payroll</th>
      <th>Other Exp.</th>
      <th>Net Cash</th>
      <th>Balance</th>
    </tr>
  </thead>
  <tbody>
    ${cashFlow.months.map((m) => {
      const isLowMonth = cashFlow.lowScheduleMonths.includes(m.month)
      const rowClass = isLowMonth ? ' class="highlight-row"' : ''
      const netColor = m.netCashFlow >= 0 ? '#0F6E56' : '#D85A30'
      const balColor = m.cumulativeBalance >= 0 ? '#1E293B' : '#D85A30'
      return `<tr${rowClass}><td style="font-weight:500;">${m.month}${isLowMonth ? ' *' : ''}</td><td style="text-align:right;color:#64748B;">${(m.apportionmentPct * 100).toFixed(1)}%</td><td style="text-align:right;">${fmtDollars(m.apportionmentAmt)}</td><td style="text-align:right;">${fmtDollars(m.otherRevenue)}</td><td style="text-align:right;font-weight:500;">${fmtDollars(m.totalInflow)}</td><td style="text-align:right;">${fmtDollars(m.payroll)}</td><td style="text-align:right;">${fmtDollars(m.otherExpenses)}</td><td style="text-align:right;font-weight:600;color:${netColor};">${fmtDollars(m.netCashFlow)}</td><td style="text-align:right;font-weight:700;color:${balColor};">${fmtDollars(m.cumulativeBalance)}</td></tr>`
    }).join('')}
  </tbody>
</table>

${cashFlow.lowScheduleMonths.length > 0
  ? `<div style="font-size:11px;color:#64748B;margin-top:8px;">* ${lowMonthNames} ${cashFlow.lowScheduleMonths.length > 1 ? 'are' : 'is a'} low ${cashFlow.usesOspiSchedule ? 'apportionment' : 'payment-schedule'} month${cashFlow.lowScheduleMonths.length > 1 ? 's' : ''} (${Number(lowMonthPct.toFixed(1))}%${cashFlow.lowScheduleMonths.length > 1 ? ' each' : ''}). Plan cash reserves accordingly.</div>`
  : ''}

${cashFlow.months.some((m) => m.cumulativeBalance < 0)
  ? `<div class="callout warning" style="margin-top:12px;"><strong>Warning:</strong> Cumulative cash balance goes negative during the year. A line of credit or additional pre-opening reserves may be required to cover shortfalls.</div>`
  : `<div class="callout" style="margin-top:12px;">Cash balance remains positive throughout the year. The school can meet all monthly obligations without a line of credit.</div>`
}

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

<!-- PAGE 7: Multi-Year -->
<div class="page-break"></div>
<h2>Multi-Year Financial Trajectory</h2>

<table>
  <thead>
    <tr>
      <th></th>
      ${multiYear.map((y) => `<th>Year ${y.year}<br/><span style="font-weight:400;font-size:10px;text-transform:none;">${y.enrollment} students</span></th>`).join('')}
    </tr>
  </thead>
  <tbody>
    <tr><td>Total Revenue</td>${multiYear.map((y) => `<td style="text-align:right;">${fmtDollars(y.revenue.total)}</td>`).join('')}</tr>
    <tr><td>Total Personnel</td>${multiYear.map((y) => `<td style="text-align:right;">${fmtDollars(y.personnel.total)}</td>`).join('')}</tr>
    <tr><td>Total Operations</td>${multiYear.map((y) => `<td style="text-align:right;">${fmtDollars(y.operations.total)}</td>`).join('')}</tr>
    <tr><td>Total Expenses</td>${multiYear.map((y) => `<td style="text-align:right;">${fmtDollars(y.totalExpenses)}</td>`).join('')}</tr>
    <tr class="total-row"><td>Net Position</td>${multiYear.map((y) => `<td style="text-align:right;color:${y.net >= 0 ? '#0F6E56' : '#D85A30'};">${fmtDollars(y.net)}</td>`).join('')}</tr>
    <tr><td>Ending Cash</td>${multiYear.map((y) => `<td style="text-align:right;font-weight:600;color:${y.endingCash >= 0 ? '#0F6E56' : '#D85A30'};">${fmtDollars(y.endingCash)}</td>`).join('')}</tr>
    <tr class="total-row"><td>Reserve Days</td>${multiYear.map((y) => `<td style="text-align:right;color:${healthColor(daysOfCashHealth(y.reserveDays, y.year).status, 'hexFg')};">${y.reserveDays}</td>`).join('')}</tr>
  </tbody>
</table>

<div style="margin:24px 0;">
  <div style="font-size:11px;font-weight:600;color:#475569;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Reserve Days Trajectory</div>
  <svg width="100%" viewBox="0 0 ${chartW} ${chartH}" style="background:#F8FAFC;border-radius:8px;border:1px solid #E2E8F0;">
    <!-- Zero line -->
    <line x1="50" y1="${yScale(0)}" x2="${chartW - 20}" y2="${yScale(0)}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4" />
    <text x="45" y="${yScale(0) + 4}" text-anchor="end" font-size="10" fill="#94A3B8">0</text>
    <!-- ${reserveFloorDays} day line (${isWaCharter ? 'Stage 1' : 'Minimum'}) -->
    <line x1="50" y1="${yScale(reserveFloorDays)}" x2="${chartW - 20}" y2="${yScale(reserveFloorDays)}" stroke="#FDE68A" stroke-width="1" stroke-dasharray="4,4" />
    <text x="45" y="${yScale(reserveFloorDays) + 4}" text-anchor="end" font-size="9" fill="#D97706">${reserveFloorDays}d</text>
    <!-- ${reserveTargetDays} day line (${isWaCharter ? 'Stage 2' : 'Target'}) -->
    <line x1="50" y1="${yScale(reserveTargetDays)}" x2="${chartW - 20}" y2="${yScale(reserveTargetDays)}" stroke="#A7F3D0" stroke-width="1" stroke-dasharray="4,4" />
    <text x="45" y="${yScale(reserveTargetDays) + 4}" text-anchor="end" font-size="9" fill="#6EE7B7">${reserveTargetDays}d</text>
    <!-- X axis labels -->
    ${multiYear.map((y, i) => `<text x="${50 + (i + 1) * xStep}" y="${chartH - 4}" text-anchor="middle" font-size="11" fill="#64748B">Y${y.year}</text>`).join('')}
    <!-- Line -->
    <polyline points="${linePoints}" fill="none" stroke="#1B2A4A" stroke-width="2.5" stroke-linejoin="round" />
    <!-- Dots -->
    ${dotsSvg}
  </svg>
</div>

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

${scorecardSection()}

<!-- PAGE 8: Startup Funding -->
<div class="page-break"></div>
<h2>Pre-Opening Budget &amp; Funding Sources</h2>

${fundingSources.length > 0 ? `
<table>
  <thead>
    <tr>
      <th>Funding Source</th>
      <th>Amount</th>
      <th style="text-align:left;">Type</th>
      <th style="text-align:left;">Status</th>
    </tr>
  </thead>
  <tbody>
    ${fundingSources.map((f) => {
      const statusColor = f.status === 'received' ? '#0F6E56' : f.status === 'pledged' ? '#1D4ED8' : f.status === 'applied' ? '#B45309' : '#64748B'
      return `<tr><td>${esc(f.source)}</td><td style="text-align:right;">${fmtDollars(f.amount)}</td><td style="text-align:left;text-transform:capitalize;">${esc(f.type)}</td><td style="text-align:left;"><span style="color:${statusColor};font-weight:600;text-transform:capitalize;">${esc(f.status)}</span></td></tr>`
    }).join('')}
    <tr class="total-row"><td>Total Startup Funding</td><td style="text-align:right;">${fmtDollars(totalFunding)}</td><td></td><td></td></tr>
  </tbody>
</table>

<div style="display:flex;gap:16px;margin:16px 0;">
  <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:12px 18px;flex:1;">
    <div style="font-size:11px;color:#065F46;text-transform:uppercase;font-weight:600;">Secured Funding</div>
    <div style="font-size:22px;font-weight:700;color:#0F6E56;">${fmtDollars(securedFunding)}</div>
    <div style="font-size:11px;color:#065F46;">Received + Pledged</div>
  </div>
  <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 18px;flex:1;">
    <div style="font-size:11px;color:#92400E;text-transform:uppercase;font-weight:600;">Pending / At Risk</div>
    <div style="font-size:22px;font-weight:700;color:#B45309;">${fmtDollars(totalFunding - securedFunding)}</div>
    <div style="font-size:11px;color:#92400E;">Applied + Projected</div>
  </div>
</div>

${securedFunding < totalFunding * 0.5 ? `<div class="callout warning"><strong>Funding Risk:</strong> Less than 50% of startup funding is secured. ${isWaCharter ? 'The Charter Commission typically expects committed funding sources before approving a charter application.' : 'Committed funding sources are typically expected before launch.'}</div>` : ''}
` : '<p style="color:#64748B;font-size:13px;">No startup funding sources have been configured. Add funding sources on the Multi-Year tab.</p>'}

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

<!-- PAGE 9: Sensitivity -->
<div class="page-break"></div>
<h2>Sensitivity Analysis &mdash; Conservative Enrollment</h2>
<p style="font-size:12px;color:#64748B;margin-bottom:16px;">Industry best practice: budget for revenue at ${fillPct}% of projected enrollment while maintaining 100% of planned expenses. ${isWaCharter ? `The WA Charter Commission uses Stage 1 thresholds (${getDaysOfCashBand(1, hp).target} cash) for Years 1-2 and Stage 2 thresholds (${getDaysOfCashBand(3, hp).target}) for Year 3+.` : `Financial health benchmarks recommend ${getDaysOfCashBand(1, hp).target} cash on hand; ${getDaysOfCashBand(1, hp).approachingRange} is a watch range and ${getDaysOfCashBand(1, hp).concern.toLowerCase()} is a concern.`}</p>

${sensitivity ? `
<table>
  <thead>
    <tr>
      <th>Metric</th>
      <th>Base Case (100%)</th>
      <th>Conservative (${fillPct}%)</th>
      <th>Delta</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Revenue Enrollment</td><td style="text-align:right;">${sensitivity.baseEnrollment}</td><td style="text-align:right;">${sensitivity.enrollment}</td><td style="text-align:right;color:#D85A30;">${sensitivity.enrollment - sensitivity.baseEnrollment}</td></tr>
    <tr><td>Total Revenue</td><td style="text-align:right;">${fmtDollars(sensitivity.baseTotalRevenue)}</td><td style="text-align:right;">${fmtDollars(sensitivity.totalRevenue)}</td><td style="text-align:right;color:#D85A30;">${fmtDollars(sensitivity.totalRevenue - sensitivity.baseTotalRevenue)}</td></tr>
    <tr><td>Total Expenses</td><td style="text-align:right;">${fmtDollars(sensitivity.totalExpenses)}</td><td style="text-align:right;">${fmtDollars(sensitivity.totalExpenses)}</td><td style="text-align:right;">${fmtDollars(0)}</td></tr>
    <tr class="total-row"><td>Net Position</td><td style="text-align:right;color:${sensitivity.baseNetPosition >= 0 ? '#0F6E56' : '#D85A30'};">${fmtDollars(sensitivity.baseNetPosition)}</td><td style="text-align:right;color:${sensitivity.netPosition >= 0 ? '#0F6E56' : '#D85A30'};">${fmtDollars(sensitivity.netPosition)}</td><td style="text-align:right;color:#D85A30;">${fmtDollars(sensitivity.netPosition - sensitivity.baseNetPosition)}</td></tr>
    <tr class="total-row"><td>Reserve Days</td><td style="text-align:right;color:${healthColor(daysOfCashHealth(sensitivity.baseDaysOfCash, 1).status, 'hexFg')};">${sensitivity.baseDaysOfCash}</td><td style="text-align:right;color:${healthColor(daysOfCashHealth(sensitivity.daysOfCash, 1).status, 'hexFg')};">${sensitivity.daysOfCash}</td><td style="text-align:right;color:#D85A30;">${sensitivity.daysOfCash - sensitivity.baseDaysOfCash}</td></tr>
  </tbody>
</table>

<div class="narrative" style="margin-top:20px;">
  <p>${sensitivityNarrative(sensitivity)}</p>
</div>
` : '<p style="color:#64748B;font-size:13px;">Enrollment sensitivity results were not included in this export.</p>'}

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

<!-- PAGE 10: Risk Factors -->
<div class="page-break"></div>
<h2>Key Financial Risks</h2>

<div class="narrative">
  ${riskAnalysis
    ? riskAnalysis.split('\n').filter((l: string) => l.trim()).map((l: string) => `<p>${escapeHtmlKeepStrong(l)}</p>`).join('')
    : `<p><strong>1. Enrollment Risk:</strong> The school's financial model is based on ${enrollment} enrolled students. Each student below target reduces revenue by approximately ${isWaCharter ? `${fmtDollars(assumptions.per_pupil_rate + assumptions.levy_equity_per_student)} in base funding` : `${fmtDollars(enrollment > 0 ? effectiveRegularEd / enrollment : 0)} in ${primaryRevenueLabel.toLowerCase()}`}. The break-even enrollment is ${y1BreakEven} students — a buffer of only ${enrollment - y1BreakEven} students. Mitigation: Invest in pre-opening student recruitment and maintain a waiting list.</p>
       <p><strong>2. Cash Flow Timing:</strong> ${cashFlow.usesOspiSchedule && cashFlow.lowScheduleMonths.length > 0 ? `OSPI apportionment follows an uneven monthly schedule, with ${lowMonthNames} at just ${Number(lowMonthPct.toFixed(1))}%.` : 'Revenue payments may follow an uneven monthly schedule.'} Schools with thin reserves risk cash shortfalls during low-revenue months. Mitigation: Maintain at minimum ${reserveFloorDays} days of operating reserves and consider establishing a line of credit.</p>
       <p><strong>3. Facility Cost Escalation:</strong> Facility costs at ${y1FacilityPct.toFixed(1)}% of operating revenue ${facilityHealth.status === 'approaching' || facilityHealth.status === 'fails' ? 'are already elevated' : 'are within healthy range but could increase'}. Lease renegotiations or unexpected maintenance could push this ratio higher. Mitigation: Negotiate multi-year lease terms with fixed escalation clauses.</p>
       <p><strong>4. Personnel Cost Growth:</strong> Personnel comprises ${y1PersonnelPct.toFixed(1)}% of operating revenue. As staff receive annual raises, this ratio increases unless offset by enrollment growth. Mitigation: Tie salary increases to enrollment milestones.</p>
       ${isWaCharter
         ? `<p><strong>5. Categorical Grant Uncertainty:</strong> Federal categorical grants (Title I, IDEA, etc.) are subject to annual appropriations and may fluctuate. These represent ${fmtDollars(y1OperatingRevenue - (effectiveRegularEd + spedApport + facilitiesRev + levyEquity))} or ${pct(y1OperatingRevenue - effectiveRegularEd - spedApport - facilitiesRev - levyEquity, y1OperatingRevenue)} of operating revenue. Mitigation: Do not rely on categorical grants for core staffing costs.</p>`
         : `<p><strong>5. Revenue Concentration:</strong> ${primaryRevenueLabel} provides ${pct(effectiveRegularEd, y1OperatingRevenue)} of operating revenue, so a rate change or enrollment shortfall flows directly to the bottom line. Mitigation: Build fundraising and other revenue sources and maintain healthy reserves.</p>`}`
  }
</div>

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>

${scenarios && scenarios.length > 0 ? `
<!-- PAGE: Scenario Analysis -->
<div class="page-break"></div>
<h2>Scenario Analysis</h2>
<p style="font-size:12px;color:#64748B;margin-bottom:16px;">Three scenarios modeled to stress-test financial assumptions against ${isWaCharter ? "the Commission's Financial Performance Framework" : 'financial health benchmarks'}.</p>

<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;">
  <thead>
    <tr style="background:#F8FAFC;border-bottom:2px solid #E2E8F0;">
      <th style="text-align:left;padding:8px 12px;color:#64748B;">Metric</th>
      ${scenarios.map(s => `<th style="text-align:right;padding:8px 12px;color:${s.name === 'Conservative' ? '#D97706' : s.name === 'Optimistic' ? '#059669' : '#2563EB'};">${esc(s.name)}</th>`).join('')}
    </tr>
  </thead>
  <tbody>
    ${['enrollment', 'total_revenue', 'total_expenses', 'net_position', 'reserve_days', 'personnel_pct'].map(metric => {
      const labels: Record<string, string> = { enrollment: 'Year 1 Enrollment', total_revenue: 'Total Revenue', total_expenses: 'Total Expenses', net_position: 'Net Position', reserve_days: 'Reserve Days', personnel_pct: 'Personnel %' }
      return `<tr style="border-bottom:1px solid #F1F5F9;">
        <td style="padding:6px 12px;color:#475569;">${labels[metric]}</td>
        ${scenarios.map(s => {
          const y1 = s.results?.years?.['1']
          const val = y1 ? (y1 as unknown as Record<string, number>)[metric] : 0
          const formatted = metric === 'personnel_pct' ? `${val?.toFixed(1)}%` : metric === 'reserve_days' ? `${val} days` : metric === 'enrollment' ? String(val) : `$${(val || 0).toLocaleString()}`
          return `<td style="padding:6px 12px;text-align:right;font-weight:500;">${esc(formatted)}</td>`
        }).join('')}
      </tr>`
    }).join('')}
    <tr style="border-top:2px solid #E2E8F0;font-weight:700;">
      <td style="padding:8px 12px;color:#1E293B;">${isWaCharter ? 'FPF Compliance' : 'Health Score'} (Y1)</td>
      ${scenarios.map(s => {
        const y1 = s.results?.years?.['1']
        const passing = [y1?.fpf_current_ratio, y1?.fpf_days_cash, y1?.fpf_total_margin, y1?.fpf_enrollment_variance].filter(v => { const st = fromFpfStatus(v); return st === 'meets' || st === 'approaching' }).length
        return `<td style="padding:8px 12px;text-align:right;">${passing}/4 pass</td>`
      }).join('')}
    </tr>
  </tbody>
</table>

${(scenarios.find(s => s.ai_analysis)?.ai_analysis) ? `
<div style="background:#F8FAFC;border-radius:8px;padding:16px;margin-top:12px;">
  <div style="font-size:11px;color:#64748B;text-transform:uppercase;font-weight:600;margin-bottom:8px;">AI Cross-Scenario Analysis</div>
  <div style="font-size:12px;color:#334155;line-height:1.7;white-space:pre-wrap;">${esc(scenarios.find(s => s.ai_analysis)?.ai_analysis)}</div>
</div>
` : ''}

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>
` : ''}

${advisory ? `
<!-- PAGE 11: Advisory Panel -->
<div class="page-break"></div>
<h2>Multi-Expert Financial Review</h2>
<p style="font-size:12px;color:#64748B;margin-bottom:20px;">SchoolLaunch's advisory system evaluates your financial plan from seven expert perspectives critical to ${isWaCharter ? 'charter school success in Washington State' : 'school financial health'}.</p>

${advisory.agents.map((agent) => {
  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    strong: { bg: '#ECFDF5', text: '#065F46', border: '#A7F3D0' },
    needs_attention: { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' },
    risk: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  }
  const statusLabels: Record<string, string> = { strong: 'Strong', needs_attention: 'Needs Attention', risk: 'Risk' }
  const sc = statusColors[agent.status] || statusColors.needs_attention
  return `
  <div style="border:1px solid ${sc.border};border-left:4px solid ${sc.border};border-radius:8px;padding:16px;margin-bottom:12px;background:${sc.bg};">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div>
        <strong style="font-size:13px;color:#1E293B;">${esc(agent.name)}</strong>
        <span style="font-size:11px;color:#64748B;margin-left:8px;">${esc(agent.subtitle)}</span>
      </div>
      <span style="font-size:11px;font-weight:600;color:${sc.text};background:white;padding:3px 10px;border-radius:12px;border:1px solid ${sc.border};">${statusLabels[agent.status] || 'Needs Attention'}</span>
    </div>
    <p style="font-size:12px;color:#334155;margin:0 0 8px 0;line-height:1.6;">${esc(agent.summary)}</p>
    ${agent.actions.length > 0 ? `<div style="font-size:11px;color:#475569;">${agent.actions.map((a) => `<div style="margin-top:4px;">&rarr; ${esc(a)}</div>`).join('')}</div>` : ''}
  </div>`
}).join('')}

<div class="page-footer">SchoolLaunch Financial Plan &bull; ${esc(schoolName)} &bull; Generated ${esc(dateStr)}</div>
` : ''}

</div><!-- end container -->
</body>
</html>`

  return html
}
