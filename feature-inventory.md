# SchoolLaunch Feature Inventory

Comprehensive audit of every user-facing feature, performed 2026-04-12 against the Spokane Arts Academy test account.

---

## Global Elements

### Sidebar Navigation
- **SchoolLaunch** brand name + **Owner** role badge (top)
- 12 nav links organized into 4 groups:
  - **Planning**: Overview, Revenue, Staffing, Operations
  - **Projections**: Cash Flow, Multi-Year, Scenarios
  - **Assessment**: Ask SchoolLaunch, Advisory Panel, Alignment Review, Commission Scorecard
  - **Settings**: Settings
- **Sign Out** button (bottom)
- Active tab highlighted with teal left border + filled background
- On mobile: sidebar collapses to hamburger menu

### Help & Tours
- Floating **Help & Tours** button (bottom-right corner on every dashboard page)
- Launches guided tour system with per-tab walkthroughs
- Tour state persisted per-user via `completed_tours` in user_roles

### Help Icon
- Circled **?** icon in top-right corner of every dashboard page
- Triggers contextual help for the current tab

---

## Phase 1: Dashboard Tabs

---

### 1. Overview (/dashboard)

**Primary purpose**: Executive summary dashboard showing the school's financial health at a glance.

**Key Elements**:

| Element | Description |
|---------|-------------|
| School Header | School name, logo, grade config, opening year, buildout range, enrollment, region |
| Health Tiles (5) | Days of Cash Y1 End, Ending Cash Y1, Total Margin %, Personnel % Revenue, Facility % Revenue |
| FPF Summary Banner | Green banner summarizing Stage 1/Stage 2 compliance across all 5 years |
| Enrollment Sensitivity Alert | Shows impact of 90% enrollment on days of cash (amber warning) |
| Facility Cost Alert | Orange warning when facility costs approach 15% of revenue threshold |
| Financial Advisor Briefing | AI-generated executive summary from 7 advisory agents, with agent legend (colored dots for Commission, Enrollment, Staffing, Compliance, Operations, Board, SchoolCFO) |
| 5-Year Trajectory Table | Enrollment, Grades Served, Net Position, Days Cash for Years 1-5 |
| Year 1 Base Case Detail | Revenue breakdown (Operating Revenue, Startup Grants, Total), Expense breakdown (Personnel, Operations, Total), Bottom Line (Net Position, Days of Cash) |
| Scenario Summary Card | 3-column display: Base Case, Conservative, Optimistic with reserve days + FPF badge per scenario, fill rate labels |
| Export Buttons | "Export Budget Narrative" (PDF) and "Export for Commission" (Excel) |

**Interactive Elements**:
- **Read Full Briefing / Collapse Briefing** — expands/collapses the full AI advisory narrative
- **Refresh** button on briefing — regenerates advisory analysis
- **View Full Scorecard** link — navigates to /dashboard/scorecard
- **View Full Advisory Panel** link — navigates to /dashboard/advisory
- **View Full Scenarios** link — navigates to /dashboard/scenarios
- **Export Budget Narrative** button — generates and downloads PDF
- **Export for Commission** button — generates and downloads .xlsx

**Conditional Elements**:
- Enrollment sensitivity alert only appears when 90% enrollment would significantly impact days of cash
- Facility cost alert only appears when facility costs approach 15% threshold
- Scenario Summary card only appears when scenarios have been seeded/calculated
- FPF badges show "Meets Stage 1", "Meets Stage 2", or "Cash Shortfall" based on reserve days
- Health tile borders are color-coded: teal (good), orange (warning)
- Net Position and Days Cash values are color-coded green (positive) or red (negative)

**Connected Features**: Data flows from Revenue, Staffing, Operations, Scenarios, and Advisory Panel tabs.

**Non-obvious Features**:
- The briefing timestamp shows when advisory cache was last generated
- The briefing legend shows which of the 7 agents contributed to the analysis
- "Current" label under Year 1 in the trajectory table

---

### 2. Revenue (/dashboard/revenue)

**Primary purpose**: Commission-aligned revenue breakdown for Year 1. Per-pupil rates are edited in Settings → Revenue Assumptions (and Operations Benchmarks for food/transportation revenue), so changes flow through every tab and export.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Headcount / AAFTE Display | "Headcount: 96 students | AAFTE: 91 students (95%)" with note about which programs use which |
| Revenue Table | 4 columns: Revenue Source, Formula, Base Case, Amount (read-only; rates come from Settings) |
| State & Local Section (6 lines) | Regular Ed Apportionment, SPED Apportionment, State Special Education, Levy Equity, Facilities Revenue, Small School Enhancement |
| Federal Section (2 lines) | Title I, IDEA (Federal Special Ed) |
| State Categorical Section (4 lines) | LAP, LAP High Poverty, TBIP (Bilingual), Highly Capable |
| Program Revenue Section (2 lines) | Food Service (NSLP), Transportation (State) |
| Operating Revenue Subtotal | Sum of all operating lines |
| Startup & Other Grants Section | Editable funding source table with year allocation |
| Total Revenue Row | Operating + Startup grants |

**Interactive Elements**:
- **Settings → Revenue Assumptions** link in the page subtitle — where every per-pupil rate is edited
- **+ Add Source** button — adds a new startup funding row
- **Save** button — persists startup funding changes
- **x** button per funding row — removes that funding source
- **Funding source name** text input — editable source name
- **Total Amount** spinbutton — editable dollar amount
- **Type** dropdown — grant, donation, debt, other
- **Status** dropdown — received, pledged, applied, projected, n/a
- **Year Allocation** buttons (Y0-Y4) — toggle which years receive the funding

**Conditional Elements**:
- Descriptions appear as gray subtext on certain lines (SPED, State Special Ed, Levy Equity, Small School Enhancement, LAP High Poverty, Food Service NSLP, Transportation)
- Small School Enhancement shows the prototypical minimums per grade band (K-6: 60, 7-8: 20, 9-12: 60 AAFTE)
- Secured/Pending badges appear below funding table with color coding
- **Warning banner** appears when <50% of startup funding is secured
- Program Revenue section only appears when food service or transportation programs are enabled

**Connected Features**: Revenue data feeds into Overview health tiles, Multi-Year projections, Cash Flow, Scenarios, and all exports. Startup funding flows to Cash Flow Year 0.

**Non-obvious Features**:
- Formulas show the exact calculation (e.g., "91 AAFTE x $11,812")
- There is no per-line override: the former Override column was display-only (never saved, ignored by the engine) and was removed in Phase 1 (P-UX-01). Adjust the rate in Settings, or add a custom revenue line for revenue the template doesn't list
- Year allocation buttons are multi-select toggles (click to add a year, click again to remove)
- "Select years above" prompt appears when no years are selected for a funding source

---

### 3. Staffing (/dashboard/staffing)

**Primary purpose**: Multi-year staffing projection in Commission V8 template format.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Personnel % Revenue Badge | "Personnel: 79.6% of Revenue (Y1)" — color-coded |
| Enrollment Row | Y1-Y5 enrollment targets across the top |
| Salary Escalator Note | "Salary escalator: 2.5%/yr" |
| Position Table | Columns: drag handle, Position, Classification, Driver, Salary (Y1), Y1-Y5 FTE, delete button |
| 3 Classification Groups | Administrative, Certificated, Classified — each with own section header and "+ Add" button |
| Summary Footer | Total FTE, Total Salaries, Benefits (30%), Total Personnel Cost, Staff breakdown (Admin/Cert/Class) — all for Y1-Y5 |

**Interactive Elements**:
- **+ Add Position** button (top-right) — adds position to current group
- **+ Add Administrative/Certificated/Classified Position** buttons — add position to specific group
- **Position dropdown** (combobox) per row — 8-12 predefined options + "Custom Position"
- **Custom position name** text input — appears when "Custom Position" selected
- **Salary spinbutton** — editable Y1 base salary
- **FTE spinbuttons** (Y1-Y5) — editable FTE count per year per position
- **x delete button** per row — removes the position
- **Drag handles** (6-dot grid icon) — reorder positions within a group
- **Save Changes** button — persists all staffing changes

**Conditional Elements**:
- "Total comp: $X" appears below each salary showing salary + 30% benefits
- Driver column shows "Fixed" or "Per Pupil" based on position type
- Classification badge is auto-assigned based on position type (Administrative, Certificated, Classified)
- FTE values for Per Pupil positions auto-scale with enrollment in Y2-Y5

**Connected Features**: Personnel costs feed into Overview, Multi-Year, Scenarios, Cash Flow, Operations (for PD cost calculation), and all exports.

**Non-obvious Features**:
- Salary escalator applies automatically to Y2-Y5 projections (2.5% compounding)
- Benefits are always 30% of salary (SEBB + FICA)
- Per Pupil driver positions scale FTE automatically with enrollment growth
- The staff breakdown row shows the Admin/Cert/Class split (e.g., "2/6/4")

---

### 4. Operations (/dashboard/operations)

**Primary purpose**: Non-personnel expenses for Year 1, organized by category with per-unit rate editing.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Facility Cost Alert | Orange banner: "12.2% of revenue — Approaching 15% threshold" |
| Food Service Info Banner | Teal banner about Community Eligibility Provision (CEP) |
| Transportation Info Banner | Blue banner about RCW 28A.710.040 requirements |
| Expense Table | 4 columns: Expense, Rate, Benchmark, Amount |
| 4 Category Groups | Facilities & Occupancy, Instructional, Student Services, Administrative |
| Category Subtotals | Sum per group |
| Total Operations | Grand total of all categories |

**Expense Lines (13 total)**:
1. **Facilities** — flat amount input ($180,000)
2. **Insurance** — flat amount input ($18,000)
3. **Supplies & Materials** — $/student rate input ($200/student)
4. **Technology** — $/student rate input ($300/student)
5. **Curriculum & Materials** — $/student rate input ($500/student)
6. **Professional Development** — $/FTE rate input ($2,000/FTE)
7. **Food Service** — $/student rate input ($1,200/student)
8. **Transportation** — $/student rate input ($800/student)
9. **Contracted Services** — $/student rate input ($150/student)
10. **Marketing & Outreach** — $/student rate input ($100/student)
11. **Fundraising** — flat amount input ($15,000/yr)
12. **Authorizer Fee** — auto-calculated, 3% of state apportionment (non-editable)
13. **Misc/Contingency** — percentage-based (visible in Settings)

**Interactive Elements**:
- **Per-unit rate spinbuttons** — $/student or $/FTE inputs for per-unit categories
- **Flat amount spinbuttons** — direct dollar inputs for facilities, insurance, fundraising
- **Save Changes** button — persists all changes (syncs to Settings)

**Conditional Elements**:
- Facility cost alert only appears when facility % approaches 15%
- Food Service and Transportation rows only appear when those programs are enabled in Settings
- CEP info banner only appears when FRL% suggests eligibility
- Benchmark column shows the formula calculation (e.g., "$200/student = $19,200")

**Connected Features**: Operations data feeds into Overview, Multi-Year, Scenarios, Cash Flow. Changes sync bidirectionally with Settings.

**Non-obvious Features**:
- Authorizer Fee is auto-calculated and cannot be overridden (3% is mandated by WA law)
- Rate inputs and amount inputs are linked — editing the rate recalculates the amount
- The description says "changes sync to Settings on save"

---

### 5. Cash Flow (/dashboard/cashflow)

**Primary purpose**: Month-by-month cash flow projections using the OSPI apportionment payment schedule.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Year Tab Switcher | "Year 0 (Pre-Opening)" and "Year 1 (First Operating Year)" toggle buttons |
| **Year 0 View**: | |
| Startup Funding Inflows Table | Source, Y0 Allocation, Type badge, Status badge |
| Secured/At Risk Badges | Green "Secured: $X" and orange "At Risk: $X" |
| Pre-Opening Expense Budget | Summary tiles (Total Budgeted, Total Spent, Variance, % of Startup Funding) + editable expense table |
| Funding Source Utilization Table | Source, Y0 Allocation, Budgeted, Spent, Remaining |
| Monthly Cash Flow & Transactions | Expandable month rows (Mar-Aug) with Budgeted, Actual, Cum. Budget, Cum. Actual, Balance |
| Carry-Forward Note | "Year 0 ending balance of $X carries forward as Year 1 starting cash" |
| **Year 1 View**: | |
| Starting Cash Balance | "Starting cash balance: $500,000 (carried from Year 0 pre-opening)" |
| Monthly Breakdown Table | Month, Apport. %, Apport. $, Other Revenue, Total Inflow, Payroll, Other Expenses (Sep-Aug, 12 months) |

**Interactive Elements (Year 0)**:
- **Year 0 / Year 1 tab buttons** — switch between views
- **Expense name** text inputs — editable pre-opening expense names
- **Funding source** dropdown — assign expense to a specific grant source
- **Budgeted** spinbutton — enter budgeted amount per expense
- **+ Add Expense Category** button — add new pre-opening expense
- **x** button — remove expense
- **Month row click** — expand to add individual transactions
- **Save All Changes** button — persists pre-opening data

**Conditional Elements**:
- At Risk badge only appears if any funding sources have non-secured status
- Monthly balance cells would turn red if balance goes negative
- Variance shows green (under budget) or red (over budget)

**Connected Features**: Startup funding flows from Revenue tab. Year 0 ending balance carries forward as Year 1 starting cash. Year 1 uses OSPI apportionment schedule.

**Non-obvious Features**:
- OSPI apportionment percentages shown per month (Sep 9%, Oct 8%, Nov 5%, Dec 9%, Jan 8.5%, Feb 9%, Mar 9%, Apr 9%, May 5%, Jun 6%, Jul 12.5%, Aug 10%)
- Only "received" and "pledged" funding counts as Secured
- Month rows are expandable (click the chevron) to add individual transactions
- Pre-Opening months default to Mar-Aug (6 months before Sep school year start)

---

### 6. Multi-Year (/dashboard/multiyear)

**Primary purpose**: Five-year financial projection with detailed revenue, expense, and summary breakdowns.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Escalator Note | "Five-year projection with 2.5% annual salary escalator, 2% operations escalator, and 3% revenue COLA" |
| Startup Funding Sources Table | Source, Status badge, Year 0-4 allocations with "Manage on Revenue tab" link |
| Secured/Pending Badges | Summary of secured vs pending funding |
| Year 0 Summary Line | "Year 0 Funding: $500,000 | Pre-Opening Actual Spend: $35,000 | Carry-Forward to Year 1: $465,000" |
| **Enrollment (Grade Expansion)** | Grades Served, New Grades Added, Returning Students, New Grade Students, Total Enrollment — all for Y1-Y4+ |
| **Revenue Section** (15+ lines) | Regular Ed, SPED, State Special Ed, Facilities Revenue, Levy Equity, Title I, IDEA, LAP, LAP High Poverty, TBIP, HiCap, Small School Enhancement, Food Service (NSLP), Transportation (State), Interest & Other Income |
| Operating Revenue Subtotal | |
| Startup & Other Grants | |
| Total Revenue (incl. Grants) | |
| **Personnel Section** | Certificated Staff, Classified Staff, Admin Staff, Benefits (30%), Total Personnel, Staff Count |
| **Operations Section** (13 lines) | Facilities, Supplies, Contracted Services, Technology, Authorizer Fee, Insurance, Food Service, Transportation, Curriculum, Professional Development, Marketing, Fundraising, Misc/Contingency |
| Total Operations | |
| **Summary Section** | Total Revenue, Total Expenses, Net Position, Beginning Cash, Ending Cash, Days Cash |

**Interactive Elements**:
- **Manage on Revenue tab** link — navigates to Revenue tab
- All data is read-only on this page (edit on source tabs)

**Conditional Elements**:
- Grade expansion rows only appear when grade expansion mode is used
- Food Service and Transportation revenue rows only appear when programs are enabled
- Days Cash values are color-coded (green for healthy, orange/red for concerning)
- "Beginning Cash each year equals the prior year's Ending Cash" note at bottom

**Connected Features**: Aggregates data from Revenue, Staffing, Operations, and Cash Flow. Feeds into Overview, Scenarios, Scorecard, and exports.

**Non-obvious Features**:
- Year 0 column shows pre-opening funding only
- Carry-forward logic: Year 0 ending balance becomes Year 1 beginning cash
- Staff Count row shows Admin/Cert/Class breakdown per year
- Interest & Other Income is auto-calculated based on cash balance and interest rate

---

### 7. Scenarios (/dashboard/scenarios)

**Primary purpose**: Model conservative, base, and optimistic financial scenarios side-by-side.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Staleness Banner | Yellow warning: "Your base financial model has changed since these scenarios were last calculated" with "Recalculate All Scenarios" button |
| Scenario Tab Switcher | Base Case, Conservative, Optimistic tabs |
| 5 Financial Levers | Enrollment Fill Rate (slider 70-100%), Per-Pupil Funding (slider -10% to +5%), Personnel Costs (slider -10% to +15%), Monthly Facility Cost (number input $0-$50K), Startup Capital (number input $0-$1M) |
| 3-Column Comparison Table | Metric column + Base Case + Conservative + Optimistic columns |
| 5 Expandable Sections | Key Outcomes, 5-Year Trajectory, Commission FPF Compliance, Revenue Breakdown, Expense Breakdown |
| AI Scenario Analysis | Cached AI-generated narrative comparing all 3 scenarios |

**Interactive Elements**:
- **Scenario tabs** (Base Case / Conservative / Optimistic) — switch which scenario's levers are visible
- **Enrollment Fill Rate slider** — drag to adjust (shows percentage + warning at 95%+)
- **Per-Pupil Funding slider** — drag to adjust
- **Personnel Costs slider** — drag to adjust
- **Monthly Facility Cost number input** — direct dollar entry with slider
- **Startup Capital number input** — direct dollar entry
- **Recalculate All Scenarios** button — recomputes after base data changes
- **Refresh Analysis** button — regenerates AI narrative
- **Section expand/collapse** chevrons — toggle visibility of each comparison group

**Conditional Elements**:
- Staleness banner only appears when base data hash doesn't match
- "95%+ fill rate is ambitious for a new school" warning appears at high fill rates
- Delta indicators on Conservative/Optimistic columns (green positive, red negative, e.g., "-20 students", "+$170K")
- "Cash Shortfall" red badge when reserve days = 0
- FPF compliance badges per scenario (Meets Stage 1, Cash Shortfall, etc.)

**Key Outcomes metrics**: Year 1 Enrollment, Total Revenue, Total Expenses, Net Position, Ending Cash, Reserve Days, Personnel % Revenue, Break-Even Enrollment

**Connected Features**: Pulls base case from Revenue/Staffing/Operations. Results shown in Overview Scenario Summary card. Exported in Budget Narrative PDF and Commission Excel.

**Non-obvious Features**:
- Fill rate labels in headers (e.g., "Base Case (100% Fill)")
- Break-Even Enrollment calculated per scenario
- Debounced auto-save (500ms) with automatic recalculation
- AI analysis is cached in Supabase and only regenerated on demand

---

### 8. Ask SchoolLaunch (/dashboard/ask)

**Primary purpose**: AI chat interface for asking questions about your financial model in plain English.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Sparkle Icon | Teal animated icon at top |
| Title | "Ask SchoolLaunch" |
| Subtitle | "Ask questions about your financial model in plain English" |
| 6 Example Prompt Cards | Pre-written questions users can click |
| Chat Input | Text input: "Ask about your budget, staffing, cash flow, or WA charter finance..." |
| Send Button | Teal arrow button |

**Example Prompts**:
1. "What enrollment do I need to break even in Year 1?"
2. "Can I afford a full-time principal at this enrollment level?"
3. "How does our personnel ratio compare to healthy WA charters?"
4. "What happens to our reserve days if we lose 15 students?"
5. "Are there braiding opportunities with our grants?"
6. "What are the biggest risks in our financial model?"

**Interactive Elements**:
- **Example prompt cards** — click to auto-populate the question
- **Chat input** — type a question
- **Send button** — submit the question
- Chat history displays in a scrollable conversation view

**Connected Features**: AI has full context of the school's financial model via `buildSchoolContextString()`.

**Non-obvious Features**:
- The AI sees all financial data, staffing, operations, demographics — not just what's on screen
- Responses stream in real-time
- Conversation history is maintained within the session

---

### 9. Advisory Panel (/dashboard/advisory)

**Primary purpose**: Seven expert AI perspectives on your financial plan with synthesized briefing.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Refresh Analysis Button | Top-right, regenerates all agent analyses |
| Financial Advisor Briefing | Full synthesized narrative at top (same as Overview but complete) |
| Status Summary | "3 Strong / 4 Needs Attention / 0 Risk" with colored dots |
| Cache Timestamp | "Last updated: 3/25/2026, 7:46:49 PM" |
| 7 Agent Cards | Each with role icon, name, description, status badge, narrative, and recommendation bullets |

**7 Advisory Agents**:

| Agent | Role Description | Example Status |
|-------|-----------------|----------------|
| Commission Reviewer | WA Charter School Commission perspective | Strong |
| Enrollment Realist | Enrollment and demographic expertise | Needs Attention |
| Staffing Advisor | HR and staffing specialist | Needs Attention |
| Compliance Officer | Federal and state grant compliance | Needs Attention |
| Operations Analyst | Operations and facilities | Needs Attention |
| Board Finance Chair | Governance and fiduciary oversight | Strong |
| SchoolCFO Advisor | Long-term operational sustainability | Strong |

**Interactive Elements**:
- **Refresh Analysis** button — regenerates all 7 agents + briefing
- **Ask SchoolLaunch** button at bottom — navigates to Ask tab for follow-up questions

**Conditional Elements**:
- Status badges: green "Strong", amber "Needs Attention", red "Risk"
- Each agent card contains 2-4 bullet-point recommendations
- Loading spinners appear during generation

**Connected Features**: Advisory data is cached in `school_profiles.advisory_cache`. Briefing summary appears on Overview tab.

**Non-obvious Features**:
- Agents receive pre-computed metrics as prose — they don't independently compute financials
- Cache invalidation uses a hash of rounded financial metrics
- "Want to explore a finding?" prompt at bottom links to Ask SchoolLaunch

---

### 10. Alignment Review (/dashboard/alignment)

**Primary purpose**: Upload draft application narrative for AI analysis against financial model.

**Key Elements**:

| Element | Description |
|---------|-------------|
| File Upload Zone | Drag-and-drop area: "Drop your application narrative here, or click to browse" |
| File Type Note | "PDF or plain text, up to 10MB" |
| Recommended Sections Note | "Executive Summary, Educational Program, Staffing Plan, Growth Plan, and Community Need" |
| Analyze Alignment Button | Teal button to trigger AI analysis |

**Interactive Elements**:
- **Drag-and-drop zone** — drop a PDF/text file
- **Click to browse** — opens file picker
- **Analyze Alignment** button — sends document to AI for comparison

**Conditional Elements**:
- After analysis: results display with alignment findings, misalignments, and recommendations
- Previous review results are persisted and shown on return

**Connected Features**: AI compares uploaded narrative against the school's actual financial model data.

**Non-obvious Features**:
- You don't need the full application — key narrative sections are sufficient
- Analysis checks for misalignments between what you wrote and what your model shows

---

### 11. Commission Scorecard (/dashboard/scorecard)

**Primary purpose**: Financial Performance Framework assessment against WA Charter School Commission standards.

**Key Elements**:

| Element | Description |
|---------|-------------|
| Compliance Summary Banner | Green: "Your model meets all Stage 1 standards for Years 1-2 and all Stage 2 standards for Years 3-5" |
| Stage Labels | "Stage 1 - Years 1-2" and "Stage 2 - Years 3-5" in header |
| FPF Grid | 10 metrics x 5 years with color-coded badges |
| Target Column | Shows S1/S2 thresholds and approaching ranges |
| Legend | Green (Meets Standard), Yellow (Approaching), Red (Does Not Meet), Gray (N/A) |
| About This Scorecard | Expandable accordion with detailed methodology |

**10 FPF Metrics**:

| Metric | Formula | Stage 1 Target | Stage 2 Target |
|--------|---------|---------------|---------------|
| Current Ratio | Current Assets / Current Liabilities | >= 1 | >= 1 |
| Days of Cash | Unrestricted Cash / ((Expenses - Depreciation) / 365) | >= 30 | >= 60 |
| Total Margin | Net Income / Total Revenue | >= 0% | >= 0% |
| 3-Year Total Margin | Rolling 3-year calculation | N/A first 2 years | > 0% |
| Debt-to-Asset | Total Liabilities / Total Assets | < 0.9 | < 0.9 |
| Debt Default | In default of loan covenants? | No default | No default |
| Cash Flow | Year-End Cash - Prior Year-End Cash | > $0 | > $0 |
| Multi-Year Cash Flow | Year N Cash - Year (N-2) Cash | N/A first 2 years | > $0 |
| Enrollment Variance | Actual / Projected Enrollment | >= 95% | >= 95% |

**Interactive Elements**:
- **About This Scorecard** expandable section — methodology details

**Conditional Elements**:
- N/A badges for metrics that don't apply in early years (3-Year Total Margin, Multi-Year Cash Flow)
- Compliance banner text changes based on overall pass/fail status
- Per-cell color coding: green (Meets), yellow (Approaching), red (Does Not Meet)

**Connected Features**: Data pulled from Multi-Year projections. Summary shown on Overview.

**Non-obvious Features**:
- Planning proxy note for Current Ratio: "The Commission calculates this from audited balance sheet data"
- Debt Default shows "N/A — No debt modeled in planning mode"
- Enrollment Variance always shows 100% in planning (becomes meaningful with actual data)

---

### 12. Settings (/dashboard/settings)

**Primary purpose**: Edit all school configuration, financial assumptions, team management, and danger zone actions.

**Key Elements (Sections)**:

**School Profile**:
- School Name (text input)
- Planned Open Year (number)
- Region (dropdown)
- School Logo upload (drag-and-drop with preview)
- "Upload new logo" and "Remove" buttons

**Enrollment & Demographics**:
- Enrollment Y1-Y5 (5 spinbuttons)
- Max Class Size
- Full Build-Out grades display
- Grade Expansion Plan (if in expansion mode) — table with Year, Grades, Sections, Students/Section, Type columns
- Demographics sliders/inputs: % FRL, % IEP, % ELL, % HiCap

**Revenue Assumptions**:
- Per-Pupil Rate (Regular Ed apportionment)
- AAFTE % (enrollment efficiency)
- Revenue COLA % (annual escalator)
- Interest Rate on Cash %
- SPED per-pupil, Title I per-FRL, IDEA per-IEP, LAP per-FRL, LAP High Poverty per-student, TBIP per-ELL, HiCap per-student
- Food Service Revenue per-student (conditional)
- Transportation Revenue per-student (conditional)

**Expense Assumptions**:
- Salary Escalator %
- Benefits Load %
- Operations Escalator %
- Contingency %

**Programs**:
- Food Service Offered toggle (on/off)
- Transportation Offered toggle (on/off)

**Team Members**:
- Team member list with name, email, role badge
- Invite button to add new team members

**Danger Zone**:
- "Reset to default financial data" button with confirmation
- Red styling to indicate destructive action

**Interactive Elements**:
- All text inputs, number inputs, dropdowns, toggles are editable
- **Save Changes** button at bottom
- **Upload logo** drag-and-drop / click
- **Remove** logo button
- **Invite** team member button
- **Reset** button in danger zone

**Connected Features**: Settings changes propagate to Revenue, Staffing, Operations, Multi-Year, Scenarios, and all exports.

---

## Phase 2: Non-Dashboard Pages

---

### Signup (/signup)

**Elements**: Full Name, Email, Password (min 8 chars), Confirm Password, "Create Account" button, "Already have an account? Sign in" link
**Flow**: Creates auth user + school + school_profile + user_roles via /api/auth/signup, signs in client-side, redirects to /onboarding

### Login (/login)

**Elements**: Email, Password, "Sign In" button, "Forgot password?" link, "Don't have an account? Sign up" link
**Views**: Login form, Forgot Password (enter email), OTP Verification (8-digit code entry), Reset Password (new + confirm)
**Flow**: Authenticates, checks roles, routes to /portfolio (admin), /select-school (multi-school), /onboarding (incomplete), or /dashboard

### Onboarding (/onboarding)

**Layout**: Full-width, no sidebar — clean focused wizard experience
**Steps**: 5-step wizard with progress stepper:
1. **School Identity** — Name, Region, Open Year, Grade Config, Founding/Buildout Grades
2. **Enrollment** — Y1 target, class size, growth preset, grade expansion mode
3. **Demographics** — % FRL, % IEP, % ELL, % HiCap
4. **Staffing** — Add/remove positions from 27 Commission-aligned types
5. **Operations** — Facility mode, per-unit rates, food/transport programs, startup funding

**Completion Screen**: "Your Budget is Ready!" with 4 metric tiles (Y1 Revenue, Personnel Cost, Total FTE, Personnel %), next steps checklist, "Go to Dashboard" button

**Enforcement**: Middleware redirects incomplete users from /dashboard to /onboarding. Completed users redirected from /onboarding to /dashboard.

### Invite (/invite)

**Two states**:
- **New user**: Set password + confirm password → creates account + accepts invitation
- **Existing user**: Enter password → signs in + accepts invitation
- Shows invitation details: school name, role, inviting org

### Portfolio (/portfolio) — Admin View

**Elements**:
- **Header**: SchoolLaunch PORTFOLIO brand, Sign Out, Help
- **Deadline Banner**: "Charter Continuity RFP — Submission Deadline: TBD"
- **6 Summary Tiles**: Total Schools, FPF Compliance (X/Y), Avg Reserve Days, Ready count, In Progress count, Needs Attention count
- **Search Bar**: Filter schools by name
- **Sort Dropdown**: Reserve Days (Low/High), Personnel %, Net Position, Name, Last Updated
- **Filter Pills**: All, Needs Attention, On Track, Not Started, Scenarios Missing (with counts)
- **Table/Cards Toggle**: Switch between table and card views
- **School Table**: School name, Status badge, Y1 Enrollment, Reserve Days, Personnel %, Net Position, FPF status, Advisory status, Readiness score, Last Updated
- **Portfolio Average Row**: Averages across all schools
- **Recent Activity Feed**: Timeline of recent notes across schools
- **Action Buttons**: FPF Matrix, Export PDF, Export Excel, Invite School

**Interactive Elements**:
- Search input, sort dropdown, filter pills, Table/Cards toggle
- Column header sorting (click to sort by that column)
- School name click → navigates to /portfolio/[schoolId] detail page
- Notes badge on school rows → opens notes panel
- FPF Matrix button → toggles cross-school compliance matrix
- Export PDF/Excel buttons
- Invite School button

---

## Phase 3: Interactive Flows

### Budget Narrative PDF Export
Sections: School Profile, Executive Summary, Revenue Model, Staffing Plan, Operations Budget, Multi-Year Projections, Cash Flow, Commission FPF Scorecard, Scenario Analysis (comparison table + AI narrative)

### Commission Excel Export
Tabs: Summary, Revenue Detail, Staffing Detail, Operations Detail, Multi-Year Projections, Cash Flow, Scenarios (assumptions + projections + FPF matrix)

### Guided Tour System
- Per-tab walkthroughs triggered via Help & Tours button
- Tour state persisted per-user (tracks which tours completed)
- Each tab has its own contextual tour

### School Logo Upload
- Settings → School Profile section
- Drag-and-drop or click to browse
- Stored in Supabase Storage bucket `school-logos` at `{school_id}/logo.{ext}`
- Logo appears in school header and PDF exports

### Team Invitation Flow
- Settings → Team Members → Invite button
- Enter email + select role (Owner/Editor/Viewer)
- Creates invitation record with token + expiration (7 days)
- Invitee receives email, clicks link to /invite?token=...
- New user: creates account + joins school
- Existing user: signs in + joins school

### Password Reset Flow
- Login → "Forgot password?" → enter email
- 8-digit OTP sent via email
- Enter OTP in verification screen (auto-submits when all 8 digits entered)
- Set new password + confirm
- Success → "Sign in with your new password"

---

## Phase 4: Role-Based Permissions

| Capability | Owner (CEO) | Editor | Viewer |
|-----------|:-----------:|:------:|:------:|
| View all tabs | Yes | Yes | Yes |
| Edit financial data | Yes | Yes | No |
| Manage team | Yes | No | No |
| Reset school | Yes | No | No |
| Edit school identity | Yes | No | No |
| Export PDF/Excel | Yes | Yes | No |
| Use AI features | Yes | Yes | No |
| Upload logo | Yes | No | No |

---

## Appendix: Financial Constants

| Constant | Value |
|----------|-------|
| WA Charter Fiscal Year | September 1 - August 31 |
| Benefits Load | 30% (SEBB + FICA) |
| Salary Escalator | 2.5% annually |
| Revenue COLA | 3% annually |
| Operations Escalator | 2% annually |
| Authorizer Fee | 3% of state apportionment |
| AAFTE Default | 95% of headcount |
| OSPI Schedule | Sep 9%, Oct 8%, Nov 5%, Dec 9%, Jan 8.5%, Feb 9%, Mar 9%, Apr 9%, May 5%, Jun 6%, Jul 12.5%, Aug 10% |
