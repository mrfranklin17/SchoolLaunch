'use client'

import { useEffect, useState } from 'react'
import { usePermissions } from '@/hooks/usePermissions'
import { useSavedSnapshot, useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { useScenario } from '@/lib/ScenarioContext'
import { createClient } from '@/lib/supabase/client'
import { canonicalizeStartupFunding } from '@/lib/startupFunding'
import {
  FUNDING_STATUSES,
  FUNDING_STATUS_LABELS,
  FUNDING_TYPES,
  FUNDING_TYPE_LABELS,
  summarizeStartupFunding,
} from '@/lib/fundingLabels'
import type { StartupFundingSource } from '@/lib/types'
import { formatCurrency } from '@/lib/format'
import { toast } from '@/components/ui/Toast'
import Tooltip from '@/components/ui/Tooltip'
import { UnsavedIndicator } from '@/components/ui/UnsavedIndicator'

const fmt = (n: number) => formatCurrency(n, 'accounting')

/** Suggested starting rows, shown to editors when nothing is saved yet. Not modeled until saved. */
const DEFAULT_SOURCES: StartupFundingSource[] = [
  { source: 'WA Charter School Program (CSP) Grant', amount: 150000, type: 'grant', status: 'applied' },
  { source: 'Founder Savings / Personal Investment', amount: 50000, type: 'other', status: 'received' },
]

const YEARS = [0, 1, 2, 3, 4]

const inputCls =
  'w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600'

/**
 * Startup funding sources editor (P-UX-08). Loads and saves `school_profiles.startup_funding`
 * for the current school itself, then reloads the shared school data so every engine-driven
 * view (Overview, Revenue, Cash Flow, Multi-Year) picks up the change. Viewers see it read-only.
 * Canonical home: Settings → Startup Funding.
 */
export default function StartupFundingEditor() {
  const { canEdit } = usePermissions()
  const {
    schoolData: { schoolId, reload },
  } = useScenario()
  const [supabase] = useState(() => createClient())

  const [sources, setSources] = useState<StartupFundingSource[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [hasSaved, setHasSaved] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { dirty, markSaved } = useSavedSnapshot(sources)
  useUnsavedChanges(dirty, 'Startup funding')

  const loaded = !!schoolId && loadedFor === schoolId

  useEffect(() => {
    if (!schoolId) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('school_profiles')
        .select('startup_funding')
        .eq('school_id', schoolId)
        .limit(1)
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        return
      }
      const saved = canonicalizeStartupFunding(data?.[0]?.startup_funding)
      const initial = saved.length > 0 ? saved : DEFAULT_SOURCES
      setSources(initial)
      setHasSaved(saved.length > 0)
      setLoadError(null)
      markSaved(initial)
      setLoadedFor(schoolId)
    })()
    return () => {
      cancelled = true
    }
  }, [schoolId, supabase, markSaved])

  // Viewers never see the unsaved suggestions as if they were the school's sources.
  const rows = !canEdit && !hasSaved ? [] : sources
  const { total, secured, pending } = summarizeStartupFunding(rows)

  function addSource() {
    setSources((prev) => [...prev, { source: '', amount: 0, type: 'grant', status: 'projected', selectedYears: [], yearAllocations: {} }])
  }

  function removeSource(idx: number) {
    setSources((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateSource(idx: number, field: keyof StartupFundingSource, value: string | number) {
    setSources((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
  }

  function toggleYear(idx: number, year: number) {
    setSources((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s
        const selected = s.selectedYears || []
        const allocs = { ...(s.yearAllocations || {}) }
        let newSelected: number[]
        if (selected.includes(year)) {
          newSelected = selected.filter((y) => y !== year)
          delete allocs[year]
        } else {
          newSelected = [...selected, year].sort()
          const perYear = Math.round(s.amount / (newSelected.length || 1))
          for (const y of newSelected) allocs[y] = perYear
          const allocated = newSelected.slice(0, -1).reduce((sum, y) => sum + (allocs[y] || 0), 0)
          allocs[newSelected[newSelected.length - 1]] = s.amount - allocated
        }
        return { ...s, selectedYears: newSelected, yearAllocations: allocs }
      })
    )
  }

  function updateYearAllocation(idx: number, year: number, value: number) {
    setSources((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, yearAllocations: { ...(s.yearAllocations || {}), [year]: value } } : s))
    )
  }

  async function save() {
    if (!schoolId || !loaded) return
    const toSave = canonicalizeStartupFunding(sources)
    setSaving(true)
    const { error } = await supabase
      .from('school_profiles')
      .update({ startup_funding: toSave })
      .eq('school_id', schoolId)
    setSaving(false)
    if (error) {
      toast.error(`Save failed — startup funding not saved: ${error.message}`, { duration: Infinity })
      return
    }
    setSources(toSave)
    markSaved(toSave)
    setHasSaved(toSave.length > 0)
    toast.success('Saved')
    // Refresh the shared school data so the engine re-runs everywhere (Overview, Cash Flow, ...).
    await reload()
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Couldn&apos;t load startup funding sources: {loadError}
      </p>
    )
  }

  if (!loaded) {
    return <div className="h-24 rounded-lg bg-slate-50 animate-pulse" aria-label="Loading startup funding" />
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-xs text-slate-500 min-w-0 flex-1 basis-56">
          Allocate to Year 0 to make a source available for pre-opening expense assignment on the Cash Flow tab.
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addSource}
              className="px-3 py-1.5 text-xs font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
            >
              + Add Source
            </button>
            <UnsavedIndicator dirty={dirty} />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {canEdit && !hasSaved && sources === DEFAULT_SOURCES && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          Suggested starting sources — not saved yet. Edit them to match your plan, then Save to use them in your projections.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          {canEdit ? 'No funding sources. Use “+ Add Source” to add one.' : 'No startup funding sources have been added yet.'}
        </p>
      ) : (
        <div className="relative overflow-x-auto sl-scroll">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs min-w-[12rem]">Source</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600 text-xs w-32">Total Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-28">Type</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-36">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs">Year Allocation</th>
                <th className="px-3 py-2 w-8"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((src, idx) => {
                const selected = src.selectedYears || []
                const allocs = src.yearAllocations || {}
                const allocTotal = selected.reduce((s, y) => s + (allocs[y] || 0), 0)
                const allocMismatch = selected.length > 0 && allocTotal !== src.amount
                const rowLabel = src.source || `Source ${idx + 1}`
                return (
                  <tr key={idx} className="border-b border-slate-100 align-top bg-white">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={src.source}
                        onChange={(e) => updateSource(idx, 'source', e.target.value)}
                        placeholder="Funding source name..."
                        aria-label="Funding source name"
                        disabled={!canEdit}
                        className={inputCls}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step={1000}
                        value={src.amount}
                        onChange={(e) => updateSource(idx, 'amount', Number(e.target.value))}
                        aria-label={`${rowLabel} total amount`}
                        disabled={!canEdit}
                        className={`${inputCls} text-right`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={src.type}
                        onChange={(e) => updateSource(idx, 'type', e.target.value)}
                        aria-label={`${rowLabel} type`}
                        disabled={!canEdit}
                        className={inputCls}
                      >
                        {FUNDING_TYPES.map((t) => <option key={t} value={t}>{FUNDING_TYPE_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={src.status}
                        onChange={(e) => updateSource(idx, 'status', e.target.value)}
                        aria-label={`${rowLabel} status`}
                        disabled={!canEdit}
                        className={inputCls}
                      >
                        {FUNDING_STATUSES.map((s) => <option key={s} value={s}>{FUNDING_STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 mb-1.5">
                        {YEARS.map((y) => (
                          <button
                            key={y}
                            type="button"
                            onClick={() => toggleYear(idx, y)}
                            disabled={!canEdit}
                            aria-pressed={selected.includes(y)}
                            aria-label={`${rowLabel}: Year ${y}`}
                            className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${
                              selected.includes(y)
                                ? 'bg-teal-600 text-white'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            } disabled:opacity-50`}
                          >
                            Y{y}
                          </button>
                        ))}
                      </div>
                      {selected.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selected.map((y) => (
                            <div key={y} className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-400 font-medium w-5">Y{y}</span>
                              <input
                                type="number"
                                step={1000}
                                value={allocs[y] || 0}
                                onChange={(e) => updateYearAllocation(idx, y, Number(e.target.value))}
                                aria-label={`${rowLabel} Year ${y} allocation`}
                                disabled={!canEdit}
                                className="w-20 text-right border border-slate-200 rounded px-1.5 py-0.5 text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
                              />
                            </div>
                          ))}
                          {allocMismatch && (
                            <span className="text-[10px] text-amber-600 self-center">
                              ({fmt(allocTotal)} of {fmt(src.amount)})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">{canEdit ? 'Select years above' : 'No years allocated'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {canEdit && (
                        <Tooltip content="Remove">
                          <button
                            type="button"
                            onClick={() => removeSource(idx)}
                            className="text-slate-400 hover:text-red-500 text-lg leading-none"
                            aria-label={`Remove ${rowLabel}`}
                          >
                            &times;
                          </button>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200">
                <td className="px-3 py-2 font-bold text-slate-800 text-xs">Total</td>
                <td className="px-3 py-2 text-right font-bold text-slate-800 text-xs">{fmt(total)}</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 mt-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-xs">
              <span className="text-emerald-600 font-semibold">Secured:</span>
              <span className="text-emerald-700 font-bold ml-1">{fmt(secured)}</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
              <span className="text-amber-600 font-semibold">Pending:</span>
              <span className="text-amber-700 font-bold ml-1">{fmt(pending)}</span>
            </div>
          </div>

          {secured < total * 0.5 && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
              <strong>Warning:</strong> Less than 50% of startup funding is secured (Received or Pledged).
              Authorizers typically want to see committed funding before approving a charter.
            </div>
          )}
        </>
      )}
    </div>
  )
}
