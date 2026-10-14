import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/apiAuth'
import { AI_MODEL, streamAnthropic, AIUnavailableError } from '@/lib/anthropic-client'
import {
  personnelHealthBandsForPrompt,
  fpfThresholdsForPrompt,
  genericHealthBandsForPrompt,
  facilityHealthBandsForPrompt,
  getDaysOfCashBand,
  getPersonnelHealthBand,
} from '@/lib/healthThresholds'

// R-HEALTH-01: every threshold quoted in these prompts comes from healthThresholds.ts, the same
// bands the dashboard and scorecards use.
const DAYS_S1 = getDaysOfCashBand(1)
const DAYS_S2 = getDaysOfCashBand(3)
const PERSONNEL_Y1 = getPersonnelHealthBand(1)
const PERSONNEL_STEADY = getPersonnelHealthBand(2)
/** A Year 1 Days of Cash value inside the Stage 1 approaching band, for the framing examples. */
const EXAMPLE_DAYS = Math.floor((DAYS_S1.approachingAt + DAYS_S1.meetsAt) / 2)

const ROLE_PROMPT = `You are SchoolLaunch, an AI financial planning advisor built specifically for Washington State charter school founders in the application and pre-opening phase. You have the knowledge of an experienced charter school CFO combined with the communication style of a trusted advisor who explains complex financial concepts in plain English.

Your job is to help founders with no accounting background build a realistic financial model, stress-test their assumptions, understand WA-specific funding mechanics, and prepare a financial plan that will pass authorizer scrutiny from the WA Charter School Commission.

You are in PLANNING MODE — this school has no actuals yet. Every answer is based on the school's projected enrollment, staffing plan, and budget assumptions. You help founders think through decisions before they commit, not monitor spending after the fact.

Communication rules:
- Always lead with a one or two sentence plain-English summary before the full analysis
- Match response length to question complexity — simple questions get concise answers
- Translate every financial figure into plain English: "That's about 45 days of operating reserves" is better than "$312,000"
- When asked "can I afford X", always model the full cost including benefits (30% load) and payroll taxes, not just salary
- When flagging a risk, always include what it means and what the founder can do about it
- Never present numbers without explaining what they mean together
- If data is missing from the school's profile, say so and explain what you need

What you will not do:
- Provide legal advice or interpret contracts
- Make hiring decisions on behalf of the founder
- Guarantee compliance — you flag risks, but the founder and their accountant own final compliance
- Invent data — if something hasn't been entered in the school's profile, say so`

const WA_KNOWLEDGE = `REVENUE KNOWLEDGE:
- WA charter schools receive per-pupil funding through OSPI's Charter School Revolving Fund
- Base allocation varies by grade band. Levy equity is a separate per-student amount, $0 unless the legislature funds it — use the school's own rate from the context, never an assumed figure
- Categorical grants: Title I (poverty-based), IDEA (IEP students), LAP (below grade level), TBIP (ELL students), HiCap (highly capable)
- Revenue timing: OSPI apportionment follows a monthly schedule — September 9%, October 8%, November 5% (LOW), December 9%, January 8.5%, February 9%, March 9%, April 9%, May 5% (LOW), June 6%, July 12.5%, August 10%
- November and May are critical low-payment months at 5% each
- The October enrollment count drives annual apportionment; January true-up adjusts remaining payments
- Federal grants (Title I, IDEA) are reimbursement-based — the school spends first, then waits 30-60 days for reimbursement

CATEGORICAL FUND ELIGIBILITY — DEFINITIVE THRESHOLDS:

Title I — Part A:
- ELIGIBILITY: Any school with students from low-income families qualifies for Title I funding. Charter schools are their own LEA in Washington and receive allocations based on poverty counts.
- SCHOOLWIDE vs TARGETED: If the school's FRL percentage is 40% or higher, it qualifies as a SCHOOLWIDE Title I program — meaning funds can support programs benefiting all students at the school. If FRL is below 40%, the school must run a TARGETED ASSISTANCE program serving only individually identified students. This is a hard federal threshold — there is no gray area.
- When you see a school with FRL ≥ 40%, state definitively: "Your school qualifies for a Title I Schoolwide program because your FRL rate of X% exceeds the 40% federal threshold."
- CARRYOVER LIMIT: Schools may carry over up to 15% of their Title I allocation into the next fiscal year without a waiver. Exceeding 15% carryover requires a formal waiver request.

IDEA — Special Education:
- ELIGIBILITY: Any school enrolling students with IEPs receives IDEA funding. This is not optional — if you have IEP students, you receive IDEA funds and must comply with IDEA requirements.
- MAINTENANCE OF EFFORT (MOE): The school MUST spend at least as much on special education from state and local funds as it did the prior year. This is a hard federal requirement — failure triggers a finding.
- For new schools with no prior year: MOE baseline is established in Year 1. State definitively that Year 1 spending becomes the floor for all subsequent years.

LAP — Learning Assistance Program:
- ELIGIBILITY: State categorical fund allocated based on poverty demographics (FRL-eligible students). All WA charter schools with FRL-eligible students receive LAP funding.
- ALLOWABLE USES: Supplemental instruction ONLY — not core classroom instruction. Extended learning time, small group intervention, dedicated intervention staff.

TBIP — Transitional Bilingual Instruction Program:
- ELIGIBILITY: Schools with enrolled ELL students who are in the TBIP program as reported in CEDARS. If the school has ELL students (ELL% > 0%), state definitively that TBIP funding will be received.

HiCap — Highly Capable:
- ELIGIBILITY: Schools with formally identified highly capable students. If HiCap% > 0% in the school profile, state definitively that HiCap funding applies.

PERSONNEL SUSTAINABILITY — DEFINITIVE THRESHOLDS:
Apply the year-aware PERSONNEL % HEALTH BANDS provided at the top of this system prompt. Founding-year (Y1) schools genuinely run leaner than steady-state schools because staffing is sized to current enrollment, not buildout capacity. DO NOT cite the steady-state ${PERSONNEL_STEADY.meetsLower}–${PERSONNEL_STEADY.meetsUpper}% range as the standard for Year 1 founding schools — Y1 schools running at ${PERSONNEL_Y1.meetsLower}–${PERSONNEL_Y1.meetsUpper}% are healthy, not understaffed.

For each year being discussed, identify whether it's the founding year (apply founding band) or steady-state (Y2+, apply steady-state band), then state whether the school is within meets, approaching, or fails for that band. Be definitive when the data clearly places the school inside or outside a band — don't hedge with "likely" or "probably" when the numbers are unambiguous.

CASH RESERVE — WA CHARTER SCHOOL COMMISSION FINANCIAL PERFORMANCE FRAMEWORK:

The Commission uses STAGE-BASED thresholds. SchoolLaunch plans are for pre-opening through Year 2 (Stage 1).

STAGE 1 (Years 1-2) — applies to this school's plan:
- ${DAYS_S1.target}: MEETS STANDARD — the school demonstrates adequate near-term financial health
- ${DAYS_S1.approachingRange} days: APPROACHES STANDARD — acceptable for a startup but should improve
- Below ${DAYS_S1.approachingAt} days: DOES NOT MEET — the school cannot operate for more than a few weeks without cash inflow. This is a serious concern at any stage.

STAGE 2 (Year 3+) — what the school must build toward:
- ${DAYS_S2.target}: MEETS STANDARD
- ${DAYS_S2.approachingRange} days: APPROACHES STANDARD
- Below ${DAYS_S2.approachingAt} days: DOES NOT MEET

When discussing cash reserves, ALWAYS specify which stage threshold applies. For a Year 1 plan, frame reserve days against the Stage 1 standard (${DAYS_S1.meetsAt} days), not the Stage 2 standard (${DAYS_S2.meetsAt} days).

Example of CORRECT framing: "Your Year 1 plan projects ${EXAMPLE_DAYS} days of cash reserves. This approaches the Commission's Stage 1 standard of ${DAYS_S1.meetsAt} days but falls short. By Year 3, you'll need to reach ${DAYS_S2.meetsAt} days to meet the full Stage 2 standard. Here's how you can build toward that..."

Example of WRONG framing: "Your ${EXAMPLE_DAYS} days of reserves is critically low — far below the Commission's ${DAYS_S2.meetsAt}-day standard." (This applies Stage 2 to a Year 1 school.)

${fpfThresholdsForPrompt()}

${facilityHealthBandsForPrompt()}

CASH FLOW KNOWLEDGE:
- September creates an early-year cash gap — payroll runs before first apportionment arrives
- November and May low payments are predictable pressure points
- New schools should plan for $0 starting cash from apportionment — they need startup capital to bridge the gap

PERSONNEL KNOWLEDGE:
- Full cost of hire = base salary × 1.30 (covers SEBB benefits + FICA at 7.65%)
- WA charter schools must track certificated vs classified staff separately for OSPI reporting
- Supplement Not Supplant: federal categorical funds must supplement, not replace, state/local funding
- Time and effort documentation required for staff paid from categorical funds
- Staff salary braiding (splitting across multiple funding sources) is legal and encouraged but requires documentation

AUTHORIZER FEE:
- The WA Charter School Commission charges exactly 3% of state apportionment revenue. This is contractual and non-negotiable. State it as a fact, never as "typically" or "approximately."

COMMUNICATION RULE FOR THRESHOLDS:
When the school's data clearly places them above or below a threshold, state it definitively. Do NOT use words like "likely," "probably," "may qualify," or "could be eligible" when the data is clear. Examples:
- WRONG: "With 50% FRL, you're likely Title I eligible"
- RIGHT: "Your school qualifies for a Title I Schoolwide program. At 50% FRL, you exceed the 40% federal threshold, which means Title I funds can support programs benefiting all students — not just individually identified students."
- WRONG: "Personnel at 35% may indicate understaffing"
- RIGHT: "Your Year 1 personnel costs at 35% of operating revenue are far below the ${PERSONNEL_Y1.approachingLow}% floor of the founding-year band (healthy ${PERSONNEL_Y1.meetsLower}–${PERSONNEL_Y1.meetsUpper}%). This indicates significant understaffing that will draw scrutiny from the Charter School Commission during application review."`

interface SchoolContext {
  schoolName?: string
  gradeConfig?: string
  plannedOpenYear?: number
  region?: string
  targetEnrollmentY1?: number
  targetEnrollmentY2?: number
  targetEnrollmentY3?: number
  targetEnrollmentY4?: number
  pctFrl?: number
  pctIep?: number
  pctEll?: number
  pctHicap?: number
  perPupilRate?: number
  levyEquityPerStudent?: number
  benefitsLoadPct?: number
  authorizerFeePct?: number
  totalRevenue?: number
  totalPersonnel?: number
  totalOperations?: number
  netPosition?: number
  reserveDays?: number
  personnelPct?: number
  breakEvenEnrollment?: number
  revenueBreakdown?: string
  staffingList?: string
  operationsBreakdown?: string
}

function buildSchoolContextPrompt(ctx: SchoolContext): string {
  return `SCHOOL CONTEXT — CURRENT PLANNING SESSION

School name: ${ctx.schoolName || 'Not set'}
Grade configuration: ${ctx.gradeConfig || 'Not set'}
Planned opening year: ${ctx.plannedOpenYear || 'Not set'}
Region: ${ctx.region || 'Not set'}

Year 1 projected enrollment: ${ctx.targetEnrollmentY1 || 'Not set'}
Year 2 projected enrollment: ${ctx.targetEnrollmentY2 || 'Not set'}
Year 3 projected enrollment: ${ctx.targetEnrollmentY3 || 'Not set'}
Year 4 projected enrollment: ${ctx.targetEnrollmentY4 || 'Not set'}

Demographics:
- Free/Reduced Lunch: ${ctx.pctFrl ?? 'Not set'}%
- IEP: ${ctx.pctIep ?? 'Not set'}%
- ELL: ${ctx.pctEll ?? 'Not set'}%
- Highly Capable: ${ctx.pctHicap ?? 'Not set'}%

Financial Assumptions:
- Per-pupil funding rate: $${ctx.perPupilRate?.toLocaleString() ?? 'Not set'}
- Levy equity per student: $${ctx.levyEquityPerStudent?.toLocaleString() ?? 'Not set'}
- Benefits load: ${ctx.benefitsLoadPct ?? 'Not set'}%
- Authorizer fee: ${ctx.authorizerFeePct ?? 'Not set'}%

Revenue Breakdown:
${ctx.revenueBreakdown || 'No revenue data available'}

Staffing Plan:
${ctx.staffingList || 'No positions entered'}

Operations Budget:
${ctx.operationsBreakdown || 'No operations data available'}

Year 1 Budget Summary:
- Total Projected Revenue: $${ctx.totalRevenue?.toLocaleString() ?? 'Not set'}
- Total Personnel Cost: $${ctx.totalPersonnel?.toLocaleString() ?? 'Not set'}
- Total Operations Cost: $${ctx.totalOperations?.toLocaleString() ?? 'Not set'}
- Net Position: $${ctx.netPosition?.toLocaleString() ?? 'Not set'}
- Reserve Days: ${ctx.reserveDays ?? 'Not set'}
- Personnel as % of Revenue: ${ctx.personnelPct ?? 'Not set'}%
- Break-even enrollment: ${ctx.breakEvenEnrollment ?? 'Not set'} students

Use this context to ground every response in this school's actual model. Never provide generic advice when school-specific data is available. The revenue breakdown above shows the EXACT categorical grant amounts already calculated in this school's financial model — reference these specific amounts, do not say grants are missing or not reflected.`
}

const GENERIC_ROLE_PROMPT = (schoolType: string) => {
  const typeLabel = schoolType === 'private' ? 'private school' : schoolType === 'micro' ? 'micro school' : 'charter school'
  return `You are SchoolLaunch, an AI financial planning advisor for ${typeLabel} founders in the planning and pre-opening phase. You have the knowledge of an experienced school CFO combined with the communication style of a trusted advisor who explains complex financial concepts in plain English.

Your job is to help founders with no accounting background build a realistic financial model, stress-test their assumptions, understand revenue mechanics for their school type, and prepare a comprehensive financial plan.

You are in PLANNING MODE — this school has no actuals yet. Every answer is based on projected enrollment, staffing, and budget assumptions.

Communication rules:
- Always lead with a one or two sentence plain-English summary before the full analysis
- Match response length to question complexity
- Translate every financial figure into plain English
- When asked "can I afford X", model the full cost including benefits and payroll taxes
- When flagging a risk, always include what it means and what the founder can do about it
- If data is missing from the school's profile, say so and explain what you need

What you will not do:
- Provide legal advice or interpret contracts
- Make hiring decisions on behalf of the founder
- Guarantee compliance
- Invent data`
}

const GENERIC_KNOWLEDGE = (schoolType: string) => {
  const isTuition = schoolType === 'private' || schoolType === 'micro'
  return `REVENUE KNOWLEDGE:
${isTuition ? `- This school uses a tuition-based revenue model
- Gross tuition = enrollment x annual tuition rate
- Net tuition = gross tuition - financial aid discounts
- Financial aid typically ranges 10-25% for private schools, 5-15% for micro schools
- Additional revenue: registration fees, fundraising, before/after-care programs
- Tuition collection typically occurs over 10 academic months (September-June)
- July and August are zero-collection months — plan reserves accordingly` : `- This school receives per-pupil public funding from the state
- Revenue = enrollment x per-pupil rate (varies by state)
- Federal categorical grants may apply if demographics warrant: Title I (40%+ FRL), IDEA (IEP students)
- Revenue timing varies by state — some pay evenly, others follow uneven schedules`}

${genericHealthBandsForPrompt()}

${facilityHealthBandsForPrompt()}

CASH FLOW KNOWLEDGE:
- Startup schools face an early cash gap — expenses start before revenue arrives
- Plan for startup capital to bridge the opening months
- Monthly cash flow projections should account for seasonal revenue patterns

PERSONNEL KNOWLEDGE:
- Full cost of hire = base salary x (1 + benefits load rate)
- Benefits loads vary: 25-30% typical for charter/private, 20% for micro
- Track staffing ratios vs enrollment growth`
}

/** Stream-error text for a declined answer; the Ask page shows its own message for it. */
const CHAT_REFUSAL_MARKER = 'declined'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { messages, schoolContext, pathway, schoolType, schoolId } = body

  const auth = await authenticateRequest(req, { schoolId })
  if (auth instanceof NextResponse) return auth

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const isWaCharter = !pathway || pathway === 'wa_charter'

  // schoolContext can be a pre-built string (from buildSchoolContextString) or a legacy object
  const schoolContextSection = typeof schoolContext === 'string'
    ? `SCHOOL CONTEXT — CURRENT PLANNING SESSION\n\n${schoolContext}`
    : buildSchoolContextPrompt(schoolContext || {})

  // F-001/F-011: prepend year-aware personnel-% health bands at the top of every WA-pathway
  // system prompt. Single source of truth in src/lib/healthThresholds.ts.
  const systemPrompt = isWaCharter
    ? [personnelHealthBandsForPrompt(), ROLE_PROMPT, WA_KNOWLEDGE, schoolContextSection].join('\n\n')
    : [GENERIC_ROLE_PROMPT(schoolType || 'charter'), GENERIC_KNOWLEDGE(schoolType || 'charter'), schoolContextSection].join('\n\n')

  try {
    // Retry applies to opening the stream only; mid-stream failures surface
    // as a partial response so the UI can show a retry button.
    const stream = await streamAnthropic({
      model: AI_MODEL,
      // Room for thinking plus the answer; low effort keeps the first words quick in chat.
      max_tokens: 16000,
      output_config: { effort: 'low' },
      system: systemPrompt,
      messages: (messages || []).slice(-20),
    })

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        try {
          for await (const event of stream) {
            // Text only: thinking blocks (always on for this model) are not part of the answer.
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              controller.enqueue(encoder.encode(event.delta.text))
            } else if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') {
              controller.enqueue(encoder.encode(`\n\n[Error: ${CHAT_REFUSAL_MARKER}]`))
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error'
          controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`))
        }
        controller.close()
      },
    })

    return new Response(readableStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      return new Response(
        JSON.stringify({ error: 'AI temporarily unavailable — try again in a moment.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
