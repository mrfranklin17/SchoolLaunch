/**
 * HTML escaping for server-built export pages (P2-FU-02).
 *
 * The narrative and portfolio PDF routes return HTML that the dashboard writes into a
 * same-origin window, so every string that did not come from our own number formatting
 * (school/org names, position titles, funding sources, AI and advisory text, request-body
 * fields) must pass through escapeHtml before it is interpolated, in text and attributes alike.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escapes & < > " ' for HTML text and quoted attributes. null/undefined render as ''. */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

/**
 * escapeHtml, then restores bare <strong> / </strong> tags (no attributes). For AI text we
 * ask to bold titles with <strong>: the bolding survives, every other tag renders as text.
 */
export function escapeHtmlKeepStrong(value: string | null | undefined): string {
  return escapeHtml(value).replace(/&lt;(\/?)strong&gt;/gi, '<$1strong>')
}
