/**
 * User-facing messages for failed AI calls (Ask SchoolLaunch, Alignment Review, Scenarios
 * analysis). Every failure gets a visible message and a retry; none fails silently.
 */

/** Message for a non-OK response from an AI route, from its status and JSON `error` field. */
export function aiErrorMessage(status: number, serverError?: string | null): string {
  if (status === 401) return 'Your session has expired. Sign in again, then retry.'
  if (status === 403) return "Your role on this school can't run AI analysis. Ask the school owner for editor access."
  if (status === 413) return 'That request is too large to analyze. Try a shorter document.'
  if (status === 429) return 'Too many AI requests right now. Wait a minute, then retry.'
  if (serverError && /ANTHROPIC_API_KEY/.test(serverError)) return 'The AI assistant is not configured on this server.'
  if (status === 503 || status === 529) return serverError || 'The AI service is temporarily unavailable. Try again in a moment.'
  return 'Something went wrong while generating a response. Please try again.'
}

/** Read the `error` field of a failed response, tolerating non-JSON bodies. */
export async function readServerError(res: Response): Promise<string | null> {
  try {
    const text = await res.text()
    const parsed = JSON.parse(text) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : null
  } catch {
    return null
  }
}

export const NETWORK_ERROR_MESSAGE = 'Connection error. Check your network, then retry.'
export const EMPTY_RESPONSE_MESSAGE = 'No response came back from the AI service. Please try again.'
export const INTERRUPTED_MESSAGE = 'The response was cut off before it finished. Please try again.'

/**
 * /api/chat streams plain text and, when the model stream fails partway, appends
 * "\n\n[Error: …]" before closing. Split that marker off so it is never shown or saved as
 * part of an answer.
 */
export function splitStreamError(text: string): { text: string; error: string | null } {
  const m = text.match(/\n\n\[Error: ([\s\S]*)\]\s*$/)
  if (!m) return { text, error: null }
  return { text: text.slice(0, m.index).trimEnd(), error: m[1] || 'Stream error' }
}
