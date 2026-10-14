import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AI_MODEL, AIRefusalError, responseJson, responseText } from '../../src/lib/anthropic-client'
import { DECLINED_MESSAGE, INTERRUPTED_MESSAGE, streamFailureMessage } from '../../src/lib/aiErrors'

/**
 * Phase 5 (hygiene): one model constant for every AI route, and response handling for a model
 * that always thinks (replies can open with thinking blocks) and can decline (stop_reason
 * 'refusal').
 *
 * Run: npx playwright test tests/session4/phase5-hygiene.spec.ts
 */

type Reply = Parameters<typeof responseText>[0]
const thinking = { type: 'thinking', thinking: '', signature: 'sig' } as unknown as Reply['content'][number]
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Reply['content'][number]
const reply = (content: Reply['content'], stop_reason: Reply['stop_reason'] = 'end_turn'): Reply => ({ content, stop_reason })

test.describe('model constant', () => {
  test('every route takes the model from AI_MODEL (no hardcoded model ids)', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(name)) files.push(p)
      }
    }
    walk('src')
    const offenders = files.filter((f) => !f.endsWith('anthropic-client.ts') && /['"]claude-[a-z0-9-]+['"]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
    expect(AI_MODEL).toMatch(/^claude-/)
  })
})

test.describe('reading replies', () => {
  test('text is read past leading thinking blocks', () => {
    expect(responseText(reply([thinking, text('Your model shows'), text(' a healthy reserve.')]))).toBe('Your model shows a healthy reserve.')
    expect(responseText(reply([thinking]))).toBe('')
  })

  test('a refusal is never mistaken for an answer', () => {
    expect(() => responseText(reply([text('partial')], 'refusal'))).toThrow(AIRefusalError)
    expect(() => responseJson(reply([text('{}')], 'refusal'))).toThrow(AIRefusalError)
  })

  test('structured output parses; cut-off or empty replies are null', () => {
    const json = '{"status":"strong","summary":"Healthy.","actions":["Keep it up"]}'
    expect(responseJson(reply([thinking, text(json)]))).toEqual({ status: 'strong', summary: 'Healthy.', actions: ['Keep it up'] })
    expect(responseJson(reply([text(json.slice(0, 20))], 'max_tokens'))).toBeNull()
    expect(responseJson(reply([text('not json')]))).toBeNull()
    expect(responseJson(reply([thinking]))).toBeNull()
  })

  test('a declined chat answer gets its own message', () => {
    expect(streamFailureMessage('declined')).toBe(DECLINED_MESSAGE)
    expect(streamFailureMessage('overloaded')).toBe(INTERRUPTED_MESSAGE)
  })
})
