'use client'

import { useState, useMemo, useEffect } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import {
  computeEnrollmentSensitivity,
  computeMonthlyCashFlow,
  personnelPctOfRevenue,
  facilityCostOf,
  facilityPctOfRevenue,
  totalMarginPct,
} from '@/lib/budgetEngine'
import { createClient } from '@/lib/supabase/client'
import { scenarioBaseHash } from '@/lib/buildSchoolContext'
import { REGIONALIZATION_FACTORS } from '@/lib/regionalization'
import {
  evaluateDaysOfCash,
  evaluateTotalMargin,
  evaluatePersonnelPct,
  evaluateFacilityPct,
  fromFpfStatus,
  fromGenericColor,
  healthColor,
  healthPathway,
  type HealthEvaluation,
  type HealthStatus,
} from '@/lib/healthThresholds'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { useAdvisory } from '@/hooks/useAdvisory'
import { isAgentFailed } from '@/lib/advisory'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import SchoolLogo from '@/components/SchoolLogo'
import { HealthTile } from '@/components/ui/HealthTile'
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/ui/DataTable'
import { formatCurrency } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { OverviewSkeleton } from './_skeletons'
import { Callout } from '@/components/ui/Callout'
import { toast } from '@/components/ui/Toast'
import { Year1CashCard } from '@/components/charts/Year1CashCard'
import { revenueBreakdown, visibleLines } from '@/lib/lineItems'

/**
 * Year 1 tile sublabel. A WA value that already clears the Stage 2 bar reads "Meets Stage 2";
 * otherwise the Year 1 (Stage 1) verdict. Generic bands ignore the year, so both calls agree.
 */
function year1Sublabel(evaluateForYear: (year: number) => HealthEvaluation): string {
  const stage2 = evaluateForYear(3)
  return stage2.status === 'meets' ? stage2.short : evaluateForYear(1).short
}

/** Advisory agent verdicts on the shared health palette (R-HEALTH-01). */
const AGENT_HEALTH: Record<string, HealthStatus> = {
  strong: 'meets',
  needs_attention: 'approaching',
  risk: 'fails',
}

export default function DashboardPage() {
  const {
    schoolData: { schoolId, schoolName, profile, positions, allPositions, projections, gradeExpansionPlan, loading },
    assumptions,
    pathwayConfig,
    preOpenCash,
    projectionInputs,
    multiYear,
    y1,
    fpfScorecard: scorecard,
    genericScorecard,
  } = useScenario()
  const { role } = usePermissions()
  // The same advisory panel (context, cache, staleness) as the Advisory tab.
  const {
    advisory, ready: advisoryReady, generating: advisoryLoading, error: advisoryError,
    modelChanged, failedAgents, canGenerate, generate: fetchAdvisory,
  } = useAdvisory()
  // The engine branches on the config's pathway (runProjections), so labels and bands do too.
  const pathway = pathwayConfig.pathway
  const isWaCharter = pathway === 'wa_charter'
  const hp = healthPathway(pathway)
  useDocumentTitle('Overview', schoolName)

  const hasExpansion = gradeExpansionPlan && gradeExpansionPlan.length > 0

  const [briefingExpanded, setBriefingExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [commissionExporting, setCommissionExporting] = useState(false)
  const supabase = createClient()

  // multiYear / y1 and both scorecards come from ScenarioContext: one engine run
  // (runProjections) on the saved data for the school's pathway, shared with every tab.

  // 90% enrollment stress test: Year 1 revenue from an engine re-run at 90% fill, expenses
  // held at the base Year 1 total. Also sent to the narrative PDF export.
  const sensitivity = useMemo(() => computeEnrollmentSensitivity(projectionInputs, 0.9), [projectionInputs])
  // Year 1 month-end cash for the compact chart: the same model as the Cash Flow tab.
  const monthlyCash = useMemo(() => computeMonthlyCashFlow(y1, preOpenCash, { pathway }), [y1, preOpenCash, pathway])

  if (loading) {
    return <OverviewSkeleton />
  }

  // Non-CEO users viewing a school that hasn't finished onboarding
  if (!profile.onboarding_complete && role && role !== 'school_ceo') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">School Setup in Progress</h2>
          <p className="text-sm text-slate-500">
            This school hasn&apos;t completed the initial setup yet. The school owner needs to finish onboarding before you can access the dashboard.
          </p>
        </div>
      </div>
    )
  }

  // Every Year 1 figure reads the engine row (y1 = multiYear[0]) through the shared row helpers,
  // and every verdict/color comes from the shared bands in healthThresholds.ts (R-HEALTH-01):
  // WA uses the Commission FPF stage bands, generic schools the generic benchmarks.
  // Days of Cash: the engine's reserveDays (equals the FPF scorecard's Days of Cash).
  const daysOfCash = y1.reserveDays
  const reserveEval = evaluateDaysOfCash(daysOfCash, 1, hp)
  const reserveSublabel = year1Sublabel((year) => evaluateDaysOfCash(daysOfCash, year, hp))

  // Personnel % of OPERATING revenue (excludes interest & grants); WA founding-year band in Year 1.
  const personnelPctRevenue = personnelPctOfRevenue(y1)
  const personnelHealth = evaluatePersonnelPct(personnelPctRevenue, 1, hp)

  // Facility cost = facilities line + depreciation + interest (financed facilities), as % of operating revenue.
  const facilityCost = facilityCostOf(y1)
  const facilityPct = facilityPctOfRevenue(y1)
  const facilityEval = evaluateFacilityPct(facilityPct)

  // Year-end CASH (cumulative net + non-cash depreciation add-back; equals the FPF scorecard's cash).
  const endingCashY1 = y1.endingCash
  const endingCashStatus: HealthStatus = endingCashY1 >= 0 ? 'meets' : 'fails'

  // Total Margin as the pathway's scorecard defines it (WA: FPF net ÷ operating revenue).
  const marginPct = totalMarginPct(y1, pathway)
  const marginEval = evaluateTotalMargin(marginPct, 1, hp)
  const marginSublabel = year1Sublabel((year) => evaluateTotalMargin(marginPct, year, hp))

  // School identity info
  const openingGrades = profile.opening_grades?.join(', ') || profile.grade_config?.split('-')[0] || ''
  const buildoutGrades = profile.buildout_grades?.length
    ? `${profile.buildout_grades[0]}-${profile.buildout_grades[profile.buildout_grades.length - 1]}`
    : profile.grade_config || ''

  // Compose the school identity descriptor for the PageHeader subtitle.
  // schoolName lives in the PageHeader title, so the subtitle starts at grades.
  const overviewSubtitleParts: string[] = (() => {
    const parts: string[] = []
    if (openingGrades) {
      const opening = `${openingGrades} Opening ${profile.planned_open_year || ''}`.trim()
      const fullPart = buildoutGrades ? `${opening} → ${buildoutGrades} at Full Build-Out` : opening
      parts.push(fullPart)
    }
    if (y1.enrollment > 0) parts.push(`${y1.enrollment} Students Year 1`)
    if (profile.region) {
      const regionLabel = REGIONALIZATION_FACTORS[profile.region]?.label?.split('(')[0]?.trim() || profile.region
      parts.push(regionLabel)
    }
    return parts
  })()
  const overviewSubtitle = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {overviewSubtitleParts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="text-slate-300">&middot;</span>}
          <span>{part}</span>
        </span>
      ))}
    </div>
  )

  async function handleExport() {
    // Open the tab inside the click, before any await: a window opened after async work is
    // treated as an unrequested popup and blocked.
    const newTab = window.open('', '_blank')
    if (!newTab) {
      toast.error('Your browser blocked the PDF window. Allow pop-ups for this site, then try again.', { duration: Infinity })
      return
    }
    newTab.document.write('<p style="font-family:sans-serif;color:#475569;padding:24px">Preparing your Budget Narrative…</p>')
    setExporting(true)
    try {
      // No panel yet: generate one for the export when the user may (viewers export without it).
      const advisoryForPdf = advisory ?? (canGenerate ? await fetchAdvisory() : null)

      // Fetch scenarios for export if they exist
      const { data: scenarioData } = await supabase
        .from('scenarios')
        .select('name, assumptions, results, ai_analysis')
        .eq('school_id', schoolId)
        .eq('scenario_type', 'engine')
        .order('name')

      // The route derives Year 1 ratios and the monthly cash flow from the full engine rows.
      const payload = {
        schoolId,
        schoolName,
        pathway,
        profile,
        assumptions,
        positions,
        projections,
        multiYear,
        sensitivity,
        scorecard: isWaCharter ? scorecard : genericScorecard,
        advisory: advisoryForPdf || undefined,
        scenarios: scenarioData && scenarioData.length > 0 ? scenarioData : undefined,
      }

      const res = await fetch('/api/export/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        newTab.close()
        toast.error(`Budget Narrative export failed (${res.status}). Please try again.`, { duration: Infinity })
        setExporting(false)
        return
      }

      const html = await res.text()
      newTab.document.open()
      newTab.document.write(html)
      newTab.document.close()
    } catch {
      newTab.close()
      toast.error('Budget Narrative export failed. Check your connection and try again.', { duration: Infinity })
    }
    setExporting(false)
  }

  async function handleCommissionExport() {
    setCommissionExporting(true)
    try {
      // Fetch scenarios for commission export
      const { data: commScenarios } = await supabase
        .from('scenarios')
        .select('name, assumptions, results')
        .eq('school_id', schoolId)
        .eq('scenario_type', 'engine')
        .order('name')

      const payload = {
        schoolId,
        schoolName,
        profile,
        assumptions,
        positions,
        projections,
        multiYear,
        gradeExpansionPlan,
        scorecard: isWaCharter ? scorecard : genericScorecard,
        startingCash: preOpenCash,
        scenarios: commScenarios && commScenarios.length > 0 ? commScenarios : undefined,
        pathway,
      }
      const res = await fetch('/api/export/commission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${schoolName.replace(/\s+/g, '_')}_${isWaCharter ? 'Commission_Template' : 'Financial_Plan'}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        toast.error(`Excel export failed (${res.status}). Please try again.`, { duration: Infinity })
      }
    } catch {
      toast.error('Excel export failed. Check your connection and try again.', { duration: Infinity })
    }
    setCommissionExporting(false)
  }

  // Extract first paragraph of briefing for collapsed preview
  const briefingPreview = advisory?.briefing
    ? (advisory.briefing.split(/\n\n/)[0] || advisory.briefing.slice(0, 400))
    : ''

  return (
    <div className="animate-fade-in">
      {/* 1. School Identity Header */}
      <div className="flex items-start gap-4">
        <SchoolLogo name={schoolName} logoUrl={profile.logo_url} size={48} />
        <div className="flex-1 min-w-0">
          <PageHeader
            title={schoolName || 'Overview'}
            subtitle={overviewSubtitle}
            actions={
              <div data-tour="export-buttons" className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  {exporting ? 'Generating...' : 'Export PDF'}
                </button>
                <button
                  onClick={handleCommissionExport}
                  disabled={commissionExporting}
                  className="px-3 py-2 bg-white text-teal-600 border border-teal-600 rounded-lg text-sm font-medium hover:bg-teal-50 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  {commissionExporting ? 'Generating...' : isWaCharter ? 'Export Excel' : 'Export Plan'}
                </button>
              </div>
            }
          />
        </div>
      </div>

      {/* 2. Health tiles */}
      <div data-tour="health-tiles" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <HealthTile
          label="Days of Cash Y1 End"
          value={daysOfCash}
          status={reserveEval.status}
          valueFormat="days"
          sublabel={reserveSublabel}
        />
        <HealthTile
          label="Ending Cash Y1"
          value={endingCashY1}
          status={endingCashStatus}
          valueFormat="compact"
        />
        <HealthTile
          label="Total Margin %"
          value={marginPct}
          status={marginEval.status}
          valueFormat="percent"
          sublabel={marginSublabel}
        />
        <HealthTile
          label="Personnel % Revenue"
          value={personnelPctRevenue}
          status={personnelHealth.status}
          valueFormat="percent"
          sublabel={personnelHealth.short}
        />
        <HealthTile
          label="Facility % Revenue"
          value={facilityPct}
          status={facilityEval.status}
          valueFormat="percent"
          sublabel={facilityCost > 0 ? `${formatCurrency(facilityCost, 'compact')}/yr` : undefined}
        />
      </div>

      {/* 3. Scorecard summary banner — WA FPF or Generic Health */}
      {(() => {
        const sc = isWaCharter ? scorecard : genericScorecard
        if (!sc) return null
        const overall = fromGenericColor(sc.overallStatus)
        const variant = overall === 'meets' ? 'info' : overall === 'approaching' ? 'warn' : 'crit'
        const title = overall === 'meets'
          ? (isWaCharter ? 'All FPF metrics meeting standards' : 'All health benchmarks meeting standards')
          : overall === 'approaching'
            ? (isWaCharter ? 'Stage 2 metrics need attention' : 'Some metrics in the watch range')
            : (isWaCharter ? 'Stage 1 metrics failing' : 'Critical metrics need attention')
        return (
          <div className="mb-4">
            <Callout variant={variant} title={title}>
              <div className="flex items-center justify-between gap-4">
                <span>{sc.overallMessage}</span>
                <Link href="/dashboard/scorecard" className="text-xs font-medium opacity-75 hover:opacity-100 transition-opacity whitespace-nowrap shrink-0">
                  View Full {isWaCharter ? 'Scorecard' : 'Health Report'} &rarr;
                </Link>
              </div>
            </Callout>
          </div>
        )
      })()}

      {/* 4. 90% enrollment sensitivity */}
      {sensitivity.daysOfCash !== sensitivity.baseDaysOfCash && (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 text-sm text-slate-600">
          <strong>90% enrollment sensitivity:</strong> At {sensitivity.enrollment} students,
          days of cash drop from {sensitivity.baseDaysOfCash} to{' '}
          <span className={`${healthColor(evaluateDaysOfCash(sensitivity.daysOfCash, 1, hp).status, 'twText')} font-semibold`}>
            {sensitivity.daysOfCash} days
          </span>.
        </div>
      )}

      {/* 5. Facility cost warning (limit = the shared facility band's upper bound) */}
      {facilityEval.status === 'fails' && (
        <div className={`mb-4 border rounded-xl px-5 py-3 text-sm ${healthColor('fails', 'twCard')}`}>
          <strong>Warning:</strong> Facility costs exceed {facilityEval.band.approachingAt}% of projected revenue. Most lenders require
          facility costs below {facilityEval.band.approachingAt}% for financing.{isWaCharter ? ' The Charter School Commission may flag this during application review.' : ''}
        </div>
      )}
      {facilityEval.status === 'approaching' && (
        <div className={`mb-4 border rounded-xl px-5 py-3 text-sm ${healthColor('approaching', 'twCard')}`}>
          Facility costs at {facilityPct.toFixed(1)}% of revenue — approaching the {facilityEval.band.approachingAt}% maximum lenders and authorizers look for.
        </div>
      )}

      {/* 6. Financial Advisor Briefing — collapsed by default */}
      {advisoryLoading && !advisory ? (
        <div data-tour="ai-briefing" className="bg-white border-l-[3px] border-l-teal-600 border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded animate-shimmer" />
            <div className="h-4 rounded w-44 animate-shimmer" />
          </div>
          <div className="space-y-2.5">
            <div className="h-3 rounded w-full animate-shimmer" />
            <div className="h-3 rounded w-full animate-shimmer" />
            <div className="h-3 rounded w-5/6 animate-shimmer" />
          </div>
        </div>
      ) : advisory ? (
        <div data-tour="ai-briefing" className="bg-white border-l-[3px] border-l-teal-600 border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          {/* Header row with agent pills, refresh, timestamp */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Financial Advisor Briefing</span>
              {/* Agent status pills — always visible */}
              <div className="hidden sm:flex items-center gap-1.5 ml-3">
                {advisory.agents.map((agent) => {
                  // An advisor that could not be reached is grey, not an amber verdict.
                  const failed = isAgentFailed(agent)
                  const st: HealthStatus = failed ? 'na' : AGENT_HEALTH[agent.status] ?? 'approaching'
                  return (
                    <span key={agent.id} title={failed ? 'Unavailable — retry from the Advisory Panel' : undefined} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${healthColor(st, 'twCard')}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${healthColor(st, 'twBar')}`} />
                      {agent.name.split(' ')[0]}
                    </span>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {advisory.generatedAt && (
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  {new Date(advisory.generatedAt).toLocaleString()}
                </span>
              )}
              {canGenerate && (
                <button
                  onClick={fetchAdvisory}
                  disabled={advisoryLoading}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  <svg className={`w-3.5 h-3.5 ${advisoryLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {advisoryLoading ? 'Generating...' : 'Refresh'}
                </button>
              )}
            </div>
          </div>

          {/* Model changed banner */}
          {modelChanged && !advisoryLoading && (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 flex items-center justify-between">
              <span>Your financial model has changed since the last briefing.</span>
              {canGenerate ? (
                <button onClick={fetchAdvisory} className="font-medium text-amber-800 hover:text-amber-900 underline ml-2">
                  Click Refresh for updated analysis
                </button>
              ) : (
                <span className="ml-2">The school owner or an editor can refresh it.</span>
              )}
            </div>
          )}

          {/* Some advisors failed: their pills are grey; Retry re-runs the panel */}
          {failedAgents > 0 && !advisoryLoading && (
            <div className="mb-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 flex items-center justify-between">
              <span>{failedAgents} of {advisory.agents.length} advisors couldn&apos;t be reached for this briefing.</span>
              {canGenerate && (
                <button onClick={fetchAdvisory} className="font-medium text-slate-700 hover:text-slate-900 underline ml-2">
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Preview (first paragraph) — always visible */}
          <div className={`text-sm text-slate-700 leading-relaxed ${advisoryLoading ? 'opacity-50' : ''}`}>
            {!advisory.briefing.trim() ? (
              <p className="text-slate-500">The written briefing couldn&apos;t be generated this time. The advisor verdicts are in the Advisory Panel.</p>
            ) : briefingExpanded ? (
              <div className="whitespace-pre-line">{advisory.briefing}</div>
            ) : (
              <p>{briefingPreview}</p>
            )}
          </div>

          {/* Expand/collapse toggle */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
            <button
              onClick={() => setBriefingExpanded(!briefingExpanded)}
              className="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors flex items-center gap-1"
            >
              {briefingExpanded ? 'Collapse Briefing' : 'Read Full Briefing'}
              <svg className={`w-3.5 h-3.5 transition-transform ${briefingExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <Link
              href="/dashboard/advisory"
              className="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
            >
              View Full Advisory Panel &rarr;
            </Link>
          </div>
        </div>
      ) : advisoryReady && (advisoryError || !canGenerate) ? (
        <div data-tour="ai-briefing" className="bg-white border border-slate-200 rounded-xl px-6 py-4 mb-6 shadow-sm flex items-center justify-between gap-3 text-sm text-slate-500">
          <span>
            {advisoryError ?? 'No advisory briefing yet. The school owner or an editor can generate one from the Advisory Panel.'}
          </span>
          {canGenerate && (
            <button onClick={fetchAdvisory} className="text-xs font-medium text-teal-600 hover:text-teal-800 whitespace-nowrap">
              Try again
            </button>
          )}
        </div>
      ) : null}

      {/* 7. 5-Year Trajectory */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6 shadow-sm">
        {/* Scrolls sideways on phones so Years 4–5 stay reachable; the label column stays put. */}
        <div className="overflow-x-auto sl-scroll">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider sticky left-0 z-[1] bg-slate-50">5-Year Trajectory</th>
              {multiYear.map((y) => (
                <th key={y.year} className={`text-center px-4 py-2.5 font-semibold text-slate-600 text-xs min-w-[90px] ${y.year === 1 ? 'bg-teal-50/60' : ''}`}>
                  Year {y.year}
                  {y.year === 1 && <span className="block text-[9px] font-medium text-teal-600 mt-0.5">Current</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-5 py-2.5 text-slate-600 sticky left-0 z-[1] bg-white">Enrollment</td>
              {multiYear.map((y) => (
                <td key={y.year} className={`px-4 py-2.5 text-center tabular-nums text-slate-700 font-medium ${y.year === 1 ? 'bg-teal-50/30' : ''}`}>
                  {y.enrollment}
                </td>
              ))}
            </tr>
            {hasExpansion && (
              <tr className="border-b border-slate-100">
                <td className="px-5 py-2.5 text-slate-600 sticky left-0 z-[1] bg-white">Grades Served</td>
                {multiYear.map((y) => {
                  const grades = y.expansionDetail?.grades
                  const display = grades?.length
                    ? grades.length === 1 ? grades[0] : `${grades[0]}\u2013${grades[grades.length - 1]}`
                    : '\u2014'
                  return (
                    <td key={y.year} className={`px-4 py-2.5 text-center text-xs text-slate-600 ${y.year === 1 ? 'bg-teal-50/30' : ''}`}>
                      {display}
                    </td>
                  )
                })}
              </tr>
            )}
            <tr className="border-b border-slate-100">
              <td className="px-5 py-2.5 text-slate-600 sticky left-0 z-[1] bg-white">Net Position</td>
              {multiYear.map((y) => (
                <td key={y.year} className={`px-4 py-2.5 text-center tabular-nums font-medium ${healthColor(y.net >= 0 ? 'meets' : 'fails', 'twText')} ${y.year === 1 ? 'bg-teal-50/30' : ''}`}>
                  {formatCurrency(y.net, 'compact')}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-5 py-2.5 text-slate-600 sticky left-0 z-[1] bg-white">Days Cash</td>
              {multiYear.map((y) => {
                // Stage-aware on WA (Stage 1 = Years 1–2, Stage 2 = Year 3+); generic benchmark otherwise.
                const color = healthColor(evaluateDaysOfCash(y.reserveDays, y.year, hp).status, 'twText')
                return (
                  <td key={y.year} className={`px-4 py-2.5 text-center tabular-nums font-medium ${color} ${y.year === 1 ? 'bg-teal-50/30' : ''}`}>
                    {y.reserveDays}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      {/* 8. Year 1 month-end cash (compact; full chart and table on the Cash Flow tab) */}
      <Year1CashCard
        cashFlow={monthlyCash}
        row={y1}
        pathway={pathway}
        compact
        action={
          <Link href="/dashboard/cashflow" className="text-xs text-teal-600 hover:text-teal-700 font-medium whitespace-nowrap">
            Monthly detail →
          </Link>
        }
      />

      {/* 9. Base Case table — Year 1 budget summary */}
      {(() => {
        type SummaryRow = {
          label: string
          rendered: string
          emphasized?: boolean
          valueClass?: string
        }
        const fmtAccounting = (n: number) => formatCurrency(n, 'accounting')
        // Engine lines that sum to Total Revenue (src/lib/lineItems.ts). WA condenses its 14
        // Commission lines (+ recurring custom lines) into Operating Revenue, then lists interest,
        // grants and one-time revenue; generic pathways list their few operating lines. $0
        // non-operating lines are left out (they add nothing to the total).
        const revenue = revenueBreakdown(y1, { pathway, revenueModel: pathwayConfig.revenue_model })
        const revenueItems = [
          ...(isWaCharter
            ? [{ key: 'operating', label: 'Operating Revenue', amount: revenue.operatingTotal }]
            : visibleLines(revenue.operating)),
          ...revenue.nonOperating
            .filter((l) => l.amount !== 0)
            .map((l) => (l.key === 'grants' ? { ...l, label: 'Startup Grants (Year 1)' } : l)),
        ]

        const rows: DataTableRow<SummaryRow>[] = [
          { type: 'header', key: 'rev-h', label: 'Revenue' },
          ...revenueItems.map((l) => ({
            type: 'item' as const,
            key: `rev-${l.key}`,
            data: { label: l.label, rendered: fmtAccounting(l.amount) },
          })),
          { type: 'subtotal', key: 'rev-total', label: 'Total Revenue', values: { value: fmtAccounting(y1.revenue.total) } },

          { type: 'header', key: 'exp-h', label: 'Expenses' },
          { type: 'item', key: 'exp-personnel', data: { label: 'Total Personnel', rendered: fmtAccounting(y1.personnel.total) } },
          { type: 'item', key: 'exp-ops', data: { label: 'Total Operations', rendered: fmtAccounting(y1.operations.total) } },
          { type: 'subtotal', key: 'exp-total', label: 'Total Expenses', values: { value: fmtAccounting(y1.totalExpenses) } },

          { type: 'header', key: 'bl-h', label: 'Bottom Line' },
          {
            type: 'item',
            key: 'bl-net',
            data: {
              label: 'Net Position',
              rendered: fmtAccounting(y1.net),
              emphasized: true,
              valueClass: healthColor(y1.net >= 0 ? 'meets' : 'fails', 'twText'),
            },
          },
          {
            type: 'item',
            key: 'bl-days',
            data: {
              label: 'Days of Cash',
              rendered: `${daysOfCash} days`,
              emphasized: true,
              valueClass: healthColor(reserveEval.status, 'twText'),
            },
          },
        ]

        const columns: DataTableColumn<SummaryRow>[] = [
          {
            key: 'label',
            header: '',
            align: 'left',
            render: (r) => (r.emphasized ? <span className="font-semibold text-slate-800">{r.label}</span> : r.label),
          },
          {
            key: 'value',
            header: 'Year 1 Base Case',
            numeric: true,
            render: (r) => (
              <span className={`${r.valueClass ?? ''} ${r.emphasized ? 'font-semibold' : ''}`.trim()}>{r.rendered}</span>
            ),
          },
        ]

        return (
          <div data-tour="budget-summary" className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6 shadow-sm">
            <DataTable columns={columns} rows={rows} caption="Year 1 Base Case budget summary" />
          </div>
        )
      })()}

      {/* 9.5 Scenario Summary (only if scenarios have been seeded) */}
      <ScenarioSummaryCard
        schoolId={schoolId}
        currentHash={scenarioBaseHash({ profile, allPositions, projections, gradeExpansionPlan })}
      />
    </div>
  )
}

/** Badge label for a scenario's stored Year 1 FPF Days-of-Cash status. */
const SCENARIO_DAYS_LABEL: Record<HealthStatus, string> = {
  meets: 'On Track',
  approaching: 'Approaching',
  fails: 'At Risk',
  na: 'N/A',
}

/** Scenario Summary: Year 1 Days of Cash per seeded scenario, colored by its stored FPF status. */
function ScenarioSummaryCard({ schoolId, currentHash }: { schoolId: string; currentHash: string }) {
  const [scenarios, setScenarios] = useState<Array<{ name: string; assumptions: { enrollment_fill_rate: number }; results: { years: Record<string, { reserve_days: number; ending_cash: number; fpf_days_cash: string }> } | null; base_data_hash: string | null }>>([])
  const supabase = createClient()

  useEffect(() => {
    if (!schoolId) return
    supabase
      .from('scenarios')
      .select('name, assumptions, results, base_data_hash')
      .eq('school_id', schoolId)
      .eq('scenario_type', 'engine')
      .order('name')
      .then(({ data }) => { if (data && data.length > 0) setScenarios(data as typeof scenarios) })
  }, [schoolId, supabase])

  if (scenarios.length === 0) return null
  // Same check as the Scenarios tab: results computed on older base data are out of date.
  const stale = scenarios.some((s) => s.base_data_hash && s.base_data_hash !== currentHash)

  const colors: Record<string, string> = { Conservative: 'text-amber-600', 'Base Case': 'text-blue-600', Optimistic: 'text-emerald-600' }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Scenario Summary</h3>
        <Link href="/dashboard/scenarios" className="text-xs text-teal-600 hover:text-teal-700 font-medium">View Full Scenarios →</Link>
      </div>
      {stale && (
        <p className={`mb-3 rounded-lg border px-3 py-2 text-xs ${healthColor('approaching', 'twCard')}`}>
          Your base model has changed since these scenarios were calculated.{' '}
          <Link href="/dashboard/scenarios" className="font-semibold underline underline-offset-2">Recalculate on the Scenarios tab</Link>
        </p>
      )}
      <div className="grid grid-cols-3 gap-4 text-center">
        {scenarios.map(s => {
          const y1 = s.results?.years?.['1']
          const days = Math.max(0, y1?.reserve_days ?? 0)
          const endingCash = y1?.ending_cash ?? 0
          // Stage-aware FPF status stored with the scenario's results (Year 1 = Stage 1).
          const status = fromFpfStatus(y1?.fpf_days_cash)
          const fillPct = Math.round((s.assumptions?.enrollment_fill_rate || 0.9) * 100)
          return (
            <div key={s.name}>
              <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${colors[s.name] || 'text-slate-600'}`}>{s.name} ({fillPct}% Fill)</div>
              {endingCash < 0 ? (
                <>
                  <div className={`text-xl font-bold ${healthColor('fails', 'twText')}`}>0 days</div>
                  <div className="mt-0.5"><span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${healthColor('fails', 'twPill')}`}>Cash Shortfall</span></div>
                </>
              ) : (
                <>
                  <div className={`text-xl font-bold ${healthColor(status, 'twText')}`}>{days} days</div>
                  <div className="mt-0.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${healthColor(status, 'twPill')}`}>{SCENARIO_DAYS_LABEL[status]}</span>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

