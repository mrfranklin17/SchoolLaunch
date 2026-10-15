import type Anthropic from '@anthropic-ai/sdk'

type Message = Anthropic.Messages.Message
type MessageCreateParamsNonStreaming = Anthropic.Messages.MessageCreateParamsNonStreaming
type MessageStreamParams = Anthropic.Messages.MessageStreamParams

/**
 * Canned AI replies for local e2e runs (T-INFRA-01), so the suites can run without an
 * Anthropic key or spend. On only when AI_STUB=1 and the build is not production: `next build`
 * / `next start` and every Vercel deployment run with NODE_ENV=production, so the stub can't
 * switch on there even if the variable is set.
 *
 * callAnthropic / streamAnthropic (anthropic-client.ts) return these instead of calling the API.
 * Structured replies are generated from the request's own JSON schema, so every route gets a
 * reply of the shape it asked for; text replies are a fixed paragraph, long enough and with a
 * dollar figure, to satisfy the founder journey's AI checks. Every reply is marked "[AI stub]".
 */
export function aiStubEnabled(): boolean {
  return process.env.AI_STUB === '1' && process.env.NODE_ENV !== 'production'
}

export const AI_STUB_TEXT =
  '[AI stub] This is a canned reply for local testing; no model was called. ' +
  'Year 1 projected revenue is about $1,250,000 against $1,180,000 of expenses, leaving a ' +
  'modest surplus. Personnel is the largest cost; keep reserves above 30 days of cash and ' +
  'revisit enrollment assumptions before the Commission review.'

type JsonSchema = {
  type?: string
  enum?: unknown[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  minItems?: number
}

/** The smallest value that satisfies `schema`: first enum value, one array item, every property. */
export function stubValue(schema: JsonSchema | undefined, key = 'value'): unknown {
  if (!schema) return null
  if (schema.enum && schema.enum.length > 0) return schema.enum[0]
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, s]) => [k, stubValue(s, k)]))
    case 'array':
      return Array.from({ length: Math.max(1, schema.minItems ?? 1) }, () => stubValue(schema.items, key))
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'string':
      return `[AI stub] ${key}`
    default:
      return null
  }
}

function replyText(params: { output_config?: unknown }): string {
  const format = (params.output_config as { format?: { type?: string; schema?: JsonSchema } } | undefined)?.format
  return format?.type === 'json_schema' ? JSON.stringify(stubValue(format.schema)) : AI_STUB_TEXT
}

/** A complete non-streaming reply in the SDK's Message shape. */
export function stubMessage(params: MessageCreateParamsNonStreaming): Message {
  return {
    id: 'msg_ai_stub',
    type: 'message',
    role: 'assistant',
    model: params.model,
    content: [{ type: 'text', text: replyText(params), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Message
}

/** The stream events the chat route reads: text deltas, then the closing message_delta. */
export async function* stubStream(params: MessageStreamParams) {
  const text = replyText(params)
  for (let i = 0; i < text.length; i += 40) {
    yield { type: 'content_block_delta' as const, index: 0, delta: { type: 'text_delta' as const, text: text.slice(i, i + 40) } }
  }
  yield { type: 'message_delta' as const, delta: { stop_reason: 'end_turn' as const, stop_sequence: null }, usage: { output_tokens: 0 } }
}
