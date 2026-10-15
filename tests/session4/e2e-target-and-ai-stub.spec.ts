import { test, expect } from '@playwright/test'
import { assertE2eTargetAllowed, e2eTarget, PRODUCTION_APP_HOST, PRODUCTION_PROJECT_REF } from '../e2e-target'
import { AI_STUB_TEXT, aiStubEnabled, stubStream, stubValue } from '../../src/lib/aiStub'
import { callAnthropic, responseJson, responseText, streamAnthropic } from '../../src/lib/anthropic-client'

/**
 * T-INFRA-01 groundwork: the e2e production guard and the local AI stub.
 *
 * Run: npx playwright test tests/session4/e2e-target-and-ai-stub.spec.ts
 */

const PROD_DB = `https://${PRODUCTION_PROJECT_REF}.supabase.co`
const LOCAL_DB = 'http://127.0.0.1:54321'

test.describe('e2e target guard', () => {
  test('production when the database or the app is production', () => {
    expect(e2eTarget({ NEXT_PUBLIC_SUPABASE_URL: PROD_DB, PLAYWRIGHT_BASE_URL: 'http://localhost:3100' }).production).toBe(true)
    expect(e2eTarget({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_DB, PLAYWRIGHT_BASE_URL: `https://${PRODUCTION_APP_HOST}` }).production).toBe(true)
    expect(e2eTarget({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_DB, PLAYWRIGHT_BASE_URL: 'http://localhost:3100' }).production).toBe(false)
    // No base URL: the Playwright default, localhost.
    expect(e2eTarget({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_DB }).production).toBe(false)
  })

  test('refuses production without E2E_ALLOW_PRODUCTION=1, allows it with', () => {
    expect(() => assertE2eTargetAllowed({ NEXT_PUBLIC_SUPABASE_URL: PROD_DB })).toThrow(/E2E_ALLOW_PRODUCTION=1/)
    expect(() => assertE2eTargetAllowed({ NEXT_PUBLIC_SUPABASE_URL: PROD_DB, E2E_ALLOW_PRODUCTION: 'true' })).toThrow()
    expect(assertE2eTargetAllowed({ NEXT_PUBLIC_SUPABASE_URL: PROD_DB, E2E_ALLOW_PRODUCTION: '1' }).production).toBe(true)
    expect(assertE2eTargetAllowed({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_DB }).production).toBe(false)
  })
})

test.describe('AI stub', () => {
  // These tests set process.env; Playwright runs each spec file in its own worker.
  const saved = { stub: process.env.AI_STUB, nodeEnv: process.env.NODE_ENV }
  test.afterEach(() => {
    if (saved.stub === undefined) delete process.env.AI_STUB; else process.env.AI_STUB = saved.stub
    ;(process.env as Record<string, string | undefined>).NODE_ENV = saved.nodeEnv
  })
  const setEnv = (stub: string | undefined, nodeEnv: string) => {
    if (stub === undefined) delete process.env.AI_STUB; else process.env.AI_STUB = stub
    ;(process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv
  }

  test('on only with AI_STUB=1 outside a production build', () => {
    setEnv('1', 'development'); expect(aiStubEnabled()).toBe(true)
    setEnv('1', 'test'); expect(aiStubEnabled()).toBe(true)
    setEnv('1', 'production'); expect(aiStubEnabled()).toBe(false)
    setEnv(undefined, 'development'); expect(aiStubEnabled()).toBe(false)
    setEnv('true', 'development'); expect(aiStubEnabled()).toBe(false)
  })

  test('structured replies follow the request schema (advisor and alignment shapes)', async () => {
    setEnv('1', 'development')
    const agentSchema = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['strong', 'needs_attention', 'risk'] }, summary: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } } },
      required: ['status', 'summary', 'actions'],
    }
    const reply = await callAnthropic({
      model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }],
      output_config: { format: { type: 'json_schema', schema: agentSchema } },
    } as never)
    const parsed = responseJson<{ status: string; summary: string; actions: string[] }>(reply)
    expect(parsed).toEqual({ status: 'strong', summary: '[AI stub] summary', actions: ['[AI stub] actions'] })

    expect(stubValue({
      type: 'object',
      properties: {
        overallAlignment: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
        misalignments: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['critical'] }, title: { type: 'string' } } } },
      },
    })).toEqual({ overallAlignment: 'strong', misalignments: [{ severity: 'critical', title: '[AI stub] title' }] })
  })

  test('text and streamed replies: the canned paragraph (over 200 characters, with a dollar figure)', async () => {
    setEnv('1', 'development')
    const reply = await callAnthropic({ model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }] } as never)
    expect(responseText(reply)).toBe(AI_STUB_TEXT)
    expect(AI_STUB_TEXT.length).toBeGreaterThan(200)
    expect(AI_STUB_TEXT).toMatch(/\$\s?[\d,.]+/)

    let streamed = ''
    let stop = ''
    for await (const event of (await streamAnthropic({ model: 'claude-sonnet-5-5', max_tokens: 100, messages: [] } as never)) as unknown as ReturnType<typeof stubStream>) {
      if (event.type === 'content_block_delta') streamed += event.delta.text
      else stop = event.delta.stop_reason
    }
    expect(streamed).toBe(AI_STUB_TEXT)
    expect(stop).toBe('end_turn')
  })
})
