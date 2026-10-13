import type { Step } from 'react-joyride'
import type { UserRole, TourName } from '@/hooks/useTour'
import { getDaysOfCashBand, getPersonnelHealthBand } from '@/lib/healthThresholds'

// Threshold numbers in tour copy come from the shared bands (R-HEALTH-01).
const PERSONNEL_Y1 = getPersonnelHealthBand(1)
const PERSONNEL_Y2 = getPersonnelHealthBand(2)
const DAYS_CASH_STAGE1 = getDaysOfCashBand(1)
const DAYS_CASH_STAGE2 = getDaysOfCashBand(3)

// ─── Overview Tour — school_ceo ────────────────────────────────────────────────

const overviewCeo: Step[] = [
  {
    target: 'body',
    content: 'Welcome to SchoolLaunch! This is your financial planning dashboard. Let\u2019s take a quick look at the key areas. This will take about 60 seconds.',
    placement: 'center',
    disableBeacon: true,
    title: 'Welcome to SchoolLaunch',
  },
  {
    target: '[data-tour="ai-briefing"]',
    content: 'Your AI advisor analyzes your entire financial model and surfaces risks, opportunities, and recommendations. It updates automatically when your model changes \u2014 look for the refresh indicator.',
    title: 'AI Financial Advisor',
  },
  {
    target: '[data-tour="health-tiles"]',
    content: 'These five tiles are your financial vital signs. Reserve Days and Personnel % are the two the Commission watches most closely. Click any tile to understand what\u2019s driving the number.',
    title: 'Financial Health Tiles',
  },
  {
    target: '[data-tour="budget-summary"]',
    content: 'This table shows your Year 1 base case budget \u2014 revenue, expenses, and bottom line. Above it, the 5-year trajectory shows how enrollment, net position, and reserve days evolve over time.',
    title: 'Budget Summary',
  },
  {
    target: '[data-tour="export-buttons"]',
    content: 'When you\u2019re ready, export a professional budget narrative PDF or a Commission-formatted Excel workbook. These are designed to go directly to your founding board or the Commission.',
    title: 'Export Tools',
  },
  {
    target: '[data-tour="sidebar-nav"]',
    content: 'Each tab lets you dig deeper into a specific area of your financial plan. Revenue and Staffing are where you\u2019ll spend the most time. Every tab has its own guided tour \u2014 just click the ? button anytime.',
    title: 'Navigation',
  },
  {
    target: 'body',
    content: 'You\u2019re all set! Click any tab to start building your model. The ? button in the top-right corner will restart this tour or give you a guided tour of whatever tab you\u2019re on.',
    placement: 'center',
    title: 'You\u2019re Ready!',
  },
]

// ─── Overview Tour — org_admin ─────────────────────────────────────────────────

const overviewAdmin: Step[] = [
  {
    target: 'body',
    content: 'Welcome to SchoolLaunch! As a portfolio manager, you can monitor all your schools\u2019 financial plans from one place. Let\u2019s walk through the key areas.',
    placement: 'center',
    disableBeacon: true,
    title: 'Welcome to SchoolLaunch',
  },
  {
    target: '[data-tour="school-cards"]',
    content: 'Each card shows a school\u2019s key financial health metrics \u2014 reserve days, personnel %, and projected surplus or deficit. Color coding flags schools that need attention.',
    title: 'School Cards',
  },
  {
    target: '[data-tour="status-badge"]',
    content: 'Status badges show where each school is in the planning process: Planning, Authorized, or Exported to SchoolCFO.',
    title: 'Status Badges',
  },
  {
    target: '[data-tour="notes-panel"]',
    content: 'Add timestamped notes to any school. These are visible only to your organization\u2019s staff \u2014 school CEOs don\u2019t see them.',
    title: 'Notes',
  },
  {
    target: '[data-tour="invite-button"]',
    content: 'Invite new schools by entering the CEO\u2019s name and email. They\u2019ll receive a link to set up their account and start building their financial model.',
    title: 'Invite Schools',
  },
  {
    target: 'body',
    content: 'Click any school card to view their full financial dashboard in read-only mode. The ? button will guide you through what you\u2019re seeing.',
    placement: 'center',
    title: 'You\u2019re Ready!',
  },
]

// ─── Per-Tab Deep-Dive Tours ───────────────────────────────────────────────────

const revenueTour: Step[] = [
  {
    target: '[data-tour="revenue-table"]',
    content: 'These 12 revenue lines match the Commission\u2019s V8 template. Most are auto-calculated from your enrollment and demographics. To change a rate, edit it in Settings \u2192 Revenue Assumptions \u2014 it flows through every tab and export.',
    title: 'Revenue Lines',
    disableBeacon: true,
  },
  {
    target: '[data-tour="operating-revenue"]',
    content: 'Operating Revenue is the number that matters most \u2014 it excludes one-time grants and is the denominator for Personnel %, Facility %, and Break-Even calculations.',
    title: 'Operating Revenue',
  },
  {
    target: '[data-tour="startup-grants"]',
    content: 'Add your startup funding sources here \u2014 CSP grants, philanthropic commitments, ESWA support. Set the type, status, and allocate amounts across Years 0\u20134.',
    title: 'Startup & Other Grants',
  },
  {
    target: '[data-tour="total-revenue"]',
    content: 'Total Revenue includes both operating revenue and startup grants. The Commission wants to see both, but sustainability metrics use Operating Revenue only.',
    title: 'Total Revenue',
  },
  {
    target: '[data-tour="startup-grants"]',
    content: 'Add startup funding sources here \u2014 CSP grants, philanthropic gifts, ESWA support. For each source, set the type, status (projected, pledged, or received), and allocate amounts across Years 0\u20134. Secured funding shows a green badge. This is the single place to manage all non-operating revenue.',
    title: 'Managing Funding Sources',
  },
]

const staffingTour: Step[] = [
  {
    target: '[data-tour="staffing-table"]',
    content: 'Your staffing plan is organized by Commission classification: Administrative, Certificated, and Classified. Each row is a position type \u2014 use the FTE column to set how many of each.',
    title: 'Staffing Table',
    disableBeacon: true,
  },
  {
    target: '[data-tour="personnel-pct"]',
    content: `This is the single most important number on this page. Healthy WA charter schools keep personnel costs between ${PERSONNEL_Y1.meetsLower}\u2013${PERSONNEL_Y1.meetsUpper}% of operating revenue in the founding year (Year 1) and ${PERSONNEL_Y2.meetsLower}\u2013${PERSONNEL_Y2.meetsUpper}% from Year 2. Above ${PERSONNEL_Y1.approachingHigh}% in Year 1 (${PERSONNEL_Y2.approachingHigh}% from Year 2) means your school has almost no margin to absorb surprises \u2014 a mid-year hire, a benefits increase, or an enrollment dip could push you into deficit. The Commission watches this number closely.`,
    title: 'Personnel % of Revenue',
  },
  {
    target: '[data-tour="driver-column"]',
    content: 'The Driver shows how each position\u2019s FTE scales \u2014 \u2018Per Pupil\u2019 scales with enrollment growth, while \u2018Fixed\u2019 stays constant. Click any badge to switch a position to Fixed and override Y2\u20135 manually.',
    title: 'Driver Column',
  },
  {
    target: '[data-tour="bm-column"]',
    content: 'BM shows the all-in benchmark cost: salary \u00d7 1.30, covering SEBB benefits and FICA. This is what the position actually costs your school.',
    title: 'Benchmark Cost',
  },
  {
    target: '[data-tour="year-columns"]',
    content: `Set FTE for each year. Years 2\u20135 auto-populate based on drivers but you can override any cell. Personnel typically runs ${PERSONNEL_Y1.meetsLower}\u2013${PERSONNEL_Y1.meetsUpper}% of operating revenue in Year 1 and ${PERSONNEL_Y2.meetsLower}\u2013${PERSONNEL_Y2.meetsUpper}% from Year 2 for healthy WA charters.`,
    title: 'Year Columns',
  },
  {
    target: '[data-tour="add-position"]',
    content: 'Add positions within each classification section. Choose from Commission-aligned position types or create a custom position.',
    title: 'Add Positions',
  },
]

const operationsTour: Step[] = [
  {
    target: '[data-tour="operations-table"]',
    content: 'Non-personnel expenses organized by category. Per-pupil benchmarks help you sanity-check your numbers against typical WA charter schools.',
    title: 'Expense Categories',
    disableBeacon: true,
  },
  {
    target: '[data-tour="rate-column"]',
    content: 'Edit the per-pupil rate and the total recalculates, or edit the total and the rate updates. These sync with your Settings page.',
    title: 'Per-Pupil Rate',
  },
  {
    target: '[data-tour="operations-table"]',
    content: 'Every line item amount is editable. If you have an actual lease quote or a confirmed insurance premium, type the real number here \u2014 it overrides the per-pupil estimate. Mixing known costs with benchmarked estimates gives you the most realistic model possible.',
    title: 'Editing Amounts',
  },
  {
    target: '[data-tour="authorizer-fee"]',
    content: 'The 3% authorizer fee is auto-calculated from state apportionment and can\u2019t be edited \u2014 it\u2019s contractually fixed by the Commission.',
    title: 'Authorizer Fee',
  },
]

const cashflowTour: Step[] = [
  {
    target: '[data-tour="cashflow-tabs"]',
    content: 'Year 0 covers your pre-opening period. Year 1 shows month-by-month cash flow using the actual OSPI apportionment payment schedule.',
    title: 'Year 0 & Year 1',
    disableBeacon: true,
  },
  {
    target: '[data-tour="funding-inflows"]',
    content: 'These pull from your funding sources on the Revenue tab. Status badges sync automatically \u2014 when you mark a grant as \u2018received\u2019 on Revenue, it shows here.',
    title: 'Startup Funding Inflows',
  },
  {
    target: '[data-tour="preopen-expenses"]',
    content: 'Budget your startup costs and tag each expense to a funding source. Add monthly transactions to track actual spending against budget.',
    title: 'Pre-Opening Expenses',
  },
  {
    target: '[data-tour="funding-utilization"]',
    content: 'At a glance: how much of each grant you\u2019ve committed and spent. This is what your funders will ask about.',
    title: 'Funding Utilization',
  },
  {
    target: '[data-tour="monthly-transactions"]',
    content: 'This is your startup spending tracker. Expand any month to add individual transactions \u2014 tagged to expense categories and funding sources. The budget column shows your plan; actuals are calculated from your transactions. Use this throughout your pre-opening year to track real spending against your budget.',
    title: 'Monthly Transactions',
  },
]

const multiyearTour: Step[] = [
  {
    target: '[data-tour="funding-sources-table"]',
    content: 'Your startup grants with Year 0 carry-forward calculation. Manage sources on the Revenue tab.',
    title: 'Startup Funding Sources',
    disableBeacon: true,
  },
  {
    target: '[data-tour="multiyear-table"]',
    content: 'Full five-year projection with 2.5% salary escalator, 2% ops escalator, and 3% revenue COLA. The Commission requires Years 1\u20135.',
    title: '5-Year Budget',
  },
  {
    target: '[data-tour="summary-rows"]',
    content: `These four rows tell the full financial story of your school. Total Revenue minus Total Expenses gives you Net Position \u2014 your annual surplus or deficit. Beginning Cash is what you start the year with (Year 1 includes any carry-forward from Year 0 startup funding). Ending Cash is Beginning Cash plus Net Position (plus non-cash depreciation, if you finance your facility) \u2014 it\u2019s your actual bank balance at year end. Reserve Days converts that cash balance into \u201Chow many days could we operate with no new revenue\u201D \u2014 the Commission wants to see ${DAYS_CASH_STAGE1.target} in Years 1\u20132 and ${DAYS_CASH_STAGE2.target} from Year 3. A school that shows positive Net Position every year but declining Reserve Days is growing faster than its cash can support.`,
    title: 'Financial Summary',
  },
]

const askTour: Step[] = [
  {
    target: '[data-tour="chat-input"]',
    content: 'Ask anything about your financial model in plain English. The AI has full access to your current numbers and WA charter finance expertise.',
    title: 'Ask a Question',
    disableBeacon: true,
  },
  {
    target: '[data-tour="chat-area"]',
    content: 'Try questions like \u201CCan I afford another teacher?\u201D or \u201CWhat\u2019s my break-even enrollment?\u201D The AI uses the exact same numbers you see on the dashboard.',
    title: 'Conversation',
  },
]

const advisoryTour: Step[] = [
  {
    target: '[data-tour="advisor-briefing"]',
    content: 'This is your synthesized financial advisor briefing \u2014 it pulls together findings from all seven specialist agents below into one cohesive analysis. Think of it as your CFO\u2019s executive summary: the most important risks, opportunities, and recommendations in one place.',
    title: 'Financial Advisor Briefing',
    disableBeacon: true,
  },
  {
    target: '[data-tour="agent-cards"]',
    content: 'Each agent reviews your model through a different lens \u2014 Commission compliance, enrollment realism, staffing adequacy, operational efficiency, regulatory requirements, board readiness, and long-term sustainability. Their individual findings feed the briefing above. Click any agent to read their full analysis.',
    title: 'Advisory Agents',
  },
  {
    target: '[data-tour="advisor-briefing"]',
    content: 'The same AI briefing appears on your Overview dashboard. When your model changes, the briefing updates to reflect new risks or improvements. Use the advisory agents when you want to understand why something was flagged.',
    title: 'Staying Current',
  },
]

const alignmentTour: Step[] = [
  {
    target: '[data-tour="alignment-header"]',
    content: 'The Alignment Review checks whether your financial model supports the educational vision in your charter application. A strong application tells a consistent story \u2014 if your mission emphasizes small class sizes and intensive intervention, your budget should show the staffing to deliver it.',
    title: 'Application Alignment',
    disableBeacon: true,
  },
  {
    target: '[data-tour="alignment-input"]',
    content: 'Upload or paste sections of your draft application narrative. The AI analyzes alignment between what you\u2019ve promised the Commission and what your financial model actually funds \u2014 surfacing gaps before the Commission does.',
    title: 'Your Narrative',
  },
  {
    target: '[data-tour="alignment-results"]',
    content: 'The review highlights specific misalignments: programs described in your narrative that aren\u2019t budgeted, staffing commitments that don\u2019t match your staffing plan, or facility needs that exceed your operations budget. Address these before submitting.',
    title: 'Alignment Results',
  },
]

const settingsTour: Step[] = [
  {
    target: '[data-tour="settings-header"]',
    content: 'Settings controls the assumptions behind every number in your model. Changes here ripple across all tabs \u2014 Revenue, Staffing, Operations, Cash Flow, and Multi-Year all recalculate automatically.',
    title: 'Settings Overview',
    disableBeacon: true,
  },
  {
    target: '[data-tour="school-profile"]',
    content: 'Your school\u2019s basic identity \u2014 name, region, planned opening year, and authorizer. This information appears in your exports and sets the context for all WA-specific calculations.',
    title: 'School Profile',
  },
  {
    target: '[data-tour="team-section"]',
    content: 'Invite collaborators to work on your financial plan. Editors can modify the model alongside you. Viewers get read-only access \u2014 useful for board members or advisors who need to review your plan.',
    title: 'Team Members',
  },
  {
    target: '[data-tour="enrollment-demographics"]',
    content: 'Your enrollment targets and student demographic percentages. FRL%, IEP%, ELL%, and HiCap% drive your categorical grant estimates on the Revenue tab. Adjust these as you refine your community projections.',
    title: 'Enrollment & Demographics',
  },
  {
    target: '[data-tour="grade-expansion"]',
    content: 'This is the foundation your entire model is built on. It shows which grades you\u2019re adding each year, how many sections per grade, and the resulting enrollment. Changes here recalculate revenue, per-pupil staffing, and all downstream projections across every tab.',
    title: 'Grade Expansion Plan',
  },
  {
    target: '[data-tour="programs-section"]',
    content: 'Toggle programs your school will offer \u2014 food service, transportation, before/after school care. Enabling a program adds the associated revenue lines and expense estimates to your model. Disabling removes them.',
    title: 'Programs',
  },
  {
    target: '[data-tour="revenue-assumptions"]',
    content: 'Per-pupil funding rates that drive your revenue calculations. The defaults reflect current WA state rates, but override them if your region or grade configuration uses different rates. The Regular Ed per-pupil rate is the single biggest driver of your total revenue.',
    title: 'Revenue Assumptions',
  },
  {
    target: '[data-tour="expense-assumptions"]',
    content: 'Benefits load percentage (default 30% covers SEBB and FICA) and salary escalators for multi-year projections. If you know your actual SEBB rate or have negotiated specific salary schedules, adjust these to match reality.',
    title: 'Expense Assumptions',
  },
  {
    target: '[data-tour="operations-benchmarks"]',
    content: 'Per-pupil spending rates for non-personnel categories \u2014 supplies, technology, insurance, and more. These sync bidirectionally with the Operations tab: change a benchmark here and it updates there, or edit a line item on Operations and it updates here.',
    title: 'Operations Benchmarks',
  },
]

const scorecardTour: Step[] = [
  {
    target: '[data-tour="scorecard-stages"]',
    content: 'The Commission evaluates startup schools in two phases. Stage 1 applies to Years 1\u20132 with lower thresholds appropriate for new schools. Stage 2 applies mature school standards beginning in Year 3.',
    title: 'Stage 1 & Stage 2',
    disableBeacon: true,
  },
  {
    target: '[data-tour="scorecard-table"]',
    content: 'Each row is a Commission Financial Performance Framework measure. Green means you meet the standard, amber means you\u2019re approaching, and red means you don\u2019t meet it. Focus on fixing any red cells in Years 1\u20132 first \u2014 those are the standards the Commission applies during your startup phase.',
    title: 'Reading the Scorecard',
  },
  {
    target: '[data-tour="scorecard-banner"]',
    content: 'This summary tells you your overall status at a glance. If any Stage 1 measures show red, the Commission may require a remediation plan before approving your charter. Address those items before submitting your application.',
    title: 'Overall Assessment',
  },
]

const portfolioTour: Step[] = [
  {
    target: '[data-tour="school-cards"]',
    content: 'Each card shows a school\u2019s key financial health metrics \u2014 reserve days, personnel %, and projected surplus or deficit. Color coding flags schools that need attention.',
    title: 'School Cards',
    disableBeacon: true,
  },
  {
    target: '[data-tour="invite-button"]',
    content: 'Invite new schools by entering the CEO\u2019s name and email. They\u2019ll receive a link to set up their account and start building their financial model.',
    title: 'Invite Schools',
  },
]

const portfolioSchoolTour: Step[] = [
  {
    target: '[data-tour="school-detail"]',
    content: 'You\u2019re viewing a school\u2019s financial dashboard in read-only mode. Here\u2019s what to look at and what to watch for.',
    title: 'School Detail View',
    disableBeacon: true,
  },
]

// ─── Exports ───────────────────────────────────────────────────────────────────

const CEO_TAB_TOURS: Record<string, Step[]> = {
  revenue: revenueTour,
  staffing: staffingTour,
  operations: operationsTour,
  cashflow: cashflowTour,
  multiyear: multiyearTour,
  ask: askTour,
  advisory: advisoryTour,
  alignment: alignmentTour,
  scorecard: scorecardTour,
  settings: settingsTour,
}

const ADMIN_TAB_TOURS: Record<string, Step[]> = {
  portfolio: portfolioTour,
  'portfolio-school': portfolioSchoolTour,
}

export function getOverviewSteps(role: UserRole | null): Step[] {
  if (role === 'org_admin' || role === 'super_admin') return overviewAdmin
  return overviewCeo
}

export function getTabSteps(tourName: TourName, role: UserRole | null): Step[] {
  if (role === 'org_admin' || role === 'super_admin') {
    return ADMIN_TAB_TOURS[tourName] || []
  }
  return CEO_TAB_TOURS[tourName] || []
}

/** Map pathname to a TourName for per-tab tours */
export function pathToTourName(pathname: string): TourName | null {
  if (pathname === '/dashboard') return null // overview handled separately
  if (pathname === '/dashboard/revenue') return 'revenue'
  if (pathname === '/dashboard/staffing') return 'staffing'
  if (pathname === '/dashboard/operations') return 'operations'
  if (pathname === '/dashboard/cashflow') return 'cashflow'
  if (pathname === '/dashboard/multiyear') return 'multiyear'
  if (pathname === '/dashboard/ask') return 'ask'
  if (pathname === '/dashboard/advisory') return 'advisory'
  if (pathname === '/dashboard/alignment') return 'alignment'
  if (pathname === '/dashboard/scorecard') return 'scorecard'
  if (pathname === '/dashboard/settings') return 'settings'
  if (pathname === '/portfolio') return 'portfolio'
  if (pathname.startsWith('/portfolio/')) return 'portfolio-school'
  return null
}
