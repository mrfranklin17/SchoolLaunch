import { test, expect } from '@playwright/test'
import { WA_FACTS, waFact, type WaFactId } from '../../src/lib/waFacts'
import { AGENTS } from '../../src/app/api/advisory/route'
import { WA_KNOWLEDGE } from '../../src/app/api/chat/route'

/**
 * AI-EXP-01 step 2: WA facts come from one sourced module (src/lib/waFacts.ts).
 * Review record: docs/wa-facts-review.md (local; matches the repo's wa-*.md ignore rule).
 *
 * Run: npx playwright test tests/session4/wa-facts.spec.ts
 */

const ids = Object.keys(WA_FACTS) as WaFactId[]
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

test('every fact has text, a source, an as-of date and a status', () => {
  for (const id of ids) {
    const f = WA_FACTS[id]
    expect(f.text.length, id).toBeGreaterThan(20)
    expect(f.source.length, id).toBeGreaterThan(5)
    expect(isDate(f.asOf), `${id} asOf`).toBe(true)
    expect(['verified', 'decided', 'unreviewed']).toContain(f.status)
  }
})

test('no year-bound fact is past its review date', () => {
  const today = new Date().toISOString().slice(0, 10)
  const stale = ids.filter((id) => {
    const reviewBy = (WA_FACTS[id] as { reviewBy?: string }).reviewBy
    return reviewBy !== undefined && (!isDate(reviewBy) || reviewBy < today)
  })
  // A failure here means a rate, count or appropriation needs re-checking: update the fact's
  // text, source, asOf and reviewBy (and bump PROMPT_VERSION).
  expect(stale).toEqual([])
})

test('unreviewed facts are exactly the ones awaiting Travis (review doc section B)', () => {
  expect(ids.filter((id) => WA_FACTS[id].status === 'unreviewed').sort()).toEqual(['funding_channel', 'regular_ed_red_flag', 'sped_caseload'])
})

test('the prompts state the module\'s facts', () => {
  const prompt = (id: string) => AGENTS.find((a) => a.id === id)!.systemPrompt
  expect(prompt('commission_reviewer')).toContain(waFact('authorizer_fee'))
  expect(prompt('commission_reviewer')).toContain(waFact('levy_equity'))
  expect(prompt('commission_reviewer')).toContain(waFact('template_version'))
  expect(prompt('enrollment_realist')).toContain(waFact('funding_count'))
  expect(prompt('enrollment_realist')).toContain(waFact('small_school'))
  expect(prompt('enrollment_realist')).toContain(waFact('market_size'))
  expect(prompt('operations_analyst')).toContain(waFact('lunch_reimbursement'))
  expect(WA_KNOWLEDGE).toContain(waFact('funding_count'))
  expect(WA_KNOWLEDGE).toContain(waFact('apportionment_schedule'))
  expect(WA_KNOWLEDGE).toContain(waFact('authorizer_fee'))
})

// Claims corrected in review doc section A (and B1/B2) must not come back.
const CORRECTED = [
  /October enrollment count/i,
  /January true-up/i,
  /contractually fixed/i,
  /paradoxically/i,
  /~\$4\.50/,
  /4,500 students/,
  /V8/,
  /has not reinstated/i,
]

for (const pattern of CORRECTED) {
  test(`no prompt repeats a corrected claim: ${pattern}`, () => {
    const texts = [...AGENTS.map((a) => [a.id, a.systemPrompt] as const), ['ask_schoollaunch', WA_KNOWLEDGE] as const]
    expect(texts.filter(([, t]) => pattern.test(t)).map(([id]) => id)).toEqual([])
  })
}
