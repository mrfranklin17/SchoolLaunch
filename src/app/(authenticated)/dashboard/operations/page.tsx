'use client'

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import { runProjections, facilityPctOfRevenue } from '@/lib/budgetEngine'
import { evaluateFacilityPct } from '@/lib/healthThresholds'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/hooks/usePermissions'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useStateConfig } from '@/contexts/StateConfigContext'
import type { FinancialAssumptions } from '@/lib/types'
import { CUSTOM_EXPENSE_PRESETS, CUSTOM_EXPENSE_GROUPS, type CustomLine, type CustomLineDriver } from '@/lib/customLines'
import { readFacilityFinancing, annualDepreciation, annualInterest, type FacilityFinancing } from '@/lib/facilityFinancing'
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/ui/DataTable'
import { formatCurrency } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { OperationsSkeleton } from '../_skeletons'
import { Callout, type CalloutVariant } from '@/components/ui/Callout'
import { toast } from '@/components/ui/Toast'

const fmt = (n: number) => formatCurrency(n, 'accounting')

interface OpsRow {
  lineItem: string
  amount: number
  group: string
  /** The per-unit rate (per student or per FTE) — null for items without a rate */
  rate: number | null
  /** Whether the rate is per FTE (true) or per student (false) */
  perFte: boolean
  /** The assumptions key to sync the rate to */
  rateKey: keyof FinancialAssumptions | null
}

/** Maps line items to their per-pupil assumption key and whether it's per-FTE */
const RATE_MAP: Record<string, { key: keyof FinancialAssumptions; perFte: boolean }> = {
  'Supplies & Materials': { key: 'supplies_per_student', perFte: false },
  'Contracted Services': { key: 'contracted_services_per_student', perFte: false },
  'Technology': { key: 'technology_per_student', perFte: false },
  'Curriculum & Materials': { key: 'curriculum_per_student', perFte: false },
  'Professional Development': { key: 'professional_development_per_fte', perFte: true },
  'Marketing & Outreach': { key: 'marketing_per_student', perFte: false },
  'Food Service': { key: 'food_service_per_student', perFte: false },
  'Transportation': { key: 'transportation_per_student', perFte: false },
}

const GROUP_ORDER = [
  'Facilities & Occupancy',
  'Instructional',
  'Student Services',
  'Administrative',
  'Other',
]

function getGroup(lineItem: string): string {
  switch (lineItem) {
    case 'Facilities':
    case 'Insurance':
      return 'Facilities & Occupancy'
    case 'Supplies & Materials':
    case 'Technology':
    case 'Curriculum & Materials':
    case 'Professional Development':
      return 'Instructional'
    case 'Food Service':
    case 'Transportation':
      return 'Student Services'
    case 'Contracted Services':
    case 'Authorizer Fee':
    case 'Marketing & Outreach':
    case 'Fundraising':
      return 'Administrative'
    default:
      return 'Other'
  }
}

export default function OperationsPage() {
  const {
    schoolData: { schoolId, schoolName, profile, projections, positions, loading, reload },
    assumptions,
    projectionInputs,
    y1,
  } = useScenario()
  const { canEdit } = usePermissions()
  const { config: pathwayConfig } = useStateConfig()
  const authorizerFeeEditable = pathwayConfig.authorizer_fee_editable
  useDocumentTitle('Operations', schoolName)
  const [rows, setRows] = useState<OpsRow[]>([])
  const [saving, setSaving] = useState(false)
  const [advisoriesOpen, setAdvisoriesOpen] = useState(false)
  // Local overrides for per-pupil rates (synced to settings on save)
  const [rateOverrides, setRateOverrides] = useState<Partial<Record<keyof FinancialAssumptions, number>>>({})
  // P2-FU-01: unsaved edits to the table. Saving facility financing or a custom expense line
  // reloads school data, which would otherwise rebuild the rows from the database and silently
  // drop these edits (while their rate overrides lingered and were written by the next Save).
  const tableDirtyRef = useRef(false)
  const supabase = createClient()

  // R-REV-07 custom expense lines (WA Charter). New custom_expense_lines column.
  const [customExpLines, setCustomExpLines] = useState<CustomLine[]>([])
  const [savingCustomExp, setSavingCustomExp] = useState(false)
  const [expPresetPick, setExpPresetPick] = useState('')
  // P-UX-17: this editor is on a different page than the Revenue tab, so it needs its
  // own cold-load hydration guard. Save/Add stay disabled until the profile loads; the
  // effect then initializes from the loaded profile (cold direct-load would otherwise
  // let Save overwrite real custom_expense_lines with the unhydrated empty state).
  const [hydrated, setHydrated] = useState(false)
  // P-FIN-01/02: facility financing (single owned/financed facility). Shares the same
  // P-UX-17 cold-load hydration guard as custom expense lines, so Save stays disabled
  // until the profile loads (a cold direct-load would otherwise overwrite real
  // facility_financing with the unhydrated empty state).
  const [facilityFin, setFacilityFin] = useState<FacilityFinancing>({})
  const [savingFacility, setSavingFacility] = useState(false)
  useEffect(() => {
    if (loading || hydrated) return
    const ce = (profile as unknown as Record<string, unknown>).custom_expense_lines
    setCustomExpLines(Array.isArray(ce) ? (ce as CustomLine[]) : [])
    const ff = (profile as unknown as Record<string, unknown>).facility_financing
    setFacilityFin(ff && typeof ff === 'object' && !Array.isArray(ff) ? (ff as FacilityFinancing) : {})
    setHydrated(true)
  }, [loading, hydrated, profile])

  function updateFacility(field: keyof FacilityFinancing, value: number) {
    setFacilityFin((prev) => ({ ...prev, [field]: value }))
  }
  async function saveFacility() {
    if (!schoolId) return
    setSavingFacility(true)
    // Store null when there is neither a basis nor a principal, so lease schools keep a
    // clean NULL column (readFacilityFinancing treats both the same, but NULL is tidier).
    const norm = readFacilityFinancing(facilityFin)
    const payload = norm ? facilityFin : null
    const { error } = await supabase.from('school_profiles').update({ facility_financing: payload }).eq('school_id', schoolId)
    setSavingFacility(false)
    if (error) {
      toast.error(`Save failed — facility financing not saved: ${error.message}`, { duration: Infinity })
      return
    }
    toast.success('Saved')
    await reload()
  }
  // Read-only computed preview (pure helper; same math the engine uses).
  const facilityNorm = readFacilityFinancing(facilityFin)
  const facilityPreview = [1, 2, 3, 4, 5].map((y) => ({
    year: y,
    depreciation: facilityNorm ? annualDepreciation(facilityNorm, y) : 0,
    interest: facilityNorm ? annualInterest(facilityNorm, y) : 0,
  }))

  function newExpLineId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    return `ce-${Date.now()}`
  }
  function addCustomExpPreset() {
    const p = CUSTOM_EXPENSE_PRESETS.find((x) => x.name === expPresetPick)
    setCustomExpLines((prev) => [...prev, {
      id: newExpLineId(),
      name: p?.name ?? 'New Expense Line',
      group: p?.group ?? 'School Operations',
      driver: p?.driver ?? 'flat',
      amountY1: 0,
      rate: 0,
    }])
    setExpPresetPick('')
  }
  function updateCustomExp(idx: number, field: keyof CustomLine, value: string | number) {
    setCustomExpLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)))
  }
  function removeCustomExp(idx: number) {
    setCustomExpLines((prev) => prev.filter((_, i) => i !== idx))
  }
  async function saveCustomExpense() {
    if (!schoolId) return
    setSavingCustomExp(true)
    const { error } = await supabase.from('school_profiles').update({ custom_expense_lines: customExpLines }).eq('school_id', schoolId)
    setSavingCustomExp(false)
    if (error) {
      toast.error(`Save failed — custom expense lines not saved: ${error.message}`, { duration: Infinity })
      return
    }
    toast.success('Saved')
    await reload()
  }
  // Y1 subtotal excludes pct_revenue lines (their amount depends on revenue, computed in projections).
  const customExpY1Total = customExpLines.reduce((s, l) => s + (l.driver === 'pct_revenue' ? 0 : (Number(l.amountY1 ?? l.amount) || 0)), 0)

  const enrollment = profile.target_enrollment_y1
  const totalFte = positions.reduce((s, p) => s + p.fte, 0)
  const authorizerFeeY1 = y1.operations.authorizerFee

  /** Get the effective rate for a line item (override or assumption default) */
  function getRate(lineItem: string): number | null {
    const mapping = RATE_MAP[lineItem]
    if (!mapping) return null
    if (rateOverrides[mapping.key] !== undefined) return rateOverrides[mapping.key] as number
    return assumptions[mapping.key] as number
  }

  function getBenchmarkText(lineItem: string): string {
    const mapping = RATE_MAP[lineItem]
    if (!mapping) {
      if (lineItem === 'Facilities') return 'Varies by market'
      if (lineItem === 'Insurance') return `$${assumptions.insurance_annual.toLocaleString()}/yr typical`
      if (lineItem === 'Authorizer Fee') return `${assumptions.authorizer_fee_pct}% of state apportionment`
      if (lineItem === 'Misc/Contingency') return `${assumptions.contingency_pct}% of total expenses typical`
      if (lineItem === 'Fundraising') return `$${assumptions.fundraising_annual.toLocaleString()}/yr`
      return ''
    }
    const rate = getRate(lineItem) || 0
    const unit = mapping.perFte ? 'FTE' : 'student'
    const base = mapping.perFte ? totalFte : enrollment
    return `$${rate}/${unit} = ${fmt(rate * base)}`
  }

  /** Canonical list of ALL operation categories — always rendered, even at $0 */
  const ALL_OPS_CATEGORIES = [
    'Facilities',
    'Insurance',
    'Supplies & Materials',
    'Technology',
    'Curriculum & Materials',
    'Professional Development',
    'Food Service',
    'Transportation',
    'Contracted Services',
    'Marketing & Outreach',
    'Fundraising',
    'Authorizer Fee',
  ]

  useEffect(() => {
    if (tableDirtyRef.current) return
    const opsProjections = projections.filter((p) => !p.is_revenue && p.category === 'Operations')
    const existingByName = new Map(opsProjections.map((p) => [p.subcategory, p.amount]))

    // Build rows for every canonical category — use DB amount if present, else compute default or $0
    const baseRows: OpsRow[] = ALL_OPS_CATEGORIES.map((lineItem) => {
      const mapping = RATE_MAP[lineItem]
      const effectiveRate = mapping ? (assumptions[mapping.key] as number) : null
      const base = mapping?.perFte ? totalFte : enrollment

      // Authorizer Fee is the engine's Year-1 figure (same as Multi-Year) — the persisted
      // budget_projections value would drift whenever revenue mix or enrollment changes,
      // and the row is read-only in the UI, so no one can correct it manually.
      if (lineItem === 'Authorizer Fee') {
        return {
          lineItem,
          amount: authorizerFeeY1,
          group: getGroup(lineItem),
          rate: null,
          perFte: false,
          rateKey: null,
        }
      }

      // Use DB amount if present; if $0 and a per-pupil rate exists, compute default
      let amount = existingByName.get(lineItem) ?? 0
      if (amount === 0 && effectiveRate && effectiveRate > 0) {
        // Auto-populate from benchmark rate × base (enrollment or FTE)
        // For Food Service / Transportation, only populate if the program is enabled
        const isFood = lineItem === 'Food Service'
        const isTransport = lineItem === 'Transportation'
        if (isFood && !assumptions.food_service_offered) { /* leave at 0 */ }
        else if (isTransport && !assumptions.transportation_offered) { /* leave at 0 */ }
        else { amount = Math.round(effectiveRate * base) }
      }

      return {
        lineItem,
        amount,
        group: getGroup(lineItem),
        rate: effectiveRate,
        perFte: mapping?.perFte || false,
        rateKey: mapping?.key || null,
      }
    })

    baseRows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
    setRows(baseRows)
  }, [projections, enrollment, totalFte, assumptions, authorizerFeeY1])

  function updateAmount(idx: number, amount: number) {
    tableDirtyRef.current = true
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r
      // Back-calculate the rate from the new amount
      const mapping = RATE_MAP[r.lineItem]
      if (mapping) {
        const base = mapping.perFte ? totalFte : enrollment
        const newRate = base > 0 ? Math.round(amount / base) : 0
        setRateOverrides((o) => ({ ...o, [mapping.key]: newRate }))
        return { ...r, amount, rate: newRate }
      }
      return { ...r, amount }
    }))
  }

  function updateRate(idx: number, newRate: number) {
    tableDirtyRef.current = true
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r
      const mapping = RATE_MAP[r.lineItem]
      if (!mapping) return r
      const base = mapping.perFte ? totalFte : enrollment
      const newAmount = Math.round(newRate * base)
      setRateOverrides((o) => ({ ...o, [mapping.key]: newRate }))
      return { ...r, amount: newAmount, rate: newRate }
    }))
  }

  const totalOps = rows.reduce((s, r) => s + r.amount, 0)

  // Facility % comes from an engine row (facilities + depreciation + interest ÷ operating
  // revenue). When the table holds amounts that differ from the saved Year-1 rows, re-run the
  // engine with them overlaid so the advisory reflects unsaved edits; otherwise use y1.
  const facilityRow = useMemo(() => {
    const savedY1 = (sub: string) =>
      projections.find((p) => !p.is_revenue && p.year === 1 && p.subcategory === sub)?.amount ?? 0
    // Authorizer Fee is engine-computed; its stored row is never read.
    const edited = new Map(
      rows.filter((r) => r.lineItem !== 'Authorizer Fee' && r.amount !== savedY1(r.lineItem))
        .map((r) => [r.lineItem, r.amount]),
    )
    if (edited.size === 0) return y1
    const overlaid = projections.map((p) =>
      !p.is_revenue && p.year === 1 && edited.has(p.subcategory) ? { ...p, amount: edited.get(p.subcategory)! } : p,
    )
    for (const [subcategory, amount] of edited) {
      if (!overlaid.some((p) => !p.is_revenue && p.year === 1 && p.subcategory === subcategory)) {
        overlaid.push({ id: `local-${subcategory}`, school_id: schoolId ?? '', year: 1, category: 'Operations', subcategory, amount, is_revenue: false })
      }
    }
    return runProjections({ ...projectionInputs, projections: overlaid })[0]
  }, [rows, projections, projectionInputs, y1, schoolId])
  const facilityPct = facilityPctOfRevenue(facilityRow)

  async function save() {
    if (!schoolId) return
    setSaving(true)

    let hadError = false

    // Save operations projections
    for (const row of rows) {
      const { data: existing } = await supabase
        .from('budget_projections')
        .select('id')
        .eq('school_id', schoolId)
        .eq('year', 1)
        .eq('subcategory', row.lineItem)
        .eq('is_revenue', false)

      if (existing && existing.length > 0) {
        const { error } = await supabase.from('budget_projections')
          .update({ amount: row.amount })
          .eq('school_id', schoolId)
          .eq('year', 1)
          .eq('subcategory', row.lineItem)
          .eq('is_revenue', false)
        if (error) { console.error(`Update ${row.lineItem} failed:`, error); hadError = true }
      } else {
        const { error } = await supabase.from('budget_projections').insert({
          school_id: schoolId,
          year: 1,
          category: 'Operations',
          subcategory: row.lineItem,
          amount: row.amount,
          is_revenue: false,
        })
        if (error) { console.error(`Insert ${row.lineItem} failed:`, error); hadError = true }
      }
    }

    // Sync rate overrides to financial_assumptions in school_profiles
    if (Object.keys(rateOverrides).length > 0) {
      const merged = { ...(profile.financial_assumptions || {}), ...rateOverrides }
      const { error } = await supabase
        .from('school_profiles')
        .update({ financial_assumptions: merged })
        .eq('school_id', schoolId)
      if (error) { console.error('Failed to save assumptions:', error); hadError = true }
    }

    setSaving(false)
    if (hadError) {
      toast.error('Save failed — changes not saved. Check console for details.', { duration: Infinity })
    } else {
      toast.success('Saved')
      setRateOverrides({})
      // The rows are now the saved values: let the reload rebuild them from the database.
      tableDirtyRef.current = false
      await reload()
    }
  }

  if (loading) {
    return <OperationsSkeleton />
  }

  // Group rows
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    rows: rows.filter((r) => r.group === group),
    subtotal: rows.filter((r) => r.group === group).reduce((s, r) => s + r.amount, 0),
  })).filter((g) => g.rows.length > 0)

  return (
    <div className="animate-fade-in">
      {!canEdit && (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
          You have view-only access. Contact the school owner to request edit permissions.
        </div>
      )}
      <PageHeader
        title="Operations"
        subtitle="Non-personnel expenses for Year 1. Edit per-unit rates or totals — changes sync to Settings on save."
      />

      {/* Operations advisories — collapsed disclosure */}
      {(() => {
        type Advisory = { id: string; variant: CalloutVariant; title: string; body: ReactNode }
        const advisories: Advisory[] = []

        // Thresholds and copy come from src/lib/healthThresholds.ts (R-HEALTH-01)
        const facilityHealth = evaluateFacilityPct(facilityPct)
        const facilityVariant: CalloutVariant =
          facilityHealth.status === 'fails' ? 'crit' : facilityHealth.status === 'approaching' ? 'warn' : 'info'
        advisories.push({
          id: 'facility',
          variant: facilityVariant,
          title: `Facility cost: ${facilityPct.toFixed(1)}% of revenue`,
          body: facilityHealth.long,
        })

        if (assumptions.food_service_offered) {
          advisories.push({
            id: 'food',
            variant: 'info',
            title: 'Food Service',
            body: 'If 100% of students qualify for free meals, your school may be eligible for the Community Eligibility Provision (CEP), which provides USDA NSLP reimbursement that can offset food service costs. Update demographics in Settings.',
          })
        }

        if (assumptions.transportation_offered) {
          advisories.push({
            id: 'transport',
            variant: 'info',
            title: 'Transportation',
            body: 'WA charter schools must provide transportation services under RCW 28A.710.040. Document your transportation plan in your charter application. Consider contracted vs. in-house options.',
          })
        }

        if (advisories.length === 0) return null

        const counts: Record<CalloutVariant, number> = { info: 0, warn: 0, crit: 0 }
        for (const a of advisories) counts[a.variant]++
        const summaryBits: string[] = []
        if (counts.crit > 0) summaryBits.push(`${counts.crit} concern${counts.crit > 1 ? 's' : ''}`)
        if (counts.warn > 0) summaryBits.push(`${counts.warn} watch`)
        if (counts.info > 0) summaryBits.push(`${counts.info} info`)
        const summary = `${advisories.length} ${advisories.length === 1 ? 'advisory' : 'advisories'}${summaryBits.length ? ` · ${summaryBits.join(', ')}` : ''}`

        const dominant: CalloutVariant = counts.crit > 0 ? 'crit' : counts.warn > 0 ? 'warn' : 'info'
        const dominantDot = dominant === 'crit' ? 'bg-rose-500' : dominant === 'warn' ? 'bg-amber-500' : 'bg-blue-500'

        return (
          <div className="mb-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setAdvisoriesOpen(!advisoriesOpen)}
              aria-expanded={advisoriesOpen}
              className="w-full px-5 py-3 flex items-center justify-between text-left text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${dominantDot}`} aria-hidden="true" />
                {summary}
              </span>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${advisoriesOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {advisoriesOpen && (
              <div className="px-5 pb-4 pt-1 space-y-3 border-t border-slate-100">
                {advisories.map((a) => (
                  <Callout key={a.id} variant={a.variant} title={a.title}>
                    {a.body}
                  </Callout>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {(() => {
        type OpsDTRow = OpsRow & { globalIdx: number; isLocked: boolean }

        const dataRows: DataTableRow<OpsDTRow>[] = []
        for (const g of grouped) {
          dataRows.push({ type: 'header', key: `h-${g.group}`, label: g.group })
          for (const r of g.rows) {
            const globalIdx = rows.indexOf(r)
            const isLocked = r.lineItem === 'Authorizer Fee' && !authorizerFeeEditable
            dataRows.push({
              type: 'item',
              key: r.lineItem,
              data: { ...r, globalIdx, isLocked },
            })
          }
          dataRows.push({
            type: 'subtotal',
            key: `sub-${g.group}`,
            label: `Subtotal: ${g.group}`,
            values: { rate: '', benchmark: '', amount: fmt(g.subtotal) },
          })
        }
        dataRows.push({
          type: 'total',
          key: 'total',
          label: 'Total Operations',
          values: { rate: '', benchmark: '', amount: fmt(totalOps) },
        })

        const lockedCellClass = 'bg-slate-50/60'

        const renderExpense = (row: OpsDTRow): ReactNode => {
          if (row.isLocked) {
            return (
              <div data-tour={row.lineItem === 'Authorizer Fee' ? 'authorizer-fee' : undefined} className="flex items-center gap-2 flex-wrap font-medium text-slate-800">
                <svg aria-hidden="true" className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span>{row.lineItem}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">WA mandated</span>
              </div>
            )
          }
          return <span className="font-medium text-slate-800">{row.lineItem}</span>
        }

        const renderRate = (row: OpsDTRow): ReactNode => {
          const hasRate = row.rateKey !== null
          const unit = row.perFte ? '/FTE' : '/student'
          if (row.isLocked) {
            return <span className="font-tabular text-xs text-slate-500">{getBenchmarkText(row.lineItem).split('=')[0] || '—'}</span>
          }
          if (hasRate) {
            return (
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-xs">$</span>
                <input
                  type="number"
                  step={10}
                  min={0}
                  value={row.rate ?? 0}
                  onChange={(e) => updateRate(row.globalIdx, Number(e.target.value))}
                  disabled={!canEdit}
                  className="w-16 text-right border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
                />
                <span className="text-slate-400 text-xs">{unit}</span>
              </div>
            )
          }
          return <span className="font-tabular text-xs text-slate-400">{getBenchmarkText(row.lineItem).split('=')[0] || '—'}</span>
        }

        const renderBenchmark = (row: OpsDTRow): ReactNode => (
          <span className="text-xs text-slate-500">{getBenchmarkText(row.lineItem)}</span>
        )

        const renderAmount = (row: OpsDTRow): ReactNode => {
          const isAuthorizerFee = row.lineItem === 'Authorizer Fee'
          if (row.isLocked) {
            return <span className="font-tabular text-slate-700">{fmt(row.amount)}</span>
          }
          if (isAuthorizerFee) {
            return <span className="font-tabular text-slate-500">{fmt(row.amount)}</span>
          }
          return (
            <input
              type="number"
              step={1000}
              value={row.amount}
              onChange={(e) => updateAmount(row.globalIdx, Number(e.target.value))}
              disabled={!canEdit}
              className="w-32 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
            />
          )
        }

        const columns: DataTableColumn<OpsDTRow>[] = [
          { key: 'expense', header: 'Expense', align: 'left', render: renderExpense },
          {
            key: 'rate',
            header: <span data-tour="rate-column">Rate</span>,
            align: 'left',
            render: renderRate,
          },
          {
            key: 'benchmark',
            header: 'Benchmark',
            align: 'left',
            render: renderBenchmark,
            cellClassName: 'hidden sm:table-cell',
          },
          { key: 'amount', header: 'Amount', numeric: true, render: renderAmount },
        ]

        return (
          <div data-tour="operations-table" className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
            <DataTable columns={columns} rows={dataRows} caption="Year 1 operations breakdown" />
          </div>
        )
      })()}

      {/* R-REV-07: Custom Expense Lines editor (WA Charter). Flows into Multi-Year,
          the Commission Scorecard, and the Commission export via computeMultiYearDetailed. */}
      <div id="custom-expense" className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Custom Expense Lines</h2>
            <p className="text-xs text-slate-500 mt-0.5">Itemize non-personnel expenses (Contracted Services, School Operations, Facility O&amp;M) the way the Commission template does. These flow into Multi-Year, the Scorecard, and the Commission export.</p>
          </div>
          {canEdit && (
            <div className="flex gap-2 items-center">
              <select
                value={expPresetPick}
                onChange={(e) => setExpPresetPick(e.target.value)}
                disabled={!hydrated}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white disabled:opacity-50 max-w-[220px]"
              >
                <option value="">Add common line...</option>
                {CUSTOM_EXPENSE_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.group}: {p.name}</option>)}
              </select>
              <button
                onClick={addCustomExpPreset}
                disabled={!hydrated}
                className="px-3 py-1.5 text-xs font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors disabled:opacity-50"
              >
                + Add
              </button>
              <button
                onClick={saveCustomExpense}
                disabled={savingCustomExp || !hydrated}
                className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {savingCustomExp ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {customExpLines.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No custom expense lines yet. Use &quot;Add common line&quot; to pre-fill a V11 sub-line, or add your own. (Lines that duplicate a built-in category above are intentionally not in the picklist.)</p>
        ) : (
          <div className="overflow-x-auto sl-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs">Line Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-44">Group</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs w-40">Driver</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 text-xs w-36">Y1 Amount / Rate</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {customExpLines.map((l, idx) => (
                  <tr key={l.id ?? idx} className="border-b border-slate-100 bg-white">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={l.name ?? l.label ?? ''}
                        onChange={(e) => updateCustomExp(idx, 'name', e.target.value)}
                        placeholder="Expense line name..."
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={l.group ?? 'School Operations'}
                        onChange={(e) => updateCustomExp(idx, 'group', e.target.value)}
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                      >
                        {CUSTOM_EXPENSE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={l.driver ?? 'flat'}
                        onChange={(e) => updateCustomExp(idx, 'driver', e.target.value as CustomLineDriver)}
                        disabled={!canEdit}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                      >
                        <option value="per_pupil">Per Pupil</option>
                        <option value="per_fte">Per FTE</option>
                        <option value="flat">Flat</option>
                        <option value="inflation">Inflation-escalated</option>
                        <option value="pct_revenue">% of Revenue</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {l.driver === 'pct_revenue' ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step={0.5}
                            value={l.rate ?? 0}
                            onChange={(e) => updateCustomExp(idx, 'rate', Number(e.target.value))}
                            disabled={!canEdit}
                            className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50"
                          />
                          <span className="text-slate-400 text-xs">% of rev</span>
                        </div>
                      ) : (
                        <input
                          type="number"
                          step={1000}
                          value={l.amountY1 ?? l.amount ?? 0}
                          onChange={(e) => updateCustomExp(idx, 'amountY1', Number(e.target.value))}
                          disabled={!canEdit}
                          className="w-28 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {canEdit && (
                        <button onClick={() => removeCustomExp(idx)} className="text-red-400 hover:text-red-600 text-lg leading-none" aria-label="Remove line">&times;</button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-600" colSpan={3}>Custom Expense Subtotal (Year 1, excl. % of revenue)</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700">{fmt(customExpY1Total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-2 italic">Ratio drivers escalate by operations inflation ({assumptions.ops_escalator_pct}%/yr). &quot;% of Revenue&quot; (e.g. Management Company Fee) is computed against recurring operating revenue after revenue is finalized.</p>
          </div>
        )}
      </div>

      {/* P-FIN-01/02: Facility Financing (if applicable). Owned/financed schools model
          depreciation (basis / useful life) + debt interest (monthly amortization). These
          flow into Multi-Year, the Scorecard (depreciation is DCOH-neutral, interest
          lowers DCOH), and the Commission export. Lease schools leave this blank. */}
      <div id="facility-financing" className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Facility Financing (if applicable)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Only for schools that <strong>own or finance</strong> their building. Leave blank if you lease (your lease cost belongs in the Facilities line above). Depreciation and interest are computed below and flow into Multi-Year, the Scorecard, and the Commission export.</p>
          </div>
          {canEdit && (
            <button
              onClick={saveFacility}
              disabled={savingFacility || !hydrated}
              className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {savingFacility ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <h3 className="text-xs font-semibold text-slate-600 mb-2">Depreciation (owned asset)</h3>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>Building / improvement cost basis ($)</span>
                <input type="number" step={50000} value={facilityFin.basis ?? 0}
                  onChange={(e) => updateFacility('basis', Number(e.target.value))}
                  disabled={!canEdit || !hydrated}
                  className="w-36 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50" />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>Useful life (years)</span>
                <input type="number" step={1} value={facilityFin.useful_life ?? 30}
                  onChange={(e) => updateFacility('useful_life', Number(e.target.value))}
                  disabled={!canEdit || !hydrated}
                  className="w-36 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50" />
              </label>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-600 mb-2">Facility loan (debt interest)</h3>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>Loan principal ($)</span>
                <input type="number" step={50000} value={facilityFin.principal ?? 0}
                  onChange={(e) => updateFacility('principal', Number(e.target.value))}
                  disabled={!canEdit || !hydrated}
                  className="w-36 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50" />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>Interest rate (% / yr)</span>
                <input type="number" step={0.25} value={facilityFin.interest_rate ?? 0}
                  onChange={(e) => updateFacility('interest_rate', Number(e.target.value))}
                  disabled={!canEdit || !hydrated}
                  className="w-36 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50" />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>Loan term (years)</span>
                <input type="number" step={1} value={facilityFin.term_years ?? 30}
                  onChange={(e) => updateFacility('term_years', Number(e.target.value))}
                  disabled={!canEdit || !hydrated}
                  className="w-36 text-right border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50" />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>Financing starts in year</span>
                <select value={facilityFin.start_year ?? 1}
                  onChange={(e) => updateFacility('start_year', Number(e.target.value))}
                  disabled={!canEdit || !hydrated}
                  className="w-36 border border-slate-200 rounded px-2 py-1 text-sm bg-white disabled:bg-slate-50">
                  {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>Year {y}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto sl-scroll mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs">Computed (read-only)</th>
                {facilityPreview.map((p) => <th key={p.year} className="text-right px-3 py-2 font-semibold text-slate-600 text-xs">Year {p.year}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100 bg-white">
                <td className="px-3 py-2 text-xs text-slate-600">Depreciation (straight-line)</td>
                {facilityPreview.map((p) => <td key={p.year} className="px-3 py-2 text-right text-sm text-slate-700">{fmt(p.depreciation)}</td>)}
              </tr>
              <tr className="bg-white">
                <td className="px-3 py-2 text-xs text-slate-600">Interest (monthly amortization)</td>
                {facilityPreview.map((p) => <td key={p.year} className="px-3 py-2 text-right text-sm text-slate-700">{fmt(p.interest)}</td>)}
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-2 italic">Depreciation is non-cash: it lowers net income but not days of cash on hand. Interest is a cash cost and does reduce days of cash. Both appear as P&amp;L lines in the Commission export.</p>
        </div>
      </div>

      {canEdit && (
        <div
          data-testid="action-bar"
          className="sticky bottom-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-3 mt-4 bg-white border-t border-slate-200"
          style={{ boxShadow: 'var(--shadow-2)' }}
        >
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500" />
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

