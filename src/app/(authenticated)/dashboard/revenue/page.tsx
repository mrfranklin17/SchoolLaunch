'use client'

import { useState, useMemo, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { useScenario } from '@/lib/ScenarioContext'
import { calcCommissionRevenue, calcAAFTE, calcSmallSchoolEnhancement, calcSmallSchoolEnhancementFromGrades, SMALL_SCHOOL_THRESHOLDS } from '@/lib/calculations'
import { getGrantAllocationsForYear } from '@/lib/budgetEngine'
import { createClient } from '@/lib/supabase/client'
import type { StartupFundingSource } from '@/lib/types'
import { CUSTOM_REVENUE_PRESETS, type CustomLine, type CustomLineDriver } from '@/lib/customLines'
import { useStateConfig } from '@/contexts/StateConfigContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import GenericRevenueView from '@/components/dashboard/GenericRevenueView'
import Tooltip from '@/components/ui/Tooltip'
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/ui/DataTable'
import { formatCurrency } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { RevenueSkeleton } from '../_skeletons'
import { toast } from '@/components/ui/Toast'

const fmt = (n: number) => formatCurrency(n, 'accounting')

const FUNDING_TYPES: StartupFundingSource['type'][] = ['grant', 'donation', 'debt', 'other']
const FUNDING_STATUSES: StartupFundingSource['status'][] = ['received', 'pledged', 'applied', 'projected', 'n/a']

const DEFAULT_SOURCES: StartupFundingSource[] = [
  { source: 'WA Charter School Program (CSP) Grant', amount: 150000, type: 'grant', status: 'applied' },
  { source: 'Founder Savings / Personal Investment', amount: 50000, type: 'other', status: 'received' },
]

interface RevenueRow {
  label: string
  group: string
  formula: string
  calculated: number
  scenarioCalc: number
  helperNote?: string
}

export default function RevenuePage() {
  const { canEdit } = usePermissions()
  const { config: pathwayConfig } = useStateConfig()
  const {
    schoolData: { schoolId, schoolName, profile, loading, reload, gradeExpansionPlan },
    assumptions,
    isModified,
    scenarioInputs,
  } = useScenario()
  useDocumentTitle('Revenue', schoolName)
  const supabase = createClient()

  // Startup funding source state
  const [fundingSources, setFundingSources] = useState<StartupFundingSource[]>(
    profile.startup_funding && profile.startup_funding.length > 0
      ? profile.startup_funding
      : DEFAULT_SOURCES
  )
  const [savingFunding, setSavingFunding] = useState(false)

  // P-UX-17: editors must not be saveable until the profile has hydrated. On a cold
  // direct-load/refresh, the useState initializers above run during the loading-skeleton
  // render (before the async profile arrives), so they capture empty/default state.
  // Saving that would overwrite real data (e.g. the funding editor's actual grant with
  // DEFAULT_SOURCES). The effect below re-initializes both editors once the profile loads.
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

  // P-UX-17: hydrate both editors from the profile exactly once, after it loads.
  // Warm nav (profile already loaded at mount) hydrates on the first effect tick, so
  // behavior is unchanged; cold load hydrates once `loading` flips false. Guarded by
  // `hydrated` so later profile reloads (e.g. after Save) don't clobber local edits.
  useEffect(() => {
    if (loading || hydrated) return
    const cr = (profile as unknown as Record<string, unknown>).custom_revenue_lines
    setCustomRevLines(Array.isArray(cr) ? (cr as CustomLine[]) : [])
    setFundingSources(profile.startup_funding && profile.startup_funding.length > 0 ? profile.startup_funding : DEFAULT_SOURCES)
    setHydrated(true)
  }, [loading, hydrated, profile])

  const totalFunding = fundingSources.reduce((s, f) => s + f.amount, 0)
  const securedFunding = fundingSources
    .filter((f) => f.status === 'received' || f.status === 'pledged')
    .reduce((s, f) => s + f.amount, 0)

  function addSource() {
    setFundingSources((prev) => [...prev, { source: '', amount: 0, type: 'grant', status: 'projected', selectedYears: [], yearAllocations: {} }])
  }

  function removeSource(idx: number) {
    setFundingSources((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateSource(idx: number, field: keyof StartupFundingSource, value: string | number) {
    setFundingSources((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    )
  }

  function toggleYear(idx: number, year: number) {
    setFundingSources((prev) =>
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
    setFundingSources((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s
        return { ...s, yearAllocations: { ...(s.yearAllocations || {}), [year]: value } }
      })
    )
  }

  async function saveFunding() {
    if (!schoolId) return
    setSavingFunding(true)
    const { error } = await supabase
      .from('school_profiles')
      .update({ startup_funding: fundingSources })
      .eq('school_id', schoolId)
    setSavingFunding(false)
    if (error) {
      toast.error(`Save failed — startup funding not saved: ${error.message}`, { duration: Infinity })
      return
    }
    toast.success('Saved')
    await reload()
  }

  const baseEnrollment = profile.target_enrollment_y1
  const scenarioEnrollment = scenarioInputs.enrollment
  const aaftePct = assumptions.aafte_pct
  const regionFactor = assumptions.regionalization_factor || 1.0
  const baseAAFTE = calcAAFTE(baseEnrollment, aaftePct)
  const scenarioAAFTE = calcAAFTE(scenarioEnrollment, aaftePct)

  const baseRev = useMemo(() => calcCommissionRevenue(baseEnrollment, profile.pct_frl, profile.pct_iep, profile.pct_ell, profile.pct_hicap, assumptions), [baseEnrollment, profile, assumptions])
  const scenarioRev = useMemo(() => calcCommissionRevenue(scenarioEnrollment, profile.pct_frl, profile.pct_iep, profile.pct_ell, profile.pct_hicap, assumptions), [scenarioEnrollment, profile, assumptions])

  // Small School Enhancement — compute from grade expansion plan if available, else opening grades
  const baseSSE = useMemo(() => {
    if (gradeExpansionPlan && gradeExpansionPlan.length > 0) {
      return calcSmallSchoolEnhancement(gradeExpansionPlan, 1, aaftePct, assumptions.regular_ed_per_pupil, regionFactor, 1, assumptions.revenue_cola_pct)
    }
    const activeGrades = profile.opening_grades || []
    return calcSmallSchoolEnhancementFromGrades(baseEnrollment, activeGrades, aaftePct, assumptions.regular_ed_per_pupil, regionFactor)
  }, [gradeExpansionPlan, baseEnrollment, profile.opening_grades, aaftePct, assumptions, regionFactor])

  const scenarioSSE = useMemo(() => {
    if (gradeExpansionPlan && gradeExpansionPlan.length > 0) {
      // Scale students_per_section proportionally for scenario enrollment
      const ratio = baseEnrollment > 0 ? scenarioEnrollment / baseEnrollment : 1
      const scaledPlan = gradeExpansionPlan.map(e => ({ ...e, students_per_section: Math.round(e.students_per_section * ratio) }))
      return calcSmallSchoolEnhancement(scaledPlan, 1, aaftePct, assumptions.regular_ed_per_pupil, regionFactor, 1, assumptions.revenue_cola_pct)
    }
    const activeGrades = profile.opening_grades || []
    return calcSmallSchoolEnhancementFromGrades(scenarioEnrollment, activeGrades, aaftePct, assumptions.regular_ed_per_pupil, regionFactor)
  }, [gradeExpansionPlan, baseEnrollment, scenarioEnrollment, profile.opening_grades, aaftePct, assumptions, regionFactor])

  // Grant allocations for Year 1 — derived from local fundingSources (live edits) not profile.startup_funding (stale until save)
  const grantRows = useMemo(() => {
    const allocations = getGrantAllocationsForYear(fundingSources, 1)
    return allocations.map((a) => ({
      label: a.source,
      group: 'Startup & Other Grants',
      formula: `Year 1 allocation: ${fmt(a.amount)}`,
      calculated: a.amount,
      scenarioCalc: a.amount,
    }))
  }, [fundingSources])

  // Helper: show "base × factor = regionalized" when factor > 1
  function rateStr(base: number, regionalized: boolean = true): string {
    if (!regionalized || regionFactor === 1.0) return `$${base.toLocaleString()}`
    const effective = Math.round(base * regionFactor)
    return `$${base.toLocaleString()} × ${regionFactor} = $${effective.toLocaleString()}`
  }

  const spedStudents = Math.round(baseEnrollment * (profile.pct_iep / 100))

  const rows: RevenueRow[] = useMemo(() => [
    // State & Local
    {
      label: 'Regular Ed Apportionment',
      group: 'State & Local',
      formula: `${baseAAFTE} AAFTE × ${rateStr(assumptions.regular_ed_per_pupil)}`,
      calculated: baseRev.regularEd,
      scenarioCalc: scenarioRev.regularEd,
    },
    {
      label: 'SPED Apportionment',
      group: 'State & Local',
      formula: `${baseAAFTE} × ${profile.pct_iep}% IEP × ${rateStr(assumptions.sped_per_pupil)}`,
      calculated: baseRev.sped,
      scenarioCalc: scenarioRev.sped,
      helperNote: 'Excess cost allocation for special education students.',
    },
    {
      label: 'State Special Education',
      group: 'State & Local',
      formula: `${spedStudents} SPED students × ${rateStr(assumptions.state_sped_per_pupil || 13556)}`,
      calculated: baseRev.stateSped,
      scenarioCalc: scenarioRev.stateSped,
      helperNote: 'State safety net / BEA allocation for special education.',
    },
    {
      label: 'Levy Equity',
      group: 'State & Local',
      formula: `${baseAAFTE} AAFTE × $${assumptions.levy_equity_per_student.toLocaleString()}`,
      calculated: baseRev.levyEquity,
      scenarioCalc: scenarioRev.levyEquity,
      helperNote: 'Currently unfunded by legislature. If reinstated, set the per-student rate in Settings → Revenue Assumptions.',
    },
    {
      label: 'Facilities Revenue',
      group: 'State & Local',
      formula: `${baseAAFTE} × $${assumptions.facilities_per_pupil}`,
      calculated: baseRev.facilitiesRev,
      scenarioCalc: scenarioRev.facilitiesRev,
    },
    {
      label: 'Small School Enhancement',
      group: 'State & Local',
      formula: baseSSE > 0
        ? `Enhancement for grade bands below prototypical minimums (K-6: ${SMALL_SCHOOL_THRESHOLDS.k6}, 7-8: ${SMALL_SCHOOL_THRESHOLDS.ms}, 9-12: ${SMALL_SCHOOL_THRESHOLDS.hs} AAFTE)`
        : `All grade bands exceed minimums (K-6: ${SMALL_SCHOOL_THRESHOLDS.k6}, 7-8: ${SMALL_SCHOOL_THRESHOLDS.ms}, 9-12: ${SMALL_SCHOOL_THRESHOLDS.hs} AAFTE)`,
      calculated: baseSSE,
      scenarioCalc: scenarioSSE,
      helperNote: 'Additional funding when enrollment is below prototypical minimums per grade band.',
    },
    // Federal (not regionalized)
    {
      label: 'Title I',
      group: 'Federal',
      formula: profile.pct_frl > 40
        ? `${baseEnrollment} × ${profile.pct_frl}% FRL × $${(assumptions.title_i_per_pupil || 880).toLocaleString()}`
        : 'FRL must exceed 40% to qualify',
      calculated: baseRev.titleI,
      scenarioCalc: scenarioRev.titleI,
    },
    {
      label: 'IDEA (Federal Special Ed)',
      group: 'Federal',
      formula: `${baseEnrollment} × ${profile.pct_iep}% IEP × $${(assumptions.idea_per_pupil || 1500).toLocaleString()}`,
      calculated: baseRev.idea,
      scenarioCalc: scenarioRev.idea,
    },
    // State Categorical
    {
      label: 'LAP (Learning Assistance)',
      group: 'State Categorical',
      formula: `${baseEnrollment} × ${profile.pct_frl}% FRL × $${(assumptions.lap_per_pupil || 816).toLocaleString()}`,
      calculated: baseRev.lap,
      scenarioCalc: scenarioRev.lap,
    },
    {
      label: 'LAP High Poverty',
      group: 'State Categorical',
      formula: `${baseEnrollment} × ${profile.pct_frl}% FRL × $${(assumptions.lap_high_poverty_per_pupil || 374).toLocaleString()}`,
      calculated: baseRev.lapHighPoverty,
      scenarioCalc: scenarioRev.lapHighPoverty,
      helperNote: '50% FRL threshold required; allocation scales with FRL percentage.',
    },
    {
      label: 'TBIP (Bilingual)',
      group: 'State Categorical',
      formula: `${baseEnrollment} × ${profile.pct_ell}% ELL × $${(assumptions.tbip_per_pupil || 1600).toLocaleString()}`,
      calculated: baseRev.tbip,
      scenarioCalc: scenarioRev.tbip,
    },
    {
      label: 'Highly Capable',
      group: 'State Categorical',
      formula: `${baseEnrollment} × ${profile.pct_hicap}% HiCap × $${(assumptions.hicap_per_pupil || 730).toLocaleString()}`,
      calculated: baseRev.hicap,
      scenarioCalc: scenarioRev.hicap,
    },
    // Program Revenue (only when programs are enabled)
    ...(assumptions.food_service_offered ? [{
      label: 'Food Service (NSLP)',
      group: 'Program Revenue',
      formula: `${baseEnrollment} × $${(assumptions.food_service_revenue_per_pupil || 710).toLocaleString()}/student`,
      calculated: baseRev.foodServiceRev,
      scenarioCalc: scenarioRev.foodServiceRev,
      helperNote: 'NSLP reimbursement estimate. Actual rates depend on meal participation and FRL%. If you know your actual allocation, set the per-student rate in Settings → Operations Benchmarks.',
    }] : []),
    ...(assumptions.transportation_offered ? [{
      label: 'Transportation (State)',
      group: 'Program Revenue',
      formula: `${baseEnrollment} × $${(assumptions.transportation_revenue_per_pupil || 560).toLocaleString()}/student`,
      calculated: baseRev.transportationRev,
      scenarioCalc: scenarioRev.transportationRev,
      helperNote: 'State transportation allocation estimate. Actual amount determined by OSPI based on host district\'s prior-year allocation. If you know your district\'s actual figure, set the per-student rate in Settings → Operations Benchmarks.',
    }] : []),
  ], [baseEnrollment, scenarioEnrollment, baseAAFTE, spedStudents, profile, assumptions, baseRev, scenarioRev, regionFactor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Operating revenue = all recurring state/local + federal + state categorical
  const operatingBase = rows.reduce((sum, r) => sum + r.calculated, 0)
  const operatingScenario = rows.reduce((sum, r) => sum + r.scenarioCalc, 0)

  // Grant totals
  const grantBase = grantRows.reduce((sum, r) => sum + r.calculated, 0)
  const grantScenario = grantRows.reduce((sum, r) => sum + r.scenarioCalc, 0)

  // Total = operating + grants
  const totalBase = operatingBase + grantBase
  const totalScenario = operatingScenario + grantScenario

  // Group rows for display
  const groups = ['State & Local', 'Federal', 'State Categorical', 'Program Revenue']

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
        Headcount: <strong className="text-slate-600">{baseEnrollment} students</strong> | AAFTE: <strong className="text-slate-600">{baseAAFTE} students ({aaftePct}%)</strong>
        {regionFactor !== 1.0 && <> | Regionalization: <strong className="text-slate-600">{regionFactor}×</strong></>}
        <span className="ml-2 italic">State apportionment uses AAFTE. Federal programs use headcount.</span>
      </div>

      {isModified && (
        <div className="mb-4 bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 text-sm text-teal-700">
          Scenario active — enrollment adjusted to <strong>{scenarioEnrollment}</strong> students (AAFTE: {scenarioAAFTE}).
        </div>
      )}

      {(() => {
        type DTRow = RevenueRow & { rowKey: string }

        const operatingRows: DTRow[] = rows.map((r) => ({ ...r, rowKey: r.label }))
        const grantDTRows: DTRow[] = grantRows.map((r) => ({ ...r, rowKey: `grant:${r.label}` }))

        const dataRows: DataTableRow<DTRow>[] = []
        for (const group of groups) {
          const inGroup = operatingRows.filter((r) => r.group === group)
          if (inGroup.length === 0) continue
          dataRows.push({ type: 'header', key: `h-${group}`, label: group })
          for (const r of inGroup) dataRows.push({ type: 'item', key: r.label, data: r })
        }
        // Operating Revenue subtotal
        const opSubtotal: Record<string, ReactNode> = {
          base: fmt(operatingBase),
          scenario: fmt(operatingScenario),
          amount: fmt(isModified ? operatingScenario : operatingBase),
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
          base: fmt(grantBase),
          scenario: fmt(grantScenario),
          amount: fmt(isModified ? grantScenario : grantBase),
        }
        dataRows.push({ type: 'subtotal', key: 'grant-sub', label: 'Startup Grants Subtotal (Year 1)', values: grantSubtotal })

        const totalValues: Record<string, ReactNode> = {
          base: fmt(totalBase),
          scenario: fmt(totalScenario),
          amount: fmt(isModified ? totalScenario : totalBase),
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
          ...(isModified
            ? [{
                key: 'scenario',
                header: <span className="text-teal-600">Scenario</span>,
                numeric: true as const,
                render: (r: DTRow) => (
                  <span className={r.scenarioCalc !== r.calculated ? 'text-teal-600 font-medium' : 'text-slate-500'}>
                    {fmt(r.scenarioCalc)}
                  </span>
                ),
              }]
            : []),
          {
            key: 'amount',
            header: 'Amount',
            numeric: true,
            render: (r) => (
              <span className="font-medium text-slate-800">
                {fmt(isModified ? r.scenarioCalc : r.calculated)}
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
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Custom Revenue Lines</h2>
            <p className="text-xs text-slate-500 mt-0.5">Itemize additional WA Charter revenue (Title II/III, state food and transportation, OSPI grants). These flow into Multi-Year, the Commission Scorecard, and the Commission export.</p>
          </div>
          {canEdit && (
            <div className="flex gap-2 items-center">
              <select
                value={presetPick}
                onChange={(e) => setPresetPick(e.target.value)}
                disabled={!hydrated}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white disabled:opacity-50"
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

      {/* Funding Sources management — lifted out of the revenue table for Phase 2's
          DataTable consistency. Logically separate from the breakdown above. */}
      <div id="startup-grants" data-tour="startup-grants" className="bg-white border border-slate-200 rounded-xl shadow-sm mt-4 px-6 py-4 scroll-mt-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Startup &amp; Other Grants — Funding Sources</h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage funding sources and year-by-year allocations</p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button
                onClick={addSource}
                disabled={!hydrated}
                className="px-3 py-1.5 text-xs font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors disabled:opacity-50"
              >
                + Add Source
              </button>
              <button
                onClick={saveFunding}
                disabled={savingFunding || !hydrated}
                className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {savingFunding ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-500 mb-3">
          Allocate to Year 0 to make this source available for pre-opening expense assignment on the Cash Flow tab.
        </p>

        <div className="overflow-x-auto sl-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs">Source</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600 text-xs w-32">Total Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-24">Type</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-24">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs">Year Allocation</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {fundingSources.map((src, idx) => {
                const selected = src.selectedYears || []
                const allocs = src.yearAllocations || {}
                const allocTotal = selected.reduce((s, y) => s + (allocs[y] || 0), 0)
                const allocMismatch = selected.length > 0 && allocTotal !== src.amount
                return (
                  <tr key={idx} className="border-b border-slate-100 align-top bg-white">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={src.source}
                        onChange={(e) => updateSource(idx, 'source', e.target.value)}
                        placeholder="Funding source name..."
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step={1000}
                        value={src.amount}
                        onChange={(e) => updateSource(idx, 'amount', Number(e.target.value))}
                        disabled={!canEdit}
                        className="w-full text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={src.type}
                        onChange={(e) => updateSource(idx, 'type', e.target.value)}
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
                      >
                        {FUNDING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={src.status}
                        onChange={(e) => updateSource(idx, 'status', e.target.value)}
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
                      >
                        {FUNDING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 mb-1.5">
                        {[0, 1, 2, 3, 4].map((y) => (
                          <button
                            key={y}
                            onClick={() => toggleYear(idx, y)}
                            disabled={!canEdit}
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
                      {selected.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selected.map((y) => (
                            <div key={y} className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-400 font-medium w-5">Y{y}</span>
                              <input
                                type="number"
                                step={1000}
                                value={allocs[y] || 0}
                                onChange={(e) => updateYearAllocation(idx, y, Number(e.target.value))}
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
                      )}
                      {selected.length === 0 && (
                        <span className="text-[10px] text-slate-400">Select years above</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {canEdit && (
                        <Tooltip content="Remove">
                          <button
                            onClick={() => removeSource(idx)}
                            className="text-slate-400 hover:text-red-500 text-lg leading-none"
                            aria-label="Remove"
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
                <td className="px-3 py-2 text-right font-bold text-slate-800 text-xs">{fmt(totalFunding)}</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap gap-3 mt-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-xs">
            <span className="text-emerald-600 font-semibold">Secured:</span>
            <span className="text-emerald-700 font-bold ml-1">{fmt(securedFunding)}</span>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
            <span className="text-amber-600 font-semibold">Pending:</span>
            <span className="text-amber-700 font-bold ml-1">{fmt(totalFunding - securedFunding)}</span>
          </div>
        </div>

        {securedFunding < totalFunding * 0.5 && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
            <strong>Warning:</strong> Less than 50% of startup funding is secured (received or pledged).
            Authorizers typically want to see committed funding before approving a charter.
          </div>
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

