/**
 * Centralized Anthropic client wrapper (Session 4, Track B2, AUDIT 5.5).
 *
 * Every api.anthropic.com call routes through here so retry behavior is
 * uniform across /api/advisory, /api/alignment, /api/chat, and
 * /api/export/narrative.
 *
 * Retry policy (the reason this wrapper exists — SDK defaults are close but
 * not exact):
 *   - Retry on 429, 529, 500, 502, 503, 504 and raw connection errors.
 *   - Do NOT retry on 400/401/403/404/408/409/422 — those signal a malformed
 *     or forbidden request, not a transient outage.
 *   - Max 3 retries (4 attempts total).
 *   - Backoff is 1s → 2s → 4s with ±20% jitter applied to each base.
 *   - When the server returns a `retry-after` or `retry-after-ms` header,
 *     that value overrides our computed backoff (standard HTTP semantics).
 *   - 60-second per-attempt timeout via the SDK's per-request `timeout` option.
 *
 * We explicitly set `maxRetries: 0` on the underlying Anthropic instance to
 * disable the SDK's built-in retry layer — otherwise retry bursts would stack.
 *
 * Streaming is retried on the initial open only. Once the stream is producing
 * events, a mid-flight failure surfaces to the caller as a partial response
 * (the UI then shows a retry button per the Session 4 brief).
 *
 * Errors that exhaust retries, or that come back as a retry-eligible status
 * on the final attempt, bubble out as `AIUnavailableError`. Route handlers
 * translate that to a 503 with a user-friendly message.
 */

import Anthropic from '@anthropic-ai/sdk'
import { aiStubEnabled, stubMessage, stubStream } from './aiStub'

type Message = Anthropic.Messages.Message
type MessageCreateParamsNonStreaming = Anthropic.Messages.MessageCreateParamsNonStreaming
type MessageStreamParams = Anthropic.Messages.MessageStreamParams

/**
 * The Claude model every AI route uses. Change it here only, and bump PROMPT_VERSION in
 * buildSchoolContext.ts so cached advisory briefings regenerate on the new model.
 *
 * Claude Sonnet 5.5 thinks by default (a `thinking: { type: 'disabled' }` request is a 400), so
 * routes control depth and latency with `output_config.effort` (default 'high') and size
 * `max_tokens` for the thinking as well as the reply. Responses can open with thinking
 * blocks: read them with `responseText`, never `content[0]`. Sampling parameters
 * (temperature, top_p) other than their defaults are rejected.
 */
export const AI_MODEL = 'claude-sonnet-5-5'

const RETRYABLE_STATUSES = new Set([429, 529, 500, 502, 503, 504])
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 60_000
const BACKOFF_BASES_MS = [1000, 2000, 4000]
const JITTER_RATIO = 0.2

/**
 * Shared client. maxRetries: 0 disables the SDK's internal retry so our
 * wrapper is the single source of truth for retry behavior.
 */
export const anthropicClient = new Anthropic({ maxRetries: 0 })

export class AIUnavailableError extends Error {
  readonly status?: number
  readonly requestId?: string
  readonly attempts: number
  readonly cause?: unknown

  constructor(message: string, opts: { status?: number; requestId?: string; attempts: number; cause?: unknown }) {
    super(message)
    this.name = 'AIUnavailableError'
    this.status = opts.status
    this.requestId = opts.requestId
    this.attempts = opts.attempts
    this.cause = opts.cause
  }
}

interface RetryOptions {
  maxRetries?: number
  timeoutMs?: number
  /** Hook for deterministic tests — defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeBackoffMs(attempt: number): number {
  const base = BACKOFF_BASES_MS[Math.min(attempt, BACKOFF_BASES_MS.length - 1)]
  const jitter = (Math.random() * 2 - 1) * JITTER_RATIO * base
  return Math.max(0, Math.round(base + jitter))
}

/**
 * Parse a retry-after-ms or retry-after header. retry-after-ms is Anthropic's
 * millisecond-precision variant; retry-after is standard HTTP (seconds).
 * Returns null if neither is present or parseable.
 */
function parseRetryAfter(headers: unknown): number | null {
  if (!headers) return null
  // SDK exposes Web Headers in v0.78
  let ms: string | null | undefined
  let secs: string | null | undefined
  if (typeof (headers as Headers).get === 'function') {
    ms = (headers as Headers).get('retry-after-ms')
    secs = (headers as Headers).get('retry-after')
  } else if (typeof headers === 'object') {
    const h = headers as Record<string, string | undefined>
    ms = h['retry-after-ms'] ?? h['Retry-After-Ms']
    secs = h['retry-after'] ?? h['Retry-After']
  }
  if (ms) {
    const n = Number(ms)
    if (Number.isFinite(n) && n >= 0) return n
  }
  if (secs) {
    const n = Number(secs)
    if (Number.isFinite(n) && n >= 0) return n * 1000
  }
  return null
}

function isRetryable(err: unknown): { retryable: boolean; status?: number; requestId?: string; headers?: unknown } {
  // Connection errors (including timeout) are APIError subclasses with no
  // status — treat them as retryable regardless of the status allowlist.
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return { retryable: true }
  }
  if (err instanceof Anthropic.APIError) {
    const requestId = (err as { request_id?: string }).request_id
    if (err.status && RETRYABLE_STATUSES.has(err.status)) {
      return { retryable: true, status: err.status, requestId, headers: err.headers }
    }
    return { retryable: false, status: err.status, requestId, headers: err.headers }
  }
  return { retryable: false }
}

/**
 * Generic retry loop. Exported for tests so we can exercise the policy
 * without mocking the whole SDK.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const sleep = options.sleep ?? defaultSleep
  let lastErr: unknown
  let lastStatus: number | undefined
  let lastRequestId: string | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const info = isRetryable(err)
      lastStatus = info.status
      lastRequestId = info.requestId
      if (!info.retryable || attempt === maxRetries) break
      const retryAfter = parseRetryAfter(info.headers)
      const delay = retryAfter !== null ? retryAfter : computeBackoffMs(attempt)
      await sleep(delay)
    }
  }

  throw new AIUnavailableError(
    'AI temporarily unavailable — try again in a moment.',
    { status: lastStatus, requestId: lastRequestId, attempts: maxRetries + 1, cause: lastErr },
  )
}

/**
 * Non-streaming message call. Applies the full retry policy.
 */
export async function callAnthropic(
  params: MessageCreateParamsNonStreaming,
  options: RetryOptions = {},
): Promise<Message> {
  // Local e2e runs (AI_STUB=1, never in a production build): canned reply, no API call.
  if (aiStubEnabled()) return stubMessage(params)
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return withRetry(() => anthropicClient.messages.create(params, { timeout }), options)
}

/**
 * Streaming message call. Retry applies ONLY to the initial open; once the
 * stream is producing events, mid-flight failures bubble to the caller
 * unchanged (surfaces as a partial response in the UI).
 */
export async function streamAnthropic(
  params: MessageStreamParams,
  options: RetryOptions = {},
): Promise<ReturnType<typeof anthropicClient.messages.stream>> {
  if (aiStubEnabled()) return stubStream(params) as unknown as ReturnType<typeof anthropicClient.messages.stream>
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return withRetry(() => Promise.resolve(anthropicClient.messages.stream(params, { timeout })), options)
}

/** The model declined the request (stop_reason 'refusal'); its output must not be used. */
export class AIRefusalError extends Error {
  constructor() {
    super('The AI declined this request.')
    this.name = 'AIRefusalError'
  }
}

/**
 * The reply's text: every text block joined, thinking blocks skipped. Throws AIRefusalError
 * when the model declined, so a refusal is never mistaken for an answer.
 */
export function responseText(message: Pick<Message, 'content' | 'stop_reason'>): string {
  if (message.stop_reason === 'refusal') throw new AIRefusalError()
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
}

/**
 * Parse a structured-output reply (`output_config.format` with a JSON schema). Returns null
 * when the reply was cut off at max_tokens or is not valid JSON; throws on refusal.
 */
export function responseJson<T>(message: Pick<Message, 'content' | 'stop_reason'>): T | null {
  const text = responseText(message)
  if (message.stop_reason === 'max_tokens' || !text.trim()) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
