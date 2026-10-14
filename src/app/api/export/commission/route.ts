import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { authenticateRequest } from '@/lib/apiAuth'
import {
  beginningCashOf,
  benefitsPctFor,
  computeMonthlyCashFlow,
  MONTHS,
  personnelPctOfRevenue,
  totalMarginPct,
} from '@/lib/budgetEngine'
import { fpfStageForYear } from '@/lib/healthThresholds'
import { scenarioStatusKeys } from '@/lib/scenarioEngine'

interface MultiYearRow {
  year: number
  enrollment: number
  aafte: number
  revenue: {
    regularEd: number
    sped: number
    stateSped: number
    facilitiesRev: number
    levyEquity: number
    titleI: number
    idea: number
    lap: number
    lapHighPoverty: number
    tbip: number
    hicap: number
    foodServiceRev: number
    transportationRev: number
    smallSchoolEnhancement: number
    interestIncome: number
    grantRevenue: number
    operatingRevenue: number
    total: number
    apportionment: number
    customRevenue?: { id: string; name: string; group: string; amount: number; recurring?: boolean }[]
  }
  personnel: {
    certificated: number
    classified: number
    admin: number
    benefits: number
    total: number
    totalSalaries: number
  }
  operations: {
    facilities: number
    supplies: number
    contracted: number
    technology: number
    authorizerFee: number
    insurance: number
    foodService: number
    transportation: number
    curriculum: number
    profDev: number
    marketing: number
    fundraising: number
    contingency: number
    total: number
    customExpense?: { id: string; name: string; group: string; amount: number }[]
    depreciation?: number
    interest?: number
  }
  totalExpenses: number
  net: number
  cumulativeNet: number
  /** Year-end cash (cumulativeNet + cumulative non-cash depreciation; equals FPF cash). */
  endingCash: number
  reserveDays: number
  staffing: {
    teachers: number
    paras: number
    officeStaff: number
    otherStaff: number
    totalPositions: number
    totalPersonnelCost: number
    totalSalaries: number
    totalBenefits: number
  }
  expansionDetail?: {
    grades: string[]
    newGrades: string[]
  }
}

interface Position {
  title: string
  category: string
  fte: number
  annual_salary: number
  position_type?: string
  classification?: string
  driver?: string
  benchmark_salary?: number
}

interface FPFMeasure {
  name: string
  values: (number | null)[]
  stage1Target: string
  stage2Target: string
  statuses: string[]
}

/** Generic-pathway health measure (computeGenericHealthScorecard): values are objects. */
interface GenericHealthMeasure {
  name: string
  values: { year: number; value: number; formatted: string; status: string }[]
  healthy: string
  watch: string
  concern: string
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    schoolName,
    profile,
    assumptions,
    positions,
    multiYear,
    scorecard,
    startingCash,
    pathway,
    schoolId,
  } = body as {
    schoolName: string
    profile: { pct_frl: number; pct_iep: number; pct_ell: number; grade_config: string; fiscal_year_start_month?: number | null }
    assumptions: { benefits_load_pct: number; aafte_pct: number }
    positions: Position[]
    multiYear: MultiYearRow[]
    // WA charter: the FPF scorecard; other pathways: the generic health scorecard.
    scorecard: { measures: (FPFMeasure | GenericHealthMeasure)[] }
    startingCash: number
    scenarios?: { name: string; assumptions: Record<string, number>; results: { years: Record<string, Record<string, number | string>> } | null }[]
    pathway?: string
    schoolId?: string
  }

  const auth = await authenticateRequest(request, { schoolId })
  if (auth instanceof NextResponse) return auth

  const isWaCharter = !pathway || pathway === 'wa_charter'
  // The load the pathway's engine applied to row.personnel.benefits (WA: Settings; others: pathway).
  const benefitsPct = benefitsPctFor(pathway, assumptions)

  const wb = XLSX.utils.book_new()
  const yearHeaders = ['Year 0', ...multiYear.map((r) => `Year ${r.year}`)]

  // --- Tab 1: ENROLLMENT ---
  const enrollRows: (string | number)[][] = [
    ['', ...yearHeaders],
  ]

  // If we have expansion detail with grades, show per-grade rows
  const allGrades = new Set<string>()
  for (const row of multiYear) {
    if (row.expansionDetail?.grades) {
      row.expansionDetail.grades.forEach((g) => allGrades.add(g))
    }
  }
  const sortedGrades = Array.from(allGrades).sort((a, b) => {
    const order = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
    return order.indexOf(a) - order.indexOf(b)
  })

  if (sortedGrades.length > 0) {
    for (const grade of sortedGrades) {
      const row: (string | number)[] = [`Grade ${grade}`, 0]
      for (const yr of multiYear) {
        const hasGrade = yr.expansionDetail?.grades?.includes(grade)
        row.push(hasGrade ? Math.round(yr.enrollment / (yr.expansionDetail?.grades?.length || 1)) : 0)
      }
      enrollRows.push(row)
    }
  }

  enrollRows.push(['Total Enrollment', 0, ...multiYear.map((r) => r.enrollment)])
  enrollRows.push(['AAFTE', 0, ...multiYear.map((r) => r.aafte)])
  enrollRows.push([])
  if (isWaCharter) {
    enrollRows.push([`Note: AAFTE = ${assumptions.aafte_pct}% of headcount enrollment (adjustable in Settings). State apportionment revenue is calculated on AAFTE, not headcount.`])
  }
  enrollRows.push([])
  enrollRows.push(['Student Needs Populations'])
  enrollRows.push(['SPED Enrollment', 0, ...multiYear.map((r) => Math.round(r.enrollment * profile.pct_iep / 100))])
  enrollRows.push(['FRPL Enrollment', 0, ...multiYear.map((r) => Math.round(r.enrollment * profile.pct_frl / 100))])
  enrollRows.push(['EL Enrollment', 0, ...multiYear.map((r) => Math.round(r.enrollment * profile.pct_ell / 100))])

  const enrollSheet = XLSX.utils.aoa_to_sheet(enrollRows)
  XLSX.utils.book_append_sheet(wb, enrollSheet, 'ENROLLMENT')

  // --- Tab 2: REVENUE ---
  const revRows: (string | number)[][] = [
    ['#', 'Source', 'Description', 'Driver', ...yearHeaders],
    ['1.0', 'State & Local', 'Regular Ed Per Pupil', 'Per Pupil (AAFTE)', 0, ...multiYear.map((r) => r.revenue.regularEd)],
    ['2.0', 'State & Local', 'SPED Apportionment', 'Per Pupil-SPED', 0, ...multiYear.map((r) => r.revenue.sped)],
    ['3.0', 'State & Local', 'State Special Education', 'Per Pupil-SPED', 0, ...multiYear.map((r) => r.revenue.stateSped)],
    ['4.0', 'State & Local', 'Facilities Per Pupil', 'Per Pupil', 0, ...multiYear.map((r) => r.revenue.facilitiesRev)],
    ['5.0', 'State & Local', 'Levy Equity', 'Per Pupil (AAFTE)', 0, ...multiYear.map((r) => r.revenue.levyEquity)],
    ['5.1', 'State & Local', 'Small School Enhancement', 'Grade Band AAFTE', 0, ...multiYear.map((r) => r.revenue.smallSchoolEnhancement)],
    ['6.0', 'Federal', 'Title I', 'Per Pupil-FRL', 0, ...multiYear.map((r) => r.revenue.titleI)],
    ['7.0', 'Federal', 'IDEA (Federal Special Ed)', 'Per Pupil-IEP', 0, ...multiYear.map((r) => r.revenue.idea)],
    ['8.0', 'State Categorical', 'LAP (Learning Assistance)', 'Per Pupil-FRL', 0, ...multiYear.map((r) => r.revenue.lap)],
    ['8.1', 'State Categorical', 'LAP High Poverty', 'Per Pupil', 0, ...multiYear.map((r) => r.revenue.lapHighPoverty)],
    ['9.0', 'State Categorical', 'TBIP (Bilingual)', 'Per Pupil-ELL', 0, ...multiYear.map((r) => r.revenue.tbip)],
    ['10.0', 'State Categorical', 'Highly Capable', 'Per Pupil-HiCap', 0, ...multiYear.map((r) => r.revenue.hicap)],
    ['11.0', 'Program Revenue', 'Food Service (NSLP)', 'Per Pupil', 0, ...multiYear.map((r) => r.revenue.foodServiceRev)],
    ['11.1', 'Program Revenue', 'Transportation (State)', 'Per Pupil', 0, ...multiYear.map((r) => r.revenue.transportationRev)],
    ['12.0', 'Other', 'Interest & Other Income', 'Cash Balance', 0, ...multiYear.map((r) => r.revenue.interestIncome)],
  ]

  // R-REV-03: itemized custom revenue lines, threaded as rows under their group.
  // Pure reader - amounts come from the engine's row.revenue.customRevenue.
  // One-time lines are labeled in the Driver column: they are non-operating and land in
  // September on the CASH FLOW tab.
  const customRevIds: string[] = []
  const customRevMeta = new Map<string, { name: string; group: string; oneTime: boolean }>()
  for (const r of multiYear) {
    for (const c of (r.revenue.customRevenue || [])) {
      if (!customRevMeta.has(c.id)) { customRevIds.push(c.id); customRevMeta.set(c.id, { name: c.name, group: c.group, oneTime: c.recurring === false }) }
    }
  }
  customRevIds.forEach((id, i) => {
    const meta = customRevMeta.get(id)!
    revRows.push([
      `13.${i + 1}`,
      meta.group || 'Custom Revenue',
      meta.name,
      meta.oneTime ? 'Custom (one-time)' : 'Custom',
      0,
      ...multiYear.map((r) => (r.revenue.customRevenue || []).find((c) => c.id === id)?.amount ?? 0),
    ])
  })

  revRows.push([])
  revRows.push(['', '', 'Total Revenue', '', 0, ...multiYear.map((r) => r.revenue.total)])

  const revSheet = XLSX.utils.aoa_to_sheet(revRows)
  XLSX.utils.book_append_sheet(wb, revSheet, 'REVENUE')

  // --- Tab 3: STAFFING ---
  const staffRows: (string | number | string)[][] = [
    ['#', 'Classification', 'Position', 'Driver', 'FTE Y1', 'Salary Y1'],
  ]
  positions.forEach((p: Position, idx: number) => {
    staffRows.push([
      idx + 1,
      p.classification || p.category,
      p.title,
      p.driver || 'fixed',
      p.fte,
      p.annual_salary,
    ])
  })
  staffRows.push([])
  staffRows.push(['Total FTE', '', '', '', positions.reduce((s: number, p: Position) => s + p.fte, 0)])
  staffRows.push([])
  staffRows.push(['Personnel Summary', ...yearHeaders])
  staffRows.push(['Total Salaries', 0, ...multiYear.map((r) => r.personnel.totalSalaries)])
  staffRows.push([`Benefits (${benefitsPct}%)`, 0, ...multiYear.map((r) => r.personnel.benefits)])
  staffRows.push(['Total Compensation', 0, ...multiYear.map((r) => r.personnel.total)])

  const staffSheet = XLSX.utils.aoa_to_sheet(staffRows)
  XLSX.utils.book_append_sheet(wb, staffSheet, 'STAFFING')

  // --- Tab 4: P&L ---
  const plRows: (string | number)[][] = [
    ['Income Statement', ...yearHeaders],
    [],
    ['REVENUE'],
    ['Regular Ed Apportionment', 0, ...multiYear.map((r) => r.revenue.regularEd)],
    ['SPED Apportionment', 0, ...multiYear.map((r) => r.revenue.sped)],
    ['State Special Education', 0, ...multiYear.map((r) => r.revenue.stateSped)],
    ['Facilities Revenue', 0, ...multiYear.map((r) => r.revenue.facilitiesRev)],
    ['Levy Equity', 0, ...multiYear.map((r) => r.revenue.levyEquity)],
    ['Small School Enhancement', 0, ...multiYear.map((r) => r.revenue.smallSchoolEnhancement)],
    ['Title I', 0, ...multiYear.map((r) => r.revenue.titleI)],
    ['IDEA (Federal Special Ed)', 0, ...multiYear.map((r) => r.revenue.idea)],
    ['LAP', 0, ...multiYear.map((r) => r.revenue.lap)],
    ['LAP High Poverty', 0, ...multiYear.map((r) => r.revenue.lapHighPoverty)],
    ['TBIP', 0, ...multiYear.map((r) => r.revenue.tbip)],
    ['HiCap', 0, ...multiYear.map((r) => r.revenue.hicap)],
    ['Food Service (NSLP)', 0, ...multiYear.map((r) => r.revenue.foodServiceRev)],
    ['Transportation (State)', 0, ...multiYear.map((r) => r.revenue.transportationRev)],
    ['Interest & Other Income', 0, ...multiYear.map((r) => r.revenue.interestIncome)],
    ['Total Revenue', 0, ...multiYear.map((r) => r.revenue.total)],
    [],
    ['PERSONNEL'],
    ['Certificated Staff', 0, ...multiYear.map((r) => r.personnel.certificated)],
    ['Classified Staff', 0, ...multiYear.map((r) => r.personnel.classified)],
    ['Administrative Staff', 0, ...multiYear.map((r) => r.personnel.admin)],
    ['Total Salaries', 0, ...multiYear.map((r) => r.personnel.totalSalaries)],
    [`Taxes & Benefits (${benefitsPct}%)`, 0, ...multiYear.map((r) => r.personnel.benefits)],
    ['Total Personnel', 0, ...multiYear.map((r) => r.personnel.total)],
    [],
    ['NON-PERSONNEL EXPENSES'],
    ['Facilities', 0, ...multiYear.map((r) => r.operations.facilities)],
    ['Supplies & Materials', 0, ...multiYear.map((r) => r.operations.supplies)],
    ['Contracted Services', 0, ...multiYear.map((r) => r.operations.contracted)],
    ['Technology', 0, ...multiYear.map((r) => r.operations.technology)],
    ['Authorizer Fee', 0, ...multiYear.map((r) => r.operations.authorizerFee)],
    ['Insurance', 0, ...multiYear.map((r) => r.operations.insurance)],
    ['Food Service', 0, ...multiYear.map((r) => r.operations.foodService)],
    ['Transportation', 0, ...multiYear.map((r) => r.operations.transportation)],
    ['Curriculum & Materials', 0, ...multiYear.map((r) => r.operations.curriculum)],
    ['Professional Development', 0, ...multiYear.map((r) => r.operations.profDev)],
    ['Marketing & Outreach', 0, ...multiYear.map((r) => r.operations.marketing)],
    ['Fundraising', 0, ...multiYear.map((r) => r.operations.fundraising)],
    ['Contingency', 0, ...multiYear.map((r) => r.operations.contingency)],
    ['Total Non-Personnel', 0, ...multiYear.map((r) => r.operations.total)],
    [],
    ['Total Expenses', 0, ...multiYear.map((r) => r.totalExpenses)],
    ['Net Income / Change in Net Assets', 0, ...multiYear.map((r) => r.net)],
    ['Cumulative Net Position', 0, ...multiYear.map((r) => r.cumulativeNet)],
    [],
    ['KEY METRICS'],
    ['Personnel % of Revenue', '', ...multiYear.map((r) => `${personnelPctOfRevenue(r).toFixed(1)}%`)],
    [isWaCharter ? 'Total Margin (Operating)' : 'Total Margin', '', ...multiYear.map((r) => `${totalMarginPct(r, pathway).toFixed(1)}%`)],
    ['Days of Cash on Hand', '', ...multiYear.map((r) => r.reserveDays)],
  ]

  // R-REV-07: itemized custom expense rows, inserted under their group before the
  // Total Non-Personnel subtotal. Pure reader of row.operations.customExpense.
  const customExpIds: string[] = []
  const customExpMeta = new Map<string, { name: string; group: string }>()
  for (const r of multiYear) {
    for (const c of (r.operations.customExpense || [])) {
      if (!customExpMeta.has(c.id)) { customExpIds.push(c.id); customExpMeta.set(c.id, { name: c.name, group: c.group }) }
    }
  }
  if (customExpIds.length > 0) {
    const tnpIdx = plRows.findIndex((row) => row[0] === 'Total Non-Personnel')
    const insertAt = tnpIdx >= 0 ? tnpIdx : plRows.length
    const expRows = customExpIds.map((id) => {
      const meta = customExpMeta.get(id)!
      return [`${meta.group}: ${meta.name}`, 0, ...multiYear.map((r) => (r.operations.customExpense || []).find((c) => c.id === id)?.amount ?? 0)]
    })
    plRows.splice(insertAt, 0, ...expRows)
  }

  // P-FIN-01/02: facility depreciation + interest rows, inserted before Total Non-Personnel
  // when the school has financing. Pure reader of row.operations.depreciation/.interest;
  // omitted entirely for lease schools (byte-identical export).
  const hasDepreciation = multiYear.some((r) => (r.operations.depreciation ?? 0) !== 0)
  const hasInterest = multiYear.some((r) => (r.operations.interest ?? 0) !== 0)
  if (hasDepreciation || hasInterest) {
    const finIdx = plRows.findIndex((row) => row[0] === 'Total Non-Personnel')
    const finInsertAt = finIdx >= 0 ? finIdx : plRows.length
    const finRows: (string | number)[][] = []
    if (hasDepreciation) finRows.push(['Facility Depreciation', 0, ...multiYear.map((r) => r.operations.depreciation ?? 0)])
    if (hasInterest) finRows.push(['Facility Interest', 0, ...multiYear.map((r) => r.operations.interest ?? 0)])
    plRows.splice(finInsertAt, 0, ...finRows)
  }

  const plSheet = XLSX.utils.aoa_to_sheet(plRows)
  XLSX.utils.book_append_sheet(wb, plSheet, 'P&L')

  // --- Tab 5: CASH FLOW (Monthly Year 1) ---
  // One monthly model for every surface (Cash Flow tab, narrative PDF, admin portfolio):
  // per-revenue-type timing, outflows exclude non-cash depreciation, so August Ending Cash
  // reconciles with the annual Year 1 Ending Cash below (within a few dollars of rounding).
  const monthly = multiYear[0] ? computeMonthlyCashFlow(multiYear[0], startingCash, { pathway, fiscalYearStartMonth: profile.fiscal_year_start_month }) : null

  const depreciationExcluded = monthly?.totals.depreciationExcluded ?? 0
  const cfRows: (string | number | null)[][] = [
    [isWaCharter ? 'Monthly Cash Flow — Year 1 (per-revenue-type distribution)' : 'Monthly Cash Flow — Year 1'],
    depreciationExcluded > 0
      ? [`Expenses are cash outflows: non-cash facility depreciation ($${depreciationExcluded.toLocaleString('en-US')} in Year 1) is excluded.`]
      : [],
    ['Month', ...(monthly ? monthly.months.map((m) => m.month) : MONTHS)],
  ]

  const beginRow: (string | number)[] = ['Beginning Cash']
  const revRow: (string | number)[] = ['Revenue']
  const expRow: (string | number)[] = ['Expenses']
  const netRow: (string | number)[] = ['Net Monthly']
  const endRow: (string | number)[] = ['Ending Cash']

  for (const m of monthly?.months ?? []) {
    beginRow.push(Math.round(m.beginningBalance))
    revRow.push(m.totalInflow)
    expRow.push(m.payroll + m.otherExpenses)
    netRow.push(m.netCashFlow)
    endRow.push(Math.round(m.cumulativeBalance))
  }
  cfRows.push(beginRow, revRow, expRow, netRow, endRow)
  cfRows.push([])

  // Annual summary (Years 0-5). Ending Cash is the engine's year-end cash (cumulative net plus
  // the non-cash depreciation add-back), the figure Days of Cash is computed from.
  const hasDepreciationAddBack = multiYear.some((r) => (r.operations.depreciation ?? 0) !== 0)
  cfRows.push(['Annual Cash Flow Summary', ...yearHeaders])
  cfRows.push(['Beginning Cash', startingCash, ...multiYear.map((r) => beginningCashOf(r))])
  cfRows.push(['Total Revenue', 0, ...multiYear.map((r) => r.revenue.total)])
  cfRows.push(['Total Expenses', 0, ...multiYear.map((r) => r.totalExpenses)])
  if (hasDepreciationAddBack) {
    cfRows.push(['Depreciation add-back (non-cash)', 0, ...multiYear.map((r) => r.operations.depreciation ?? 0)])
  }
  cfRows.push(['Net Cash Flow', 0, ...multiYear.map((r) => r.net + (r.operations.depreciation ?? 0))])
  cfRows.push(['Ending Cash', startingCash, ...multiYear.map((r) => r.endingCash)])
  cfRows.push(['Days of Cash', '', ...multiYear.map((r) => r.reserveDays)])

  const cfSheet = XLSX.utils.aoa_to_sheet(cfRows)
  XLSX.utils.book_append_sheet(wb, cfSheet, 'CASH FLOW')

  // --- Tab 6: DASHBOARD (WA: FPF Scorecard; other pathways: generic health scorecard) ---
  const dashRows: (string | number | null)[][] = isWaCharter
    ? [
        ['Commission Financial Performance Framework Scorecard'],
        [],
        ['Measure', 'Formula', ...multiYear.map((r) => `Year ${r.year}`), 'Stage 1 Target', 'Stage 2 Target'],
      ]
    : [
        ['Financial Health Scorecard'],
        [],
        ['Measure', ...multiYear.map((r) => `Year ${r.year}`), 'Healthy', 'Watch', 'Concern'],
      ]
  for (const m of scorecard?.measures ?? []) {
    if ('statuses' in m && Array.isArray(m.statuses)) {
      dashRows.push([
        m.name,
        '',
        ...m.values.map((v: number | null) => v === null ? 'N/A' : v),
        m.stage1Target,
        m.stage2Target,
      ])
    } else {
      const g = m as GenericHealthMeasure
      dashRows.push([
        g.name,
        ...g.values.map((v) => v.formatted),
        g.healthy,
        g.watch,
        g.concern,
      ])
    }
  }

  const dashSheet = XLSX.utils.aoa_to_sheet(dashRows)
  XLSX.utils.book_append_sheet(wb, dashSheet, 'DASHBOARD')

  // --- Tab 7: SCENARIOS (if seeded) ---
  const { scenarios } = body as { scenarios?: { name: string; assumptions: Record<string, number>; results: { years: Record<string, Record<string, number | string>> } | null }[] }
  if (scenarios && scenarios.length > 0) {
    const scenRows: (string | number)[][] = [
      ['SCENARIO ASSUMPTIONS', ...scenarios.map(s => s.name)],
      ['Enrollment Fill Rate', ...scenarios.map(s => `${Math.round((s.assumptions.enrollment_fill_rate || 0) * 100)}%`)],
      ['Per-Pupil Funding Adj', ...scenarios.map(s => `${((s.assumptions.per_pupil_funding_adjustment || 0) * 100).toFixed(0)}%`)],
      ['Personnel Cost Adj', ...scenarios.map(s => `${((s.assumptions.personnel_cost_adjustment || 0) * 100).toFixed(0)}%`)],
      ['Monthly Facility Cost', ...scenarios.map(s => s.assumptions.facility_cost_monthly || 0)],
      ['Startup Capital', ...scenarios.map(s => s.assumptions.startup_capital || 0)],
      [],
      ['5-YEAR PROJECTIONS'],
    ]

    const metrics = ['enrollment', 'total_revenue', 'total_expenses', 'net_position', 'reserve_days', 'personnel_pct']
    const metricLabels: Record<string, string> = { enrollment: 'Enrollment', total_revenue: 'Total Revenue', total_expenses: 'Total Expenses', net_position: 'Net Position', reserve_days: 'Reserve Days', personnel_pct: 'Personnel %' }

    for (let y = 1; y <= 5; y++) {
      scenRows.push([`Year ${y}`, ...scenarios.map(s => s.name)])
      for (const m of metrics) {
        scenRows.push([metricLabels[m], ...scenarios.map(s => {
          const val = s.results?.years?.[String(y)]?.[m]
          return val !== undefined ? (typeof val === 'number' ? val : String(val)) : ''
        })])
      }
      scenRows.push([])
    }

    // WA: Commission FPF statuses by stage. Other pathways: the generic health benchmarks the
    // scenario engine stores in the same fields (no stages, no Enrollment Variance).
    scenRows.push([isWaCharter ? 'FPF COMPLIANCE (5-Year)' : 'FINANCIAL HEALTH BENCHMARKS (5-Year)', ...scenarios.map(s => s.name)])
    if (isWaCharter) scenRows.push(['', ...scenarios.map(() => 'Years 1-2: Stage 1 | Years 3-5: Stage 2')])
    for (let y = 1; y <= 5; y++) {
      scenRows.push([isWaCharter ? `Year ${y} (Stage ${fpfStageForYear(y)})` : `Year ${y}`, ...scenarios.map(s => s.name)])
      for (const fpf of scenarioStatusKeys(pathway)) {
        const label = fpf.replace('fpf_', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        scenRows.push([label, ...scenarios.map(s => String(s.results?.years?.[String(y)]?.[fpf] || 'N/A'))])
      }
    }

    const scenSheet = XLSX.utils.aoa_to_sheet(scenRows)
    XLSX.utils.book_append_sheet(wb, scenSheet, 'SCENARIOS')
  }

  // Generate Excel buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${schoolName.replace(/[^a-zA-Z0-9]/g, '_')}_${isWaCharter ? 'Commission_Template' : 'Financial_Plan'}.xlsx"`,
    },
  })
}
