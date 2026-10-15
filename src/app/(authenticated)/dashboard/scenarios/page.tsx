'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import { createClient } from '@/lib/supabase/client'
import { scenarioBaseHash } from '@/lib/buildSchoolContext'
import { advisorySchoolType } from '@/lib/advisory'
import { scenarioMeetsCount, scenarioStatusKeys, type ScenarioAssumptions, type ScenarioResults, type ScenarioYearResult } from '@/lib/scenarioEngine'
import Tooltip from '@/components/ui/Tooltip'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatCurrency } from '@/lib/format'
import {
  evaluateDaysOfCash,
  evaluatePersonnelPct,
  fpfStageForYear,
  fromFpfStatus,
  getCurrentRatioBand,
  getDaysOfCashBand,
  getEnrollmentVarianceBand,
  getGenericPersonnelBand,
  getPersonnelHealthBand,
  getTotalMarginBand,
  healthColor,
  healthPathway,
  type HealthPathway,
  type HealthStatus,
} from '@/lib/healthThresholds'
import type { StateConfig } from '@/lib/stateConfig'
import { STATUS_LABELS } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { ScenariosSkeleton } from '../_skeletons'
import { Callout } from '@/components/ui/Callout'
import { toast } from '@/components/ui/Toast'
import {
  aiErrorMessage, readServerError, splitStreamError,
  EMPTY_RESPONSE_MESSAGE, NETWORK_ERROR_MESSAGE, streamFailureMessage,
} from '@/lib/aiErrors'

interface ScenarioRecord {
  id: string
  name: string
  assumptions: ScenarioAssumptions
  results: ScenarioResults | null
  ai_analysis: string | null
  base_data_hash: string | null
}

const SCENARIO_COLORS: Record<string, { accent: string; bg: string; border: string; text: string; pill: string }> = {
  Conservative: { accent: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', pill: 'bg-amber-100 text-amber-700' },
  'Base Case': { accent: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', pill: 'bg-blue-100 text-blue-700' },
  Optimistic: { accent: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', pill: 'bg-emerald-100 text-emerald-700' },
}

function assumptionsHash(scenarios: { assumptions: ScenarioAssumptions }[]): string {
  return scenarios.map(s => Object.values(s.assumptions).join(',')).join('|')
}

function scenarioLabel(s: { name: string; assumptions: ScenarioAssumptions }) {
  return `${s.name} (${Math.round(s.assumptions.enrollment_fill_rate * 100)}% Fill)`
}

const fmt = (n: number) => formatCurrency(n, 'compact')

function fmtDelta(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${formatCurrency(n, 'compact')}`
}

// R-HEALTH-01: colors follow the shared, year-aware bands of the school's pathway (scenario
// results come from the pathway's engine: WA Commission bands, or the generic benchmarks).
function reserveColor(days: number | undefined, year: number, hp: HealthPathway) {
  return healthColor(evaluateDaysOfCash(days, year, hp).status, 'twText')
}

function personnelColor(pct: number, year: number, hp: HealthPathway) {
  return healthColor(evaluatePersonnelPct(pct, year, hp).status, 'twText')
}

/** Lever labels and copy for the pathway's revenue model. */
function revenueLeverCopy(config: StateConfig): { label: string; tooltip: string; primaryRevenue: string } {
  if (config.pathway === 'wa_charter') {
    return { label: 'Per-Pupil Funding', tooltip: 'Adjustment to state per-pupil revenue rates (Regular Ed, SPED, Facilities)', primaryRevenue: 'Regular Ed Revenue' }
  }
  if (config.revenue_model === 'tuition') {
    return { label: 'Tuition Rate', tooltip: 'Adjustment to the tuition rate (financial aid stays the same share of tuition)', primaryRevenue: 'Net Tuition Revenue' }
  }
  return { label: 'Per-Pupil Funding', tooltip: 'Adjustment to the per-pupil funding rate', primaryRevenue: 'Per-Pupil Funding' }
}

/** Plain-language school type for the AI scenario prompt. */
function schoolNoun(config: StateConfig): string {
  return config.pathway === 'generic_private' ? 'private school' : config.pathway === 'generic_micro' ? 'micro school' : 'charter school'
}

function StatusPill({ status }: { status: HealthStatus }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${healthColor(status, 'twPill')}`}>{STATUS_LABELS[status]}</span>
}

function fpfBadge(status: string) {
  return <StatusPill status={fromFpfStatus(status)} />
}

/** First Stage 2 year — the FPF grid draws its stage divider before it. */
function isStage2Start(year: number) {
  return fpfStageForYear(year) === 2 && fpfStageForYear(year - 1) === 1
}

function Delta({ value, base, suffix = '', invert = false }: { value: number; base: number; suffix?: string; invert?: boolean }) {
  const diff = value - base
  if (Math.abs(diff) < 0.5 && !suffix) return null
  if (Math.abs(diff) < 0.05 && suffix === '%') return null
  const isZero = Math.abs(diff) < 0.5 && (suffix === ' students' || suffix === ' days') || Math.abs(diff) < 0.05 && suffix === '%' || Math.abs(diff) < 0.5 && !suffix
  const favorable = invert ? diff < 0 : diff > 0
  const sign = diff >= 0 ? '+' : ''
  const formatted = suffix === '%' ? `${sign}${diff.toFixed(1)}%`
    : suffix === ' days' ? `${sign}${Math.round(diff)} days`
    : suffix === ' students' ? `${sign}${Math.round(diff)} students`
    : fmtDelta(diff)
  const color = isZero ? 'text-slate-400' : favorable ? 'text-emerald-600' : 'text-rose-600'
  return <div className={`font-tabular text-[11px] mt-0.5 ${color}`}>{formatted}</div>
}

export default function ScenariosPage() {
  const { schoolData: { schoolId, schoolName, profile, allPositions, projections, gradeExpansionPlan, loading }, pathwayConfig } = useScenario()
  const isWaCharter = pathwayConfig.pathway === 'wa_charter'
  const hp = healthPathway(pathwayConfig.pathway)
  const revenueCopy = revenueLeverCopy(pathwayConfig)
  useDocumentTitle('Scenarios', schoolName)
  const supabase = createClient()
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([])
  const [activeTab, setActiveTab] = useState('Base Case')
  const [seeding, setSeeding] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ outcomes: true })
  const [stale, setStale] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiAssumptionsHash, setAiAssumptionsHash] = useState<string | null>(null)
  const [mobileScenario, setMobileScenario] = useState('Base Case')
  // One pending save per scenario, so adjusting two scenarios in quick succession saves both.
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Load scenarios from Supabase
  const loadScenarios = useCallback(async () => {
    if (!schoolId) return
    const { data } = await supabase
      .from('scenarios')
      .select('id, name, assumptions, results, ai_analysis, base_data_hash')
      .eq('school_id', schoolId)
      .eq('scenario_type', 'engine')
      .order('name')

    if (data && data.length > 0) {
      setScenarios(data as ScenarioRecord[])
      setAiAnalysis(data[0]?.ai_analysis || null)
      if (data[0]?.ai_analysis) {
        // The analysis's hash is set once, from the scenarios it was loaded with.
        setAiAssumptionsHash((prev) => prev ?? assumptionsHash(data as ScenarioRecord[]))
      }
      // Check staleness — the hash /api/scenarios/calculate stores (shares computeAdvisoryHash
      // with the advisory cache, so any input that regenerates advisory also re-runs scenarios).
      const currentHash = scenarioBaseHash({ profile, allPositions, projections, gradeExpansionPlan })
      if (data[0]?.base_data_hash && data[0].base_data_hash !== currentHash) {
        setStale(true)
      }
    }
  }, [schoolId, supabase, allPositions, projections, profile, gradeExpansionPlan])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount: state is set after the request resolves
    if (!loading) loadScenarios()
  }, [loading, loadScenarios])

  // Seed scenarios
  async function handleSeed() {
    setSeeding(true)
    const res = await fetch('/api/scenarios/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId }),
    })
    if (res.ok) {
      // Now calculate all
      await handleCalculateAll()
      await loadScenarios()
    }
    setSeeding(false)
  }

  // Calculate all scenarios
  async function handleCalculateAll() {
    setCalculating(true)
    setStale(false)
    await fetch('/api/scenarios/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId }),
    })
    await loadScenarios()
    setCalculating(false)
  }

  // Update a lever and recalculate (debounced)
  function updateLever(scenarioId: string, field: keyof ScenarioAssumptions, value: number) {
    setScenarios(prev => prev.map(s => {
      if (s.id !== scenarioId) return s
      return { ...s, assumptions: { ...s.assumptions, [field]: value } }
    }))

    const timers = saveTimersRef.current
    const pending = timers.get(scenarioId)
    if (pending) clearTimeout(pending)
    timers.set(scenarioId, setTimeout(async () => {
      timers.delete(scenarioId)
      const scenario = scenarios.find(s => s.id === scenarioId)
      if (!scenario) return
      const updated = { ...scenario.assumptions, [field]: value }
      const { error } = await supabase.from('scenarios').update({ assumptions: updated, updated_at: new Date().toISOString() }).eq('id', scenarioId)
      if (error) {
        toast.error(`Save failed — ${scenario.name} lever change not saved: ${error.message}`, { duration: Infinity })
        await loadScenarios()
        return
      }
      const res = await fetch('/api/scenarios/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, scenarioId }),
      })
      if (!res.ok) {
        toast.error(`Lever saved, but recalculating ${scenario.name} failed.`, {
          duration: Infinity,
          action: { label: 'Recalculate', onClick: () => { handleCalculateAll() } },
        })
      }
      await loadScenarios()
    }, 500))
  }

  // AI Analysis. The previous analysis stays saved (and comes back on screen) unless a new one
  // completes; any failure shows an error with Retry.
  async function handleAiAnalysis() {
    if (!scenarios.length) return
    const previous = aiAnalysis
    setAiLoading(true)
    setAiError(null)
    const fail = (message: string) => {
      setAiAnalysis(previous)
      setAiError(message)
    }
    try {
      const scenarioSummary = scenarios.map(s => {
        const y1 = s.results?.years?.['1']
        return `${s.name}: Enrollment ${y1?.enrollment || 'N/A'}, Revenue ${y1 ? fmt(y1.total_revenue) : 'N/A'}, Expenses ${y1 ? fmt(y1.total_expenses) : 'N/A'}, Net ${y1 ? fmt(y1.net_position) : 'N/A'}, ${y1?.reserve_days || 0} days cash, ${y1?.personnel_pct || 0}% personnel, Break-even ${y1?.break_even_enrollment || 'N/A'} students`
      }).join('\n')

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          messages: [{ role: 'user', content: isWaCharter
            ? `Analyze these three financial scenarios for my charter school and provide a 3-4 paragraph assessment. Which scenario should I present as primary to the Commission? What are the key risks?\n\n${scenarioSummary}`
            : `Analyze these three financial scenarios for my ${schoolNoun(pathwayConfig)} and provide a 3-4 paragraph assessment. Which scenario should I present as my primary plan${pathwayConfig.pathway === 'generic_charter' ? ' to my authorizer' : ' to my board and funders'}? What are the key risks?\n\n${scenarioSummary}` }],
          schoolContext: scenarioSummary,
          // The pathway's system prompt (WA Commission knowledge, or the generic advisor).
          pathway: pathwayConfig.pathway,
          schoolType: advisorySchoolType(pathwayConfig.pathway),
        }),
      })

      if (!res.ok || !res.body) {
        fail(aiErrorMessage(res.status, await readServerError(res)))
      } else {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let raw = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          raw += decoder.decode(value, { stream: true })
          setAiAnalysis(splitStreamError(raw).text)
        }
        const { text, error: streamError } = splitStreamError(raw)
        if (streamError || !text.trim()) {
          // Never save a cut-off or empty analysis over the previous one.
          fail(streamError ? streamFailureMessage(streamError) : EMPTY_RESPONSE_MESSAGE)
        } else {
          setAiAnalysis(text)
          setAiAssumptionsHash(assumptionsHash(scenarios))
          // Save to first scenario record
          if (scenarios[0]) {
            const { error } = await supabase.from('scenarios').update({ ai_analysis: text }).eq('id', scenarios[0].id)
            if (error) toast.error(`Analysis shown but not saved: ${error.message}`, { duration: Infinity })
          }
        }
      }
    } catch {
      fail(NETWORK_ERROR_MESSAGE)
    }
    setAiLoading(false)
  }

  const activeScenario = scenarios.find(s => s.name === activeTab)
  const hasResults = scenarios.some(s => s.results)
  const aiIsStale = aiAnalysis && aiAssumptionsHash && assumptionsHash(scenarios) !== aiAssumptionsHash

  function toggleGroup(group: string) {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }

  if (loading) {
    return <ScenariosSkeleton />
  }

  // Empty state
  if (scenarios.length === 0) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Scenario Engine"
          subtitle="Model conservative, base, and optimistic scenarios side-by-side."
          badges={
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
              Sandbox · changes don&apos;t affect your real model
            </span>
          }
        />
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2" style={{ fontFamily: 'var(--font-heading-var)' }}>Stress-Test Your Financial Model</h2>
            <p className="text-sm text-slate-500 mb-6">
              Model conservative, base, and optimistic scenarios to show {isWaCharter ? 'the Commission' : 'your board and funders'} you&apos;ve planned for different outcomes. We&apos;ll start with smart defaults based on your current financial plan.
            </p>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="bg-teal-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {seeding ? 'Building Scenarios...' : 'Build Scenarios'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const y1Results: Record<string, ScenarioYearResult | undefined> = {}
  for (const s of scenarios) {
    y1Results[s.name] = s.results?.years?.['1']
  }
  const baseY1 = y1Results['Base Case']

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Scenario Engine"
        subtitle="Model conservative, base, and optimistic scenarios side-by-side."
        badges={
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
            Sandbox · changes don&apos;t affect your real model
          </span>
        }
        actions={calculating ? (
          <div className="flex items-center gap-2 text-sm text-teal-600">
            <div className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            Recalculating...
          </div>
        ) : null}
      />

      {stale && (
        <div className="mb-4">
          <Callout variant="warn" title="Scenarios out of sync">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span>Your base financial model has changed since these scenarios were last calculated.</span>
              <button
                onClick={handleCalculateAll}
                disabled={calculating}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {calculating ? 'Recalculating...' : 'Recalculate All Scenarios'}
              </button>
            </div>
          </Callout>
        </div>
      )}

      {/* Section 1: Lever Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
        {/* Scenario tabs */}
        <div className="flex gap-2 mb-5">
          {scenarios.map(s => {
            const colors = SCENARIO_COLORS[s.name] || SCENARIO_COLORS['Base Case']
            const active = s.name === activeTab
            return (
              <button
                key={s.id}
                onClick={() => setActiveTab(s.name)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? `${colors.bg} ${colors.text} ${colors.border} border` : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {s.name}
              </button>
            )
          })}
        </div>

        {/* Lever grid */}
        {activeScenario && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <LeverControl
              label="Enrollment Fill Rate"
              tooltip="Percentage of projected enrollment seats that are actually filled"
              value={activeScenario.assumptions.enrollment_fill_rate}
              onChange={v => updateLever(activeScenario.id, 'enrollment_fill_rate', v)}
              min={0.70} max={1.00} step={0.01}
              format={v => `${Math.round(v * 100)}%`}
              warning={activeScenario.assumptions.enrollment_fill_rate < 0.80 ? (isWaCharter ? 'WA charter schools average 76% fill rate in Year 1' : 'Below 80% fill is a serious Year 1 enrollment shortfall') : activeScenario.assumptions.enrollment_fill_rate > 0.95 ? '95%+ fill rate is ambitious for a new school' : undefined}
            />
            <LeverControl
              label={revenueCopy.label}
              tooltip={revenueCopy.tooltip}
              value={activeScenario.assumptions.per_pupil_funding_adjustment}
              onChange={v => updateLever(activeScenario.id, 'per_pupil_funding_adjustment', v)}
              min={-0.10} max={0.05} step={0.01}
              format={v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`}
            />
            <LeverControl
              label="Personnel Costs"
              tooltip="Adjustment to total personnel costs (salary competitiveness, benefits, staffing levels)"
              value={activeScenario.assumptions.personnel_cost_adjustment}
              onChange={v => updateLever(activeScenario.id, 'personnel_cost_adjustment', v)}
              min={-0.10} max={0.15} step={0.01}
              format={v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`}
              warning={activeScenario.assumptions.personnel_cost_adjustment > 0.10
                ? (isWaCharter
                  ? `Personnel costs may rise above the healthy Year 1 range (${getPersonnelHealthBand(1).meetsLower}–${getPersonnelHealthBand(1).meetsUpper}% of operating revenue)`
                  : `Personnel costs may rise above the healthy benchmark (${getGenericPersonnelBand().target} of operating revenue)`)
                : undefined}
            />
            <LeverControl
              label="Monthly Facility Cost"
              tooltip="Monthly facility lease or mortgage payment"
              value={activeScenario.assumptions.facility_cost_monthly}
              onChange={v => updateLever(activeScenario.id, 'facility_cost_monthly', v)}
              min={0} max={50000} step={500}
              format={v => `$${v.toLocaleString()}/mo`}
              isCurrency
            />
            <LeverControl
              label="Startup Capital"
              tooltip="Total available startup funding (grants + donations + loans) that becomes Year 1 beginning cash"
              value={activeScenario.assumptions.startup_capital}
              onChange={v => updateLever(activeScenario.id, 'startup_capital', v)}
              min={0} max={1000000} step={10000}
              format={v => fmt(v)}
              isCurrency
            />
          </div>
        )}
      </div>

      {/* Section 2: Side-by-Side Comparison */}
      {hasResults && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6 overflow-hidden">
          {/* Mobile scenario selector */}
          <div className="lg:hidden flex gap-1 p-3 border-b border-slate-200">
            {scenarios.map(s => {
              const colors = SCENARIO_COLORS[s.name] || SCENARIO_COLORS['Base Case']
              return (
                <button key={s.id} onClick={() => setMobileScenario(s.name)}
                  className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${mobileScenario === s.name ? `${colors.bg} ${colors.text}` : 'text-slate-500 hover:bg-slate-50'}`}>
                  {scenarioLabel(s)}
                </button>
              )
            })}
          </div>

          {/* Header row — desktop: 4 cols, mobile: 2 cols */}
          <div className="hidden lg:grid grid-cols-4 border-b border-slate-200">
            <div className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Metric</div>
            {scenarios.map(s => {
              const colors = SCENARIO_COLORS[s.name] || SCENARIO_COLORS['Base Case']
              const isBase = s.name === 'Base Case'
              return (
                <div key={s.id} className={`px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide ${colors.accent} ${isBase ? 'bg-blue-50/50' : ''}`}>
                  {scenarioLabel(s)}
                </div>
              )
            })}
          </div>

          {/* Key Outcomes */}
          <GroupHeader label="Key Outcomes" group="outcomes" expanded={expandedGroups.outcomes} onToggle={toggleGroup} />
          {expandedGroups.outcomes && (
            <>
              <ComparisonRow label="Year 1 Enrollment" scenarios={scenarios} getValue={y1 => y1?.enrollment ?? 0} format={v => v.toLocaleString()} baseY1={baseY1} suffix=" students" />
              <ComparisonRow label="Total Revenue" scenarios={scenarios} getValue={y1 => y1?.total_revenue ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
              <ComparisonRow label="Total Expenses" scenarios={scenarios} getValue={y1 => y1?.total_expenses ?? 0} format={fmt} baseY1={baseY1} invert />
              <ComparisonRow label="Net Position" scenarios={scenarios} getValue={y1 => y1?.net_position ?? 0} format={fmt} baseY1={baseY1} highlight />
              <ComparisonRow label="Ending Cash" scenarios={scenarios} getValue={y1 => y1?.ending_cash ?? 0} format={v => v < 0 ? '$0' : fmt(v)} baseY1={baseY1} mobileScenario={mobileScenario} badge={(v, y1) => v < 0 ? `Cash shortfall · ${Math.abs(Math.round(y1?.reserve_days ?? 0))} days short` : undefined} />
              <ComparisonRow label="Reserve Days" scenarios={scenarios} getValue={y1 => y1?.reserve_days ?? 0} format={v => v < 0 ? '0 days' : `${v} days`} baseY1={baseY1} colorFn={v => v <= 0 ? healthColor('fails', 'twText') : reserveColor(v, 1, hp)} suffix=" days" badge={v => v < 0 ? `Cash shortfall · ${Math.abs(Math.round(v))} days short` : undefined} />
              <ComparisonRow label="Personnel % Revenue" scenarios={scenarios} getValue={y1 => y1?.personnel_pct ?? 0} format={v => `${v.toFixed(1)}%`} baseY1={baseY1} colorFn={v => personnelColor(v, 1, hp)} invert suffix="%" />
              <ComparisonRow label="Break-Even Enrollment" scenarios={scenarios} getValue={y1 => y1?.break_even_enrollment ?? 0} format={v => `${v} students`} baseY1={baseY1} invert suffix=" students" />
            </>
          )}

          {/* 5-Year Trajectory */}
          <GroupHeader label="5-Year Trajectory" group="trajectory" expanded={expandedGroups.trajectory} onToggle={toggleGroup} />
          {expandedGroups.trajectory && (
            <div className="px-5 py-4">
              <div className="grid grid-cols-4 gap-4">
                <div />
                {scenarios.map(s => (
                  <div key={s.id} className="text-xs">
                    <table className="w-full">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left py-1">Yr</th>
                          <th className="text-right py-1">Enr</th>
                          <th className="text-right py-1">Net</th>
                          <th className="text-right py-1">Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[1, 2, 3, 4, 5].map(y => {
                          const yr = s.results?.years?.[String(y)]
                          return (
                            <tr key={y} className={y === 1 ? 'font-semibold' : ''}>
                              <td className="py-0.5 text-slate-600">Y{y}</td>
                              <td className="py-0.5 text-right text-slate-700">{yr?.enrollment ?? '-'}</td>
                              <td className={`py-0.5 text-right ${(yr?.net_position ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{yr ? fmt(yr.net_position) : '-'}</td>
                              <td className={`py-0.5 text-right ${reserveColor(yr?.reserve_days, y, hp)}`}>{yr?.reserve_days ?? '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FPF Compliance (WA) or health benchmarks (other pathways) — 5-year grid per scenario */}
          <GroupHeader label={isWaCharter ? 'Commission FPF Compliance' : 'Financial Health Benchmarks'} group="fpf" expanded={expandedGroups.fpf} onToggle={toggleGroup} />
          {expandedGroups.fpf && (
            <FPFComplianceGrid scenarios={scenarios} activeTab={activeTab} hp={hp} />
          )}

          {/* Revenue Breakdown */}
          <GroupHeader label="Revenue Breakdown" group="revenue" expanded={expandedGroups.revenue} onToggle={toggleGroup} />
          {expandedGroups.revenue && (
            <>
              <ComparisonRow label={revenueCopy.primaryRevenue} scenarios={scenarios} getValue={y1 => y1?.regular_ed_revenue ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
              {isWaCharter && (
                <>
                  <ComparisonRow label="SPED Revenue" scenarios={scenarios} getValue={y1 => y1?.sped_revenue ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
                  <ComparisonRow label="Facilities Revenue" scenarios={scenarios} getValue={y1 => y1?.facilities_revenue ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
                  <ComparisonRow label="Small School Enhancement" scenarios={scenarios} getValue={y1 => y1?.small_school_enhancement ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
                  <ComparisonRow label="Federal & Categorical" scenarios={scenarios} getValue={y1 => y1?.federal_categorical ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
                </>
              )}
              <ComparisonRow label="Startup Grants" scenarios={scenarios} getValue={y1 => y1?.startup_grants ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
              <ComparisonRow label="Other Revenue" scenarios={scenarios} getValue={y1 => y1?.other_revenue ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} />
              <ComparisonRow label="Total Revenue" scenarios={scenarios} getValue={y1 => y1?.total_revenue ?? 0} format={fmt} baseY1={baseY1} mobileScenario={mobileScenario} highlight />
            </>
          )}

          {/* Expense Breakdown */}
          <GroupHeader label="Expense Breakdown" group="expenses" expanded={expandedGroups.expenses} onToggle={toggleGroup} />
          {expandedGroups.expenses && (
            <>
              <ComparisonRow label="Total Personnel" scenarios={scenarios} getValue={y1 => y1?.total_personnel ?? 0} format={fmt} baseY1={baseY1} invert />
              <ComparisonRow label="Facility Costs" scenarios={scenarios} getValue={y1 => y1?.facility_cost ?? 0} format={fmt} baseY1={baseY1} invert />
              <ComparisonRow label="Total Operations" scenarios={scenarios} getValue={y1 => y1?.total_operations ?? 0} format={fmt} baseY1={baseY1} invert />
              <ComparisonRow label="Total Expenses" scenarios={scenarios} getValue={y1 => y1?.total_expenses ?? 0} format={fmt} baseY1={baseY1} invert highlight />
            </>
          )}
        </div>
      )}

      {/* Section 3: AI Analysis */}
      {hasResults && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">AI Scenario Analysis</h2>
              {aiLoading && (
                <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                  </svg>
                  Generating&hellip;
                </span>
              )}
            </div>
            <button
              onClick={handleAiAnalysis}
              disabled={aiLoading}
              className="px-4 py-2 text-sm font-medium text-teal-600 border border-teal-300 rounded-lg hover:bg-teal-50 transition-colors disabled:opacity-50"
            >
              {aiLoading ? 'Analyzing...' : aiAnalysis ? 'Refresh Analysis' : 'Get AI Analysis of Scenarios'}
            </button>
          </div>
          {aiError && !aiLoading && (
            <div role="alert" className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700 flex flex-wrap items-center justify-between gap-3">
              <span>{aiError}{aiAnalysis ? ' The previous analysis is shown below.' : ''}</span>
              <button onClick={handleAiAnalysis} className="font-semibold underline underline-offset-2 hover:text-red-900 whitespace-nowrap">
                Retry
              </button>
            </div>
          )}
          {aiIsStale && (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700 flex items-center justify-between">
              <span>Scenario assumptions have changed since this analysis was generated.</span>
              <button onClick={handleAiAnalysis} disabled={aiLoading} className="font-medium underline hover:text-amber-900 ml-4 whitespace-nowrap">
                Refresh Analysis
              </button>
            </div>
          )}
          {aiAnalysis ? (
            <div className="text-sm text-slate-700 leading-relaxed space-y-3">
              {(() => {
                const paras = aiAnalysis.split('\n\n').filter(Boolean)
                return paras.map((para, i) => {
                  const isLast = i === paras.length - 1
                  return (
                    <p key={i}>
                      {para.split(/(\*\*[^*]+\*\*)/).map((seg, j) =>
                        seg.startsWith('**') && seg.endsWith('**')
                          ? <strong key={j} className="font-semibold text-slate-800">{seg.slice(2, -2)}</strong>
                          : seg
                      )}
                      {aiLoading && isLast && (
                        <span className="streaming-cursor" aria-hidden="true">|</span>
                      )}
                    </p>
                  )
                })
              })()}
            </div>
          ) : !aiLoading ? (
            <p className="text-sm text-slate-400">Click the button above to generate an AI-powered analysis comparing your three scenarios.</p>
          ) : (
            <div className="space-y-2">
              <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
              <div className="h-3 bg-slate-100 rounded animate-pulse w-5/6" />
              <div className="h-3 bg-slate-100 rounded animate-pulse w-4/6" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* --- Sub-components --- */

function LeverControl({ label, tooltip, value, onChange, min, max, step, format, warning, isCurrency }: {
  label: string
  tooltip: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  format: (v: number) => string
  warning?: string
  isCurrency?: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        <Tooltip content={tooltip} position="top" multiline>
          <span className="text-[10px] text-slate-400 cursor-help" tabIndex={0}>?</span>
        </Tooltip>
      </div>
      <div className="text-lg font-semibold text-slate-800 mb-2" style={{ fontFamily: 'var(--font-heading-var)' }}>{format(value)}</div>
      {isCurrency ? (
        <input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          min={min} max={max} step={step}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      ) : (
        <input
          type="range"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          min={min} max={max} step={step}
          className="w-full accent-teal-600"
        />
      )}
      <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
      {warning && (
        <div className="mt-1 text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">{warning}</div>
      )}
    </div>
  )
}

function GroupHeader({ label, group, expanded, onToggle }: { label: string; group: string; expanded?: boolean; onToggle: (g: string) => void }) {
  return (
    <button
      onClick={() => onToggle(group)}
      className="w-full grid grid-cols-4 border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
    >
      <div className="px-5 py-2.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5 col-span-4">
        <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {label}
      </div>
    </button>
  )
}

// Stage targets come from the shared FPF bands (Stage 1 = Year 1 band, Stage 2 = Year 3 band).
// Generic pathways grade the same fields on the generic benchmarks (one target for every year).
function gridMetrics(hp: HealthPathway): { key: string; label: string; stage1: string; stage2: string }[] {
  const all = [
    { key: 'fpf_current_ratio', label: 'Current Ratio', stage1: getCurrentRatioBand(1, hp).target, stage2: getCurrentRatioBand(3, hp).target },
    { key: 'fpf_days_cash', label: 'Days Cash on Hand', stage1: getDaysOfCashBand(1, hp).target, stage2: getDaysOfCashBand(3, hp).target },
    { key: 'fpf_total_margin', label: 'Total Margin', stage1: getTotalMarginBand(1, hp).target, stage2: getTotalMarginBand(3, hp).target },
    { key: 'fpf_enrollment_variance', label: 'Enrollment Variance', stage1: getEnrollmentVarianceBand(1).target, stage2: getEnrollmentVarianceBand(3).target },
  ]
  const keys: string[] = scenarioStatusKeys(hp)
  return all.filter(m => keys.includes(m.key))
}

function fpfValueDisplay(yr: ScenarioYearResult | undefined, metricKey: string): string {
  if (!yr) return '-'
  switch (metricKey) {
    case 'fpf_current_ratio': return yr.current_ratio?.toFixed(2) ?? '-'
    case 'fpf_days_cash': return `${Math.round(yr.reserve_days)} days`
    case 'fpf_total_margin': return `${yr.total_margin?.toFixed(1)}%`
    case 'fpf_enrollment_variance': {
      const pct = (yr.enrollment_variance_pct ?? 0) * 100
      if (Math.abs(pct) < 0.5) return 'On Target'
      return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`
    }
    default: return '-'
  }
}

function FPFComplianceGrid({ scenarios, hp }: { scenarios: ScenarioRecord[]; activeTab: string; hp: HealthPathway }) {
  const years = [1, 2, 3, 4, 5]
  const isWa = hp === 'wa_charter'
  const metrics = gridMetrics(hp)
  // Stage columns are a Commission concept; generic benchmarks are the same every year.
  const stage2Col = (y: number) => isWa && fpfStageForYear(y) === 2
  const stage2Start = (y: number) => isWa && isStage2Start(y)

  const days1 = getDaysOfCashBand(1, hp)
  const days2 = getDaysOfCashBand(3, hp)
  const legendTooltip = !isWa ? [
    'Healthy — meets the platform benchmark.',
    `Watch — inside the watch range (e.g. ${days1.approachingRange} cash on hand). Plan to improve.`,
    'Needs attention — in the concern range.',
    '',
    `Benchmarks are the same every year (e.g. ${days1.target} cash on hand).`,
  ].join('\n') : [
    "Meets — meets the Commission's Financial Performance Framework threshold for that year's stage.",
    `Approaching — SchoolLaunch's early-warning band just below the threshold (e.g. ${days1.approachingRange} days cash in Stage 1, ${days2.approachingRange} in Stage 2). The Commission itself rates only Meets or Does Not Meet; in Stage 2 it also accepts 30–59 days cash or a 1.0–1.1 current ratio when the one-year trend is positive.`,
    'Does Not Meet — below the threshold and the early-warning band.',
    '',
    `Stage 1 applies to Years 1–2 (startup thresholds, e.g. ${days1.target} cash).`,
    `Stage 2 applies to Year 3 and beyond (mature thresholds, e.g. ${days2.target} cash).`,
  ].join('\n')

  return (
    <div className="px-5 py-4 overflow-x-auto">
      <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-3">
        <span className="uppercase tracking-wide font-medium">Legend:</span>
        {(['meets', 'approaching', 'fails'] as const).map(st => (
          <span key={st} className={`px-1.5 py-0.5 rounded font-medium ${healthColor(st, 'twPill')}`}>{STATUS_LABELS[st]}</span>
        ))}
        <Tooltip content={legendTooltip} position="bottom" multiline>
          <span className="ml-1 text-slate-400 cursor-help" aria-label={isWa ? 'FPF legend details' : 'Health benchmark legend details'} tabIndex={0}>?</span>
        </Tooltip>
      </div>
      {scenarios.map(s => {
        const colors = SCENARIO_COLORS[s.name] || SCENARIO_COLORS['Base Case']
        return (
          <div key={s.id} className="mb-5 last:mb-0">
            <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${colors.accent}`}>{s.name}</div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left py-1.5 px-2 text-slate-500 font-medium w-[140px]">Metric</th>
                  {years.map(y => {
                    const isStage2 = stage2Col(y)
                    return (
                      <th key={y} className={`text-center py-1.5 px-1 font-medium ${isStage2 ? 'bg-slate-50' : ''} ${stage2Start(y) ? 'border-l-2 border-slate-300' : ''}`}>
                        <div className="text-slate-600">Y{y}</div>
                        {isWa && <div className="text-[9px] text-slate-400 font-normal">{isStage2 ? 'Stage 2' : 'Stage 1'}</div>}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {metrics.map(metric => (
                  <tr key={metric.key} className="border-t border-slate-100">
                    <td className="py-1.5 px-2 text-slate-600">
                      {metric.label}
                    </td>
                    {years.map(y => {
                      const yr = s.results?.years?.[String(y)]
                      const status = yr ? (yr as unknown as Record<string, string>)[metric.key] || 'na' : 'na'
                      const isStage2 = stage2Col(y)
                      const threshold = fpfStageForYear(y) === 2 ? metric.stage2 : metric.stage1
                      const valueStr = fpfValueDisplay(yr, metric.key)
                      return (
                        <td key={y} className={`text-center py-1.5 px-1 ${isStage2 ? 'bg-slate-50' : ''} ${stage2Start(y) ? 'border-l-2 border-slate-300' : ''}`}>
                          <div>{fpfBadge(status)}</div>
                          <div className="text-[9px] text-slate-400 mt-0.5">{valueStr}</div>
                          <div className="text-[8px] text-slate-300">{threshold}</div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200">
                  <td className="py-1.5 px-2 font-semibold text-slate-700">Summary</td>
                  {years.map(y => {
                    const yr = s.results?.years?.[String(y)]
                    // Meets only: Approaching is an early warning, not a pass.
                    const { meets } = scenarioMeetsCount(yr as unknown as Record<string, string> | undefined, hp)
                    const isStage2 = stage2Col(y)
                    return (
                      <td key={y} className={`text-center py-1.5 px-1 font-semibold text-slate-700 ${isStage2 ? 'bg-slate-50' : ''} ${stage2Start(y) ? 'border-l-2 border-slate-300' : ''}`}>
                        {meets}/{metrics.length}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

function ComparisonRow({ label, scenarios, getValue, format, baseY1, colorFn, invert, highlight, suffix, mobileScenario, badge }: {
  label: string
  scenarios: ScenarioRecord[]
  getValue: (y1: ScenarioYearResult | undefined) => number
  format: (v: number) => string
  baseY1?: ScenarioYearResult
  colorFn?: (v: number) => string
  invert?: boolean
  highlight?: boolean
  suffix?: string
  mobileScenario?: string
  badge?: (v: number, y1: ScenarioYearResult | undefined) => string | undefined
}) {
  const baseValue = baseY1 ? getValue(baseY1) : 0
  return (
    <>
      {/* Desktop: 4-column grid */}
      <div className={`hidden lg:grid grid-cols-4 border-b border-slate-50 ${highlight ? 'bg-slate-50/50' : ''}`}>
        <div className="px-5 py-2 text-xs text-slate-600">{label}</div>
        {scenarios.map(s => {
          const y1 = s.results?.years?.['1']
          const value = getValue(y1)
          const isBase = s.name === 'Base Case'
          const color = colorFn ? colorFn(value) : 'text-slate-800'
          return (
            <div key={s.id} className={`px-4 py-2 text-center ${isBase ? 'bg-blue-50/30' : ''}`}>
              <div className={`text-sm font-medium ${highlight ? 'font-semibold' : ''} ${color}`}>
                {format(value)}
                {badge?.(value, y1) && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium whitespace-nowrap">{badge(value, y1)}</span>}
              </div>
              {!isBase && <Delta value={value} base={baseValue} suffix={suffix} invert={invert} />}
            </div>
          )
        })}
      </div>
      {/* Mobile: single selected scenario */}
      <div className={`lg:hidden flex justify-between items-center px-4 py-2 border-b border-slate-50 ${highlight ? 'bg-slate-50/50' : ''}`}>
        <span className="text-xs text-slate-600">{label}</span>
        {scenarios.filter(s => s.name === mobileScenario).map(s => {
          const y1 = s.results?.years?.['1']
          const value = getValue(y1)
          const color = colorFn ? colorFn(value) : 'text-slate-800'
          return <span key={s.id} className={`text-sm font-medium ${color}`}>
            {format(value)}
            {badge?.(value, y1) && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium whitespace-nowrap">{badge(value, y1)}</span>}
          </span>
        })}
      </div>
    </>
  )
}
