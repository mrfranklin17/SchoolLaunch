import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { createServerClient } from '@supabase/ssr'
import { EVAL_CASES, evalSchool, type EvalCase } from './advisorFixtures'
import { scorePanel, unmatchedFigures, type CheckResult, type Panel } from './advisorChecks'
import { PROMPT_VERSION } from '../../src/lib/buildSchoolContext'
import { AGENTS, DATA_BOUNDARIES, runAdvisoryPanel } from '../../src/app/api/advisory/route'
import { personnelHealthBandsForPrompt } from '../../src/lib/healthThresholds'
import { ACCOUNTS } from '../session1/fixtures'

/**
 * AI-EXP-01 step 3: the advisor eval. Runs each fixture school (advisorFixtures.ts) through the
 * real advisor panel and scores the answers (advisorChecks.ts), so a prompt change shows what it
 * fixed or broke. Real AI calls: run on demand, never in CI. See tests/evals/README.md.
 *
 *   EVAL_BASE_URL=https://schoollaunch.vercel.app npx playwright test -c tests/evals/playwright.eval.config.ts
 */

const BASE_URL = process.env.EVAL_BASE_URL?.replace(/\/$/, '')
const ONLY = process.env.EVAL_CASES?.split(',').map((s) => s.trim()).filter(Boolean)
const OUT_DIR = process.env.EVAL_OUT || path.join(__dirname, 'results')
const BASELINE = path.join(__dirname, 'baseline.json')

const cases = EVAL_CASES.filter((c) => !ONLY || ONLY.includes(c.id))

/** What a panel's figures may come from: both contexts and the prompts (their benchmarks). */
const PROMPTS = [personnelHealthBandsForPrompt(), DATA_BOUNDARIES, ...AGENTS.map((a) => a.systemPrompt)].join('\n')
const given = (request: ReturnType<typeof evalSchool>['request']) => `${request.schoolContext}\n${request.agentContext}\n${PROMPTS}`

type Transport = (c: EvalCase, run: number) => Promise<{ panel: Panel; context: string }>

/** In-process: the route's own panel runner, with ANTHROPIC_API_KEY from the environment. */
const direct: Transport = async (c) => {
  const { request } = evalSchool(c)
  return { panel: await runAdvisoryPanel(request), context: given(request) }
}

/**
 * Against a deployment: signs in as the test-columbia account (an owner, as /api/advisory
 * requires) and posts the fixture's contexts. The route only reads the role; it writes nothing,
 * so the account's school is untouched. Cost: eight AI calls per case per run.
 */
let cookieHeader: Promise<{ cookie: string; schoolId: string }> | null = null
function signIn() {
  cookieHeader ??= (async () => {
    const jar = new Map<string, string>()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    })
    const account = ACCOUNTS.columbiaValley
    const { data, error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password })
    if (error || !data.user) throw new Error(`sign-in failed for ${account.label}: ${error?.message ?? 'no user'}`)
    const { data: roles } = await supabase.from('user_roles').select('school_id, role').eq('user_id', data.user.id)
    const school = roles?.find((r) => r.school_id && (r.role === 'school_ceo' || r.role === 'school_editor'))
    if (!school) throw new Error(`${account.label} has no owner or editor role`)
    return { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; '), schoolId: school.school_id as string }
  })()
  return cookieHeader
}

const app: Transport = async (c) => {
  const { cookie, schoolId } = await signIn()
  const { request } = evalSchool(c, schoolId)
  const res = await fetch(`${BASE_URL}/api/advisory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(280_000),
  })
  if (!res.ok) throw new Error(`/api/advisory returned ${res.status}`)
  return { panel: (await res.json()) as Panel, context: given(request) }
}

/** EVAL_RESCORE=1: re-score the last run's saved answers (no AI calls), e.g. after changing a check. */
const RESCORE = process.env.EVAL_RESCORE === '1'
const saved: Transport = async (c, run) => {
  const file = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `case-${c.id}.json`), 'utf8')) as { records: RunRecord[]; target?: string }
  const record = file.records[run - 1]
  if (!record) throw new Error(`no saved run ${run} for ${c.id}`)
  return { panel: record.panel, context: given(evalSchool(c).request) }
}
const savedTarget = () => {
  try { return (JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'report.json'), 'utf8')) as { target: string }).target.replace(/( \(re-scored\))+$/, '') } catch { return 'saved answers' }
}

const savedRuns = () => {
  try { return (JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'report.json'), 'utf8')) as { runs: number }).runs } catch { return 1 }
}
const RUNS = RESCORE ? savedRuns() : Math.max(1, Number(process.env.EVAL_RUNS) || 1)

// AI_STUB=1 runs in-process on canned replies: checks the harness, not the advisors.
const transport: Transport | null = RESCORE ? saved : BASE_URL ? app : process.env.ANTHROPIC_API_KEY || process.env.AI_STUB === '1' ? direct : null
const target = RESCORE ? `${savedTarget()} (re-scored)` : BASE_URL ?? (process.env.AI_STUB === '1' ? 'in-process (AI stub)' : 'in-process')

interface RunRecord { run: number; checks: CheckResult[]; statuses: Record<string, string>; unmatchedFigures: string[]; panel: Panel }

test.describe.configure({ mode: 'parallel' })

for (const c of cases) {
  test(`${c.id}: ${c.planted}`, async () => {
    test.skip(!transport, 'Set EVAL_BASE_URL (a deployment) or ANTHROPIC_API_KEY (in-process) to run the advisor eval')
    const records: RunRecord[] = []
    for (let run = 1; run <= RUNS; run++) {
      let answer: Awaited<ReturnType<Transport>>
      try {
        answer = await transport!(c, run)
      } catch (err) {
        // Recorded as an empty panel, so the report still completes and shows the failure.
        answer = { panel: { briefing: '', agents: [] }, context: '' }
        console.error(`${c.id} run ${run}: ${err instanceof Error ? err.message : String(err)}`)
      }
      const { panel, context } = answer
      records.push({
        run,
        checks: scorePanel(c.id, panel),
        statuses: Object.fromEntries(panel.agents.map((a) => [a.id, a.failed ? 'failed' : a.status])),
        unmatchedFigures: unmatchedFigures(panel, context),
        panel,
      })
    }
    writeCase(c, records)
    // The eval reports rather than fails on a missed check (that is the measurement); it fails
    // only when the panel itself didn't come back.
    expect(records.every((r) => r.checks.find((k) => k.id === 'panel complete')?.pass)).toBe(true)
  })
}

/** Per-case file (parallel workers each write their own), then the summary merges them. */
function writeCase(c: EvalCase, records: RunRecord[]) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, `case-${c.id}.json`), JSON.stringify({ id: c.id, planted: c.planted, records }, null, 2))
}

test.afterAll(() => {
  if (!transport) return
  // Merge every case file in the output dir (other workers' too) into one report.
  const start = Number(fs.readFileSync(path.join(OUT_DIR, '.run-start'), 'utf8'))
  const files = fs.readdirSync(OUT_DIR).filter((f) => /^case-.+\.json$/.test(f) && fs.statSync(path.join(OUT_DIR, f)).mtimeMs >= start)
  if (files.length < cases.length) return // the last worker to finish writes the report
  // Claim the report so a worker finishing at the same moment doesn't write it again.
  try { fs.writeFileSync(path.join(OUT_DIR, `.report-${start}`), '', { flag: 'wx' }) } catch { return }
  const all = files.map((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')) as { id: string; records: RunRecord[] })
  const scores: Record<string, Record<string, string>> = {}
  for (const { id, records } of all) {
    scores[id] = {}
    for (const check of records[0].checks) {
      const passed = records.filter((r) => r.checks.find((k) => k.id === check.id)?.pass).length
      scores[id][check.id] = `${passed}/${records.length}`
    }
  }
  const statuses = Object.fromEntries(all.map(({ id, records }) => [id, Object.fromEntries(Object.keys(records[0].statuses).map((a) => [a, records.map((r) => r.statuses[a]).join('/')]))]))
  // No model field: changing AI_MODEL bumps PROMPT_VERSION, which already identifies the run.
  const report = { promptVersion: PROMPT_VERSION, target, runs: RUNS, at: new Date().toISOString(), scores, statuses }
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2))

  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as typeof report : null
  const lines = [`Advisor eval — ${PROMPT_VERSION}, ${RUNS} run(s) per case, ${target}`]
  for (const { id, records } of all) {
    lines.push(`\n${id}`)
    for (const check of records[0].checks) {
      const now = scores[id][check.id]
      const was = baseline?.scores?.[id]?.[check.id]
      const change = was && was !== now ? `   (baseline ${baseline!.promptVersion}: ${was})` : ''
      const details = records.map((r) => r.checks.find((k) => k.id === check.id)!).filter((k) => !k.pass).map((k) => k.detail)
      lines.push(`  ${now}  ${check.id}${change}${details.length ? ` — ${details[0]}` : ''}`)
    }
    const statuses = Object.keys(records[0].statuses).map((id) => `${id} ${records.map((r) => r.statuses[id] ?? '-').join('/')}`)
    lines.push(`  statuses: ${statuses.join(', ')}`)
    const figures = [...new Set(records.flatMap((r) => r.unmatchedFigures))]
    if (figures.length) lines.push(`  figures not given (often derived, e.g. $300 × 288; review): ${figures.join(', ')}`)
  }
  const summary = lines.join('\n')
  fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), summary)
  console.log(`\n${summary}\n\nFull answers: ${OUT_DIR}`)
  if (process.env.EVAL_UPDATE_BASELINE === '1') fs.writeFileSync(BASELINE, JSON.stringify(report, null, 2) + '\n')
})
