/**
 * AI-EXP-01 step 3: what each eval case expects from the advisor panel. Pure functions over a
 * panel result, so tests/session4/advisor-eval-fixtures.spec.ts can check the scoring offline.
 */

export type AgentStatus = 'strong' | 'needs_attention' | 'risk'

export interface PanelAgent {
  id: string
  status: AgentStatus
  summary: string
  actions: string[]
  failed?: boolean
}

export interface Panel {
  briefing: string
  agents: PanelAgent[]
}

export interface CheckResult {
  id: string
  pass: boolean
  detail: string
}

interface Check {
  id: string
  run: (p: Panel) => CheckResult['pass'] | { pass: boolean; detail: string }
}

const text = (a: PanelAgent | undefined) => (a ? `${a.summary}\n${a.actions.join('\n')}` : '')
const agent = (p: Panel, id: string) => p.agents.find((a) => a.id === id)
const flagged = (a: PanelAgent | undefined) => !!a && !a.failed && a.status !== 'strong'

/** An agent sees the problem: it doesn't rate the area strong and its text matches every pattern. */
function catches(agentId: string, ...patterns: RegExp[]): Check {
  return {
    id: `${agentId} flags it`,
    run: (p) => {
      const a = agent(p, agentId)
      const t = text(a)
      const missing = patterns.filter((re) => !re.test(t))
      return {
        pass: flagged(a) && missing.length === 0,
        detail: !a ? 'no assessment' : `status ${a.status}${missing.length ? `; text lacks ${missing.join(', ')}` : ''}`,
      }
    },
  }
}

/** Any of the agents catches it (the finding may land with more than one advisor). */
function anyCatches(agentIds: string[], ...patterns: RegExp[]): Check {
  return {
    id: `one of ${agentIds.join('/')} flags it`,
    run: (p) => {
      const hit = agentIds.find((id) => flagged(agent(p, id)) && patterns.every((re) => re.test(text(agent(p, id)))))
      return { pass: !!hit, detail: hit ? `caught by ${hit}` : agentIds.map((id) => `${id}: ${agent(p, id)?.status ?? 'none'}`).join(', ') }
    },
  }
}

function briefingMentions(...patterns: RegExp[]): Check {
  return {
    id: 'briefing names it',
    run: (p) => {
      const missing = patterns.filter((re) => !re.test(p.briefing))
      return { pass: p.briefing.length > 0 && missing.length === 0, detail: p.briefing ? (missing.length ? `lacks ${missing.join(', ')}` : 'ok') : 'no briefing' }
    },
  }
}

function nobodySays(label: string, pattern: RegExp): Check {
  return {
    id: `no advisor ${label}`,
    run: (p) => {
      const hits = p.agents.filter((a) => pattern.test(text(a))).map((a) => a.id)
      if (pattern.test(p.briefing)) hits.push('briefing')
      return { pass: hits.length === 0, detail: hits.length ? `said by ${hits.join(', ')}` : 'ok' }
    },
  }
}

const noRisk: Check = {
  id: 'no advisor reports risk',
  run: (p) => {
    const risky = p.agents.filter((a) => a.status === 'risk').map((a) => a.id)
    return { pass: risky.length === 0, detail: risky.length ? risky.join(', ') : 'ok' }
  },
}

/** Every case: all seven advisors answered and the briefing was written. */
const COMMON: Check[] = [
  {
    id: 'panel complete',
    run: (p) => {
      const failed = p.agents.filter((a) => a.failed).map((a) => a.id)
      return { pass: p.agents.length === 7 && failed.length === 0 && p.briefing.length > 0, detail: failed.length ? `failed: ${failed.join(', ')}` : `${p.agents.length} advisors` }
    },
  },
  // Corrected or dropped claims (waFacts review) must not reappear in answers either.
  nobodySays('invents a legal SPED caseload cap', /cannot legally|legal(ly)? (caseload )?(cap|limit|maximum)|exceeds? the legal/i),
  nobodySays('cites a single October count or January true-up', /October (enrollment )?count|January true-?up/i),
]

export const CASE_CHECKS: Record<string, Check[]> = {
  control: [noRisk],
  year3_cliff: [
    anyCatches(['commission_reviewer', 'board_finance_chair', 'school_cfo'], /Year 3|Y3/i),
    briefingMentions(/Year 3|Y3/i),
  ],
  sped_understaffed: [
    catches('staffing_advisor', /SPED|special education/i, /0\.5/),
    briefingMentions(/SPED|special education/i),
  ],
  thin_back_office: [
    anyCatches(['school_cfo', 'operations_analyst', 'board_finance_chair'], /Contracted Services|\$8,000/i, /business manager|bookkeep|accounting/i),
  ],
  regular_ed_rate: [
    catches('commission_reviewer', /13,900|Regular Ed/i, /11,812|default|document|source/i),
  ],
}

/** Score one panel against its case's checks plus the common ones. */
export function scorePanel(caseId: string, panel: Panel): CheckResult[] {
  return [...COMMON, ...(CASE_CHECKS[caseId] ?? [])].map((c) => {
    const r = c.run(panel)
    return typeof r === 'boolean' ? { id: c.id, pass: r, detail: '' } : { id: c.id, ...r }
  })
}

/**
 * Dollar figures in the panel that appear nowhere in what the advisors were given: the school's
 * contexts and the prompts' own benchmarks (to the dollar, or within rounding). Advisors may
 * legitimately derive figures (a difference, a per-student cost), so this is a list for review,
 * not a pass/fail check; a rising count across prompt versions is the signal.
 */
export function unmatchedFigures(panel: Panel, given: string): string[] {
  const money = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([KkMm])?(?![\w])/g
  const nums = (s: string) => [...s.matchAll(money)].map((m) => {
    const scale = m[3] ? (m[3].toLowerCase() === 'k' ? 1e3 : 1e6) : 1
    return { raw: m[0].trim(), value: Number(m[1].replace(/,/g, '') + (m[2] ?? '')) * scale }
  })
  const known = nums(given).map((x) => x.value)
  // Bare numbers ("288 students", "-173,196.5") count too.
  for (const m of given.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) known.push(Number(m[0].replace(/,/g, '')))
  const near = (v: number) => known.some((k) => Math.abs(k - v) <= Math.max(0.5, Math.abs(k) * 0.005, v >= 1e5 ? 500 : 0))
  const out = new Set<string>()
  const texts = [panel.briefing, ...panel.agents.map((a) => `${a.summary}\n${a.actions.join('\n')}`)]
  for (const t of texts) for (const f of nums(t)) if (f.value >= 1000 && !near(f.value)) out.add(f.raw)
  return [...out]
}
