/**
 * Unsaved-changes guard shared by the editor tabs (Revenue, Staffing, Operations, Cash Flow,
 * Settings). Each editor registers whether it holds unsaved edits; while any does, closing or
 * reloading the tab triggers the browser's leave prompt and an in-app link click asks first.
 *
 * One registry and one set of listeners for the whole app, so a page with several dirty
 * editors still asks once.
 */

const dirty = new Map<string, string>()
let installed = false

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave this page and discard them?'

/** Labels of the editors that currently hold unsaved edits. */
export function unsavedLabels(): string[] {
  return [...dirty.values()]
}

export function hasUnsavedChanges(): boolean {
  return dirty.size > 0
}

/** Ask before discarding unsaved edits. True when there are none or the user agrees to leave. */
export function confirmDiscardUnsaved(confirmFn: (msg: string) => boolean = (m) => window.confirm(m)): boolean {
  if (dirty.size === 0) return true
  const labels = unsavedLabels()
  const detail = labels.length > 0 ? `\n\nUnsaved: ${labels.join(', ')}.` : ''
  if (!confirmFn(LEAVE_MESSAGE + detail)) return false
  // The user chose to leave: nothing should ask again on the way out.
  dirty.clear()
  sync()
  return true
}

/** Register (dirty = true) or clear an editor's unsaved state. */
export function setUnsaved(id: string, label: string, isDirty: boolean): void {
  if (isDirty) dirty.set(id, label)
  else dirty.delete(id)
  sync()
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.size === 0) return
  e.preventDefault()
  // Legacy browsers need a return value to show the prompt (the text itself is ignored).
  e.returnValue = ''
}

/**
 * Same-origin link clicks (the sidebar, "Monthly detail →", etc.) are checked in the capture
 * phase, before Next's <Link> handler runs, so a cancelled click neither navigates nor
 * starts a client-side transition.
 */
function onClickCapture(e: MouseEvent) {
  if (dirty.size === 0 || e.defaultPrevented || e.button !== 0) return
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return // new tab/window: nothing is lost
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
  const url = new URL(a.href, window.location.href)
  if (url.origin !== window.location.origin) return
  if (url.pathname === window.location.pathname && url.search === window.location.search) return // in-page anchor
  if (!confirmDiscardUnsaved()) {
    e.preventDefault()
    e.stopPropagation()
  }
}

function sync() {
  if (typeof window === 'undefined') return
  if (dirty.size > 0 && !installed) {
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClickCapture, true)
    installed = true
  } else if (dirty.size === 0 && installed) {
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.removeEventListener('click', onClickCapture, true)
    installed = false
  }
}
