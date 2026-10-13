'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { setUnsaved } from '@/lib/unsavedChanges'

/**
 * Registers an editor's unsaved state with the app-wide leave guard (see unsavedChanges.ts).
 * `label` names the editor in the leave prompt, e.g. 'Startup funding'.
 */
export function useUnsavedChanges(dirty: boolean, label: string): void {
  const id = useId()
  useEffect(() => {
    setUnsaved(id, label, dirty)
  }, [id, label, dirty])
  useEffect(() => () => setUnsaved(id, label, false), [id, label])
}

/**
 * Dirty tracking against a saved snapshot, for editors whose local state doesn't compare
 * directly to the stored shape (defaults with fresh ids, values rebuilt from several tables).
 * Call `markSaved(value)` with the editor's state when it loads from the database and after a
 * successful Save; until the first call the editor is never dirty.
 */
export function useSavedSnapshot<T>(current: T) {
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const markSaved = useCallback((value: T) => setSnapshot(JSON.stringify(value)), [])
  const dirty = snapshot !== null && snapshot !== JSON.stringify(current)
  return { dirty, markSaved, hasSnapshot: snapshot !== null }
}
