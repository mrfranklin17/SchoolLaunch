'use client'

import { useState, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { useScenario } from '@/lib/ScenarioContext'
import { SMALL_SCHOOL_THRESHOLDS } from '@/lib/calculations'
import { oneTimeGrantAllocationsForYear, runProjections, computeCarryForward, beginningCashOf } from '@/lib/budgetEngine'
import { createClient } from '@/lib/supabase/client'
import type { SchoolProfile } from '@/lib/types'
import { CUSTOM_REVENUE_PRESETS, type CustomLine, type CustomLineDriver } from '@/lib/customLines'
import { useStateConfig } from '@/contexts/StateConfigContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import GenericRevenueView from '@/components/dashboard/GenericRevenueView'
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/ui/DataTable'
import { formatCurrency } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { RevenueSkeleton } from '../_skeletons'
import { toast } from '@/components/ui/Toast'
import { UnsavedIndicator } from '@/components/ui/UnsavedIndicator'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { canonicalizeStartupFunding } from '@/lib/startupFunding'
import { fundingStatusLabel, isSecuredFunding, summarizeStartupFunding } from '@/lib/fundingLabels'

const fmt = (n: number) => formatCurrency(n, 'accounting')

interface RevenueRow {
  label: string
  group: string
  formula: string
  calculated: number
  helperNote?: string
}

export default function RevenuePage() {
  const { canEdit } = usePermissions()
  const { config: pathwayConfig } = useStateConfig()
  const {
    schoolData: { schoolId, schoolName, profile, loading, reload, gradeExpansionPlan },
    assumptions,
    projectionInputs,
    y1,
  } = useScenario()
  useDocumentTitle('Revenue', schoolName)
  const supabase = createClient()

  // P-UX-17: the custom-lines editor must not be saveable until the profile has hydrated. On a
  // cold direct-load/refresh, the useState initializer below runs during the loading-skeleton
  // render (before the async profile arrives), so it captures empty state. Saving that would
  // overwrite real data. The block below re-initializes the editor once the profile loads.
  const [hydrated, setHydrated] = useState(false)

  // R-REV-03 custom revenue lines (WA Charter). Reuses the existing column; the
  // Generic pathway's reader/writer are untouched.
  const [customRevLines, setCustomRevLines] = useState<CustomLine[]>(
    Array.isArray((profile as unknown as Record<string, unknown>).custom_revenue_lines)
      ? ((profile as unknown as Record<string, unknown>).custom_revenue_lines as CustomLine[])
      : []
  )
  const [savingCustomRev, setSavingCustomRev] = useState(false)
  const [presetPick, setPresetPick] = useState('')

  function newLineId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    return `cl-${Date.now()}`
  }
  function addCustomRevPreset() {
    const p = CUSTOM_REVENUE_PRESETS.find((x) => x.name === presetPick)
    setCustomRevLines((prev) => [...prev, {
      id: newLineId(),
      name: p?.name ?? 'New Revenue Line',
      group: p?.group ?? 'Other',
      driver: p?.driver ?? 'flat',
      amountY1: 0,
      recurring: true,
    }])
    setPresetPick('')
  }
  function updateCustomRev(idx: number, field: keyof CustomLine, value: string | number | boolean) {
    setCustomRevLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)))
  }
  function removeCustomRev(idx: number) {
    setCustomRevLines((prev) => prev.filter((_, i) => i !== idx))
  }
  async function saveCustomRevenue() {
    if (!schoolId) return
    setSavingCustomRev(true)
    const { error } = await supabase.from('school_profiles').update({ custom_revenue_lines: customRevLines }).eq('school_id', schoolId)
    setSavingCustomRev(false)
    if (error) {
      toast.error(`Save failed — custom revenue lines not saved: ${error.message}`, { duration: Infinity })
      return
    }
    toast.success('Saved')
    await reload()
  }
  const customRevY1Total = customRevLines.reduce((s, l) => s + (Number(l.amountY1 ?? l.amount) || 0), 0)

  // P-UX-17: hydrate the editor from the profile exactly once, after it loads.
  // Warm nav (profile already loaded at mount) hydrates on the first effect tick, so
  // behavior is unchanged; cold load hydrates once `loading` flips false. Guarded by
  // `hydrated` so later profile reloads (e.g. after Save) don't clobber local edits.
  // Runs during render (React's "adjust state when data arrives" pattern), not in an effect.
  if (!loading && !hydrated) {
    const cr = (profile as unknown as Record<string, unknown>).custom_revenue_lines
    setCustomRevLines(Array.isArray(cr) ? (cr as CustomLine[]) : [])
    setHydrated(true)
  }

  // Startup funding is edited in Settings → Startup Funding (P-UX-08); this tab shows a summary.
  const savedFunding = canonicalizeStartupFunding(profile.startup_funding)
  const fundingSummary = summarizeStartupFunding(savedFunding)

  // Year-1 revenue comes from the engine row (the same row Overview and Multi-Year show).
  // Custom revenue lines are edited on this page before Save, so when they differ from the
  // saved profile the engine is re-run with the local edits overlaid; otherwise this is y1.
  const savedCustomRev = (profile as unknown as Record<string, unknown>).custom_revenue_lines
  const customRevDirty = hydrated
    && JSON.stringify(customRevLines) !== JSON.stringify(Array.isArray(savedCustomRev) ? savedCustomRev : [])
  useUnsavedChanges(customRevDirty, 'Custom revenue lines')
  const revRow = useMemo(() => {
    if (!customRevDirty) return y1
    const liveProfile = { ...profile, custom_revenue_lines: customRevLines } as SchoolProfile
    return runProjections({
      ...projectionInputs,
      profile: liveProfile,
      startupFunding: liveProfile.startup_funding,
      preOpenCash: computeCarryForward(liveProfile),
    })[0]
  }, [customRevDirty, y1, profile, customRevLines, projectionInputs])

  const rev = revRow.revenue
  const enrollmentY1 = revRow.enrollment
  const aafteY1 = revRow.aafte
  const aaftePct = assumptions.aafte_pct
  const regionFactor = assumptions.regionalization_factor || 1.0

  // Grant allocations for Year 1 — from the same funding sources the engine row modeled
  // (CSP is listed with operating revenue instead when Settings counts it as operating, R-REV-04.)
  const grantRows: RevenueRow[] = oneTimeGrantAllocationsForYear(profile.startup_funding, 1, assumptions.csp_operating_revenue !== false).map((a) => ({
    label: a.source,
    group: 'Startup & Other Grants',
    formula: `Year 1 allocation: ${fmt(a.amount)}`,
    calculated: a.amount,
  }))

  // Per-student rate as resolved by getAssumptions (P-UX-26: an explicit $0 shows as $0)
  function usd(rate: number): string {
    return `$${(Number(rate) || 0).toLocaleString()}`
  }
  // Helper: show "base × factor = regionalized" when factor > 1
  function rateStr(base: number, regionalized: boolean = true): string {
    if (!regionalized || regionFactor === 1.0) return usd(base)
    const effective = Math.round((Number(base) || 0) * regionFactor)
    return `${usd(base)} × ${regionFactor} = $${effective.toLocaleString()}`
  }

  const spedStudents = Math.round(enrollmentY1 * (profile.pct_iep / 100))
  const customRev = rev.customRevenue ?? []

  // Rates are shown exactly as resolved by getAssumptions (P-UX-26: an explicit $0 is honored).
  const rows: RevenueRow[] = [
    // State & Local
    {
      label: 'Regular Ed Apportionment',
      group: 'State & Local',
      formula: `${aafteY1} AAFTE × ${rateStr(assumptions.regular_ed_per_pupil)}`,
      calculated: rev.regularEd,
    },
    {
      label: 'SPED Apportionment',
      group: 'State & Local',
      formula: `${aafteY1} × ${profile.pct_iep}% IEP × ${rateStr(assumptions.sped_per_pupil)}`,
      calculated: rev.sped,
      helperNote: 'Excess cost allocation for special education students.',
    },
    {
      label: 'State Special Education',
      group: 'State & Local',
      formula: `${spedStudents} SPED students × ${rateStr(assumptions.state_sped_per_pupil)}`,
      calculated: rev.stateSped,
      helperNote: 'State safety net / BEA allocation for special education.',
    },
    {
      label: 'Levy Equity',
      group: 'State & Local',
      formula: `${aafteY1} AAFTE × ${usd(assumptions.levy_equity_per_student)}`,
      calculated: rev.levyEquity,
      helperNote: 'Currently unfunded by legislature. If reinstated, set the per-student rate in Settings → Revenue Assumptions.',
    },
    {
      label: 'Facilities Revenue',
      group: 'State & Local',
      formula: `${aafteY1} × ${usd(assumptions.facilities_per_pupil)}`,
      calculated: rev.facilitiesRev,
    },
    {
      label: 'Small School Enhancement',
      group: 'State & Local',
      formula: gradeExpansionPlan.length === 0
        ? 'Computed from the grade expansion plan (none saved yet)'
        : rev.smallSchoolEnhancement > 0
          ? `Enhancement for grade bands below prototypical minimums (K-6: ${SMALL_SCHOOL_THRESHOLDS.k6}, 7-8: ${SMALL_SCHOOL_THRESHOLDS.ms}, 9-12: ${SMALL_SCHOOL_THRESHOLDS.hs} AAFTE)`
          : `All grade bands exceed minimums (K-6: ${SMALL_SCHOOL_THRESHOLDS.k6}, 7-8: ${SMALL_SCHOOL_THRESHOLDS.ms}, 9-12: ${SMALL_SCHOOL_THRESHOLDS.hs} AAFTE)`,
      calculated: rev.smallSchoolEnhancement,
      helperNote: 'Additional funding when enrollment is below prototypical minimums per grade band.',
    },
    // Federal (not regionalized)
    {
      label: 'Title I',
      group: 'Federal',
      formula: profile.pct_frl > 40
        ? `${enrollmentY1} × ${profile.pct_frl}% FRL × ${usd(assumptions.title_i_per_pupil)}`
        : 'FRL must exceed 40% to qualify',
      calculated: rev.titleI,
    },
    {
      label: 'IDEA (Federal Special Ed)',
      group: 'Federal',
      formula: `${enrollmentY1} × ${profile.pct_iep}% IEP × ${usd(assumptions.idea_per_pupil)}`,
      calculated: rev.idea,
    },
    // State Categorical
    {
      label: 'LAP (Learning Assistance)',
      group: 'State Categorical',
      formula: `${enrollmentY1} × ${profile.pct_frl}% FRL × ${usd(assumptions.lap_per_pupil)}`,
      calculated: rev.lap,
    },
    {
      label: 'LAP High Poverty',
      group: 'State Categorical',
      formula: `${enrollmentY1} × ${profile.pct_frl}% FRL × ${usd(assumptions.lap_high_poverty_per_pupil)}`,
      calculated: rev.lapHighPoverty,
      helperNote: 'Requires ≥ 50% FRL plus a 3-year FRPL history (new applicants do not yet qualify); scales with FRL share.',
    },
    {
      label: 'TBIP (Bilingual)',
      group: 'State Categorical',
      formula: `${enrollmentY1} × ${profile.pct_ell}% ELL × ${usd(assumptions.tbip_per_pupil)}`,
      calculated: rev.tbip,
    },
    {
      label: 'Highly Capable',
      group: 'State Categorical',
      formula: `${enrollmentY1} × ${profile.pct_hicap}% HiCap × ${usd(assumptions.hicap_per_pupil)}`,
      calculated: rev.hicap,
    },
    // Program Revenue (only when programs are enabled)
    ...(assumptions.food_service_offered ? [{
      label: 'Food Service (NSLP)',
      group: 'Program Revenue',
      formula: `${enrollmentY1} × ${usd(assumptions.food_service_revenue_per_pupil)}/student`,
      calculated: rev.foodServiceRev,
      helperNote: 'NSLP reimbursement estimate. Actual rates depend on meal participation and FRL%. If you know your actual allocation, set the per-student rate in Settings → Operations Benchmarks.',
    }] : []),
    ...(assumptions.transportation_offered ? [{
      label: 'Transportation (State)',
      group: 'Program Revenue',
      formula: `${enrollmentY1} × ${usd(assumptions.transportation_revenue_per_pupil)}/student`,
      calculated: rev.transportationRev,
      helperNote: 'State transportation allocation estimate. Actual amount determined by OSPI based on host district\'s prior-year allocation. If you know your district\'s actual figure, set the per-student rate in Settings → Operations Benchmarks.',
    }] : []),
    // Recurring custom revenue lines count toward Operating Revenue (engine customRevenue detail)
    ...customRev.filter((c) => c.recurring).map((c) => ({
      label: c.name,
      group: c.group,
      formula: c.id.startsWith('csp-') ? 'CSP grant, Year 1 allocation (operating revenue; see Settings)' : 'Custom revenue line (recurring)',
      calculated: c.amount,
    })),
  ]

  // One-time custom lines and interest income are non-operating; they complete Total Revenue
  const otherNonOperatingRows: RevenueRow[] = [
    ...customRev.filter((c) => !c.recurring).map((c) => ({
      label: c.name,
      group: 'Other Non-Operating',
      formula: 'Custom revenue line (one-time)',
      calculated: c.amount,
    })),
    ...(rev.interestIncome > 0 ? [{
      label: 'Interest Income',
      group: 'Other Non-Operating',
      formula: `${fmt(beginningCashOf(revRow))} opening cash × ${assumptions.interest_rate_on_cash}% × ½ year`,
      calculated: rev.interestIncome,
    }] : []),
  ]

  // Group rows for display (custom lines can also be grouped as 'Other')
  const groups = ['State & Local', 'Federal', 'State Categorical', 'Program Revenue', 'Other']

  if (loading) {
    return <RevenueSkeleton />
  }

  // Generic pathway: use GenericRevenueView component
  if (pathwayConfig.pathway !== 'wa_charter') {
    return (
      <div className="animate-fade-in">
        {!canEdit && (
          <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
            You have view-only access. Contact the school owner to request edit permissions.
          </div>
        )}
        <GenericRevenueView
          config={pathwayConfig}
          profile={profile as Parameters<typeof GenericRevenueView>[0]['profile']}
          enrollment={profile.target_enrollment_y1}
          startupFunding={profile.startup_funding}
          canEdit={canEdit}
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {!canEdit && (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
          You have view-only access. Contact the school owner to request edit permissions.
        </div>
      )}
      <PageHeader
        title="Revenue"
        subtitle={
          <>
            Commission-aligned revenue breakdown for Year 1. To change a rate, edit it in{' '}
            <Link href="/dashboard/settings#revenue-assumptions" className="text-teal-600 hover:text-teal-700 underline">
              Settings → Revenue Assumptions
            </Link>
            {' '}— rates flow through every tab and export. Add revenue that isn&apos;t listed as a custom revenue line below.
          </>
        }
      />
      <div className="text-xs text-slate-400 -mt-4 mb-6">
        Headcount: <strong className="text-slate-600">{enrollmentY1} students</strong> | AAFTE: <strong className="text-slate-600">{aafteY1} students ({aaftePct}%)</strong>
        {regionFactor !== 1.0 && <> | Regionalization: <strong className="text-slate-600">{regionFactor}×</strong></>}
        <span className="ml-2 italic">State apportionment uses AAFTE. Federal programs use headcount.</span>
      </div>

      {(() => {
        type DTRow = RevenueRow & { rowKey: string }

        const operatingRows: DTRow[] = rows.map((r, i) => ({ ...r, rowKey: `${r.group}:${r.label}:${i}` }))
        const grantDTRows: DTRow[] = grantRows.map((r, i) => ({ ...r, rowKey: `grant:${r.label}:${i}` }))
        const otherDTRows: DTRow[] = otherNonOperatingRows.map((r, i) => ({ ...r, rowKey: `other:${r.label}:${i}` }))

        const dataRows: DataTableRow<DTRow>[] = []
        for (const group of groups) {
          const inGroup = operatingRows.filter((r) => (groups.includes(r.group) ? r.group : 'Other') === group)
          if (inGroup.length === 0) continue
          dataRows.push({ type: 'header', key: `h-${group}`, label: group })
          for (const r of inGroup) dataRows.push({ type: 'item', key: r.rowKey, data: r })
        }
        // Operating Revenue subtotal — the engine's operating revenue (standard lines + recurring custom lines)
        const opSubtotal: Record<string, ReactNode> = {
          base: fmt(rev.operatingRevenue),
          amount: fmt(rev.operatingRevenue),
        }
        dataRows.push({ type: 'subtotal', key: 'op-sub', label: 'Operating Revenue', values: opSubtotal })

        // Startup & Other Grants
        dataRows.push({
          type: 'header',
          key: 'h-startup',
          label: (
            <>
              Startup &amp; Other Grants
              <span className="ml-2 font-normal normal-case text-[10px]">(one-time — not included in sustainability metrics)</span>
            </>
          ),
        })
        for (const r of grantDTRows) dataRows.push({ type: 'item', key: r.rowKey, data: r })
        const grantSubtotal: Record<string, ReactNode> = {
          base: fmt(rev.grantRevenue),
          amount: fmt(rev.grantRevenue),
        }
        dataRows.push({ type: 'subtotal', key: 'grant-sub', label: 'Startup Grants Subtotal (Year 1)', values: grantSubtotal })

        // Other non-operating revenue (one-time custom lines, interest income)
        if (otherDTRows.length > 0) {
          dataRows.push({
            type: 'header',
            key: 'h-other-nonop',
            label: (
              <>
                Other Non-Operating Revenue
                <span className="ml-2 font-normal normal-case text-[10px]">(not included in sustainability metrics)</span>
              </>
            ),
          })
          for (const r of otherDTRows) dataRows.push({ type: 'item', key: r.rowKey, data: r })
        }

        // Total = the engine's Year-1 total revenue (operating + grants + other non-operating)
        const totalValues: Record<string, ReactNode> = {
          base: fmt(rev.total),
          amount: fmt(rev.total),
        }
        dataRows.push({
          type: 'total',
          key: 'total',
          label: `Total Revenue ${grantRows.length > 0 ? '(incl. Grants)' : ''}`.trim(),
          values: totalValues,
        })

        const renderLabel = (row: DTRow) => (
          <div>
            <div className="font-medium text-slate-800">{row.label}</div>
            {row.helperNote && (
              <div className="text-[10px] text-slate-400 mt-0.5">{row.helperNote}</div>
            )}
          </div>
        )

        const columns: DataTableColumn<DTRow>[] = [
          { key: 'label', header: 'Revenue Source', align: 'left', render: renderLabel },
          {
            key: 'formula',
            header: 'Formula',
            align: 'left',
            render: (r) => (
              <span
                className="font-tabular text-[13px]"
                style={{ color: 'var(--text-secondary)' }}
              >
                {r.formula}
              </span>
            ),
          },
          { key: 'base', header: 'Base Case', numeric: true, render: (r) => <span className="text-slate-500">{fmt(r.calculated)}</span> },
          {
            key: 'amount',
            header: 'Amount',
            numeric: true,
            render: (r) => (
              <span className="font-medium text-slate-800">
                {fmt(r.calculated)}
              </span>
            ),
          },
        ]

        return (
          <div data-tour="revenue-table" className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <DataTable columns={columns} rows={dataRows} caption="Year 1 revenue breakdown" />
          </div>
        )
      })()}

      {/* R-REV-03: Custom Revenue Lines editor (WA Charter). Flows into Multi-Year,
          the Commission Scorecard, and the Commission export via computeMultiYearDetailed. */}
      <div id="custom-revenue" className="bg-white border border-slate-200 rounded-xl shadow-sm mt-4 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Custom Revenue Lines</h2>
            <p className="text-xs text-slate-500 mt-0.5">Itemize additional WA Charter revenue (Title II/III, state food and transportation, OSPI grants). These flow into Multi-Year, the Commission Scorecard, and the Commission export.</p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2 items-center min-w-0 max-w-full">
              <select
                value={presetPick}
                onChange={(e) => setPresetPick(e.target.value)}
                disabled={!hydrated}
                className="w-full sm:w-auto min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white disabled:opacity-50 max-w-full sm:max-w-[260px]"
              >
                <option value="">Add common line...</option>
                {CUSTOM_REVENUE_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <button
                onClick={addCustomRevPreset}
                disabled={!hydrated}
                className="px-3 py-1.5 text-xs font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors disabled:opacity-50"
              >
                + Add
              </button>
              <UnsavedIndicator dirty={customRevDirty} className="self-center" />
              <button
                onClick={saveCustomRevenue}
                disabled={savingCustomRev || !hydrated}
                className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {savingCustomRev ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {customRevLines.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No custom revenue lines yet. Use &quot;Add common line&quot; to pre-fill a WA Charter line, or add your own.</p>
        ) : (
          <div className="overflow-x-auto sl-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs">Line Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-40">Group</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-36">Driver</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 text-xs w-32">Year 1 Amount</th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600 text-xs w-24">Recurring</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {customRevLines.map((l, idx) => (
                  <tr key={l.id ?? idx} className="border-b border-slate-100 bg-white">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={l.name ?? l.label ?? ''}
                        onChange={(e) => updateCustomRev(idx, 'name', e.target.value)}
                        placeholder="Revenue line name..."
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={l.group ?? 'Other'}
                        onChange={(e) => updateCustomRev(idx, 'group', e.target.value)}
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                      >
                        {['State & Local', 'Federal', 'State Categorical', 'Program Revenue', 'Other'].map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={l.driver ?? 'flat'}
                        onChange={(e) => updateCustomRev(idx, 'driver', e.target.value as CustomLineDriver)}
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                      >
                        <option value="per_pupil">Per Pupil</option>
                        <option value="per_fte">Per FTE</option>
                        <option value="flat">Flat</option>
                        <option value="inflation">Inflation-escalated</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step={1000}
                        value={l.amountY1 ?? l.amount ?? 0}
                        onChange={(e) => updateCustomRev(idx, 'amountY1', Number(e.target.value))}
                        disabled={!canEdit}
                        className="w-28 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={l.recurring !== false}
                        onChange={(e) => updateCustomRev(idx, 'recurring', e.target.checked)}
                        disabled={!canEdit}
                        className="h-4 w-4 accent-teal-600"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {canEdit && (
                        <button onClick={() => removeCustomRev(idx)} className="text-red-400 hover:text-red-600 text-lg leading-none" aria-label="Remove line">&times;</button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-600" colSpan={3}>Custom Revenue Subtotal (Year 1)</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700">{fmt(customRevY1Total)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-2 italic">Recurring lines count toward Operating Revenue and the Total Margin metric; one-time lines are non-operating. Per-year values scale by the selected driver (revenue COLA {assumptions.revenue_cola_pct}%/yr).</p>
          </div>
        )}
      </div>

      {/* Startup funding summary. The editor lives in Settings → Startup Funding (P-UX-08);
          the id stays so older /dashboard/revenue#startup-grants links still land here. */}
      <div id="startup-grants" data-tour="startup-grants" className="bg-white border border-slate-200 rounded-xl shadow-sm mt-4 px-6 py-4 scroll-mt-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-700">Startup &amp; Other Grants — Funding Sources</h2>
            <p className="text-xs text-slate-500 mt-0.5">Year allocations feed the Startup &amp; Other Grants rows above and the Cash Flow tab.</p>
          </div>
          <Link
            href="/dashboard/settings#startup-funding"
            className="text-xs font-medium text-teal-600 hover:text-teal-700 underline whitespace-nowrap"
          >
            Manage in Settings → Startup Funding
          </Link>
        </div>

        {savedFunding.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No funding sources yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 text-sm">
              {savedFunding.map((f, i) => (
                <li key={`${f.source}:${i}`} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-700">{f.source || 'Unnamed source'}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        isSecuredFunding(f.status) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {fundingStatusLabel(f.status)}
                    </span>
                    <span className="font-medium text-slate-800 font-tabular">{fmt(f.amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-200 text-xs">
              <span className="font-bold text-slate-800">Total {fmt(fundingSummary.total)}</span>
              <span className="text-slate-500">
                Secured {fmt(fundingSummary.secured)} · Pending {fmt(fundingSummary.pending)}
              </span>
            </div>
          </>
        )}
      </div>

      {grantRows.length > 0 && (
        <div className="mt-3 text-xs text-slate-400 italic">
          Sustainability metrics (Personnel % of Revenue, Facility % of Revenue, Break-Even) use Operating Revenue as the denominator, excluding one-time grants.
        </div>
      )}
    </div>
  )
}

