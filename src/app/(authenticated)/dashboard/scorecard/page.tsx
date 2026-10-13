'use client'

import { useMemo, useState } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import { computeFPFScorecard, computeGenericHealthScorecard } from '@/lib/budgetEngine'
import { fromFpfStatus, fromGenericColor, healthColor, type HealthStatus } from '@/lib/healthThresholds'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import GenericScorecard from '@/components/dashboard/GenericScorecard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { ScorecardSkeleton } from '../_skeletons'

const LEGEND: { status: HealthStatus; label: string }[] = [
  { status: 'meets', label: 'Meets Standard' },
  { status: 'approaching', label: 'Approaching Standard' },
  { status: 'fails', label: 'Does Not Meet Standard' },
  { status: 'na', label: 'Not Applicable' },
]

export default function ScorecardPage() {
  const {
    schoolData: { schoolName, profile, loading },
    pathwayConfig,
    preOpenCash,
    multiYear,
  } = useScenario()
  useDocumentTitle('Commission Scorecard', schoolName)

  const [notesOpen, setNotesOpen] = useState(false)
  const [showAllYearsOnMobile, setShowAllYearsOnMobile] = useState(false)

  const scorecard = useMemo(
    () => computeFPFScorecard(multiYear, preOpenCash, false),
    [multiYear, preOpenCash]
  )

  const genericScorecard = useMemo(() => {
    if (pathwayConfig.pathway === 'wa_charter') return null
    const profileExt = profile as unknown as Record<string, unknown>
    return computeGenericHealthScorecard(
      multiYear, preOpenCash, pathwayConfig,
      profileExt.tuition_rate as number | undefined,
      profileExt.financial_aid_pct as number | undefined,
    )
  }, [multiYear, preOpenCash, pathwayConfig, profile])

  if (loading) {
    return <ScorecardSkeleton />
  }

  // Generic pathway: use GenericScorecard component
  if (pathwayConfig.pathway !== 'wa_charter' && genericScorecard) {
    return (
      <div className="animate-fade-in">
        <GenericScorecard scorecard={genericScorecard} />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Commission Scorecard"
        subtitle="Financial Performance Framework assessment against WA Charter School Commission standards"
      />

      {/* Overall status banner */}
      <div data-tour="scorecard-banner" className={`mb-6 px-5 py-3 rounded-xl text-sm font-medium border ${healthColor(fromGenericColor(scorecard.overallStatus), 'twCard')}`}>
        {scorecard.overallMessage}
      </div>

      {/* Full scorecard table */}
      <div data-tour="scorecard-table" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Financial Performance Framework</h2>
          <div data-tour="scorecard-stages" className="flex gap-4 text-[10px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-white" style={{ background: 'var(--navy-light)' }}>Stage 1</span> Years 1-2</span>
            <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-white" style={{ background: 'var(--navy-light)' }}>Stage 2</span> Years 3-5</span>
          </div>
        </div>
        <div className="md:hidden mb-3 flex items-center justify-between text-xs">
          <span className="text-slate-500">{showAllYearsOnMobile ? 'Showing all years' : 'Key years (Y1, Y3, Y5)'}</span>
          <button
            type="button"
            onClick={() => setShowAllYearsOnMobile(v => !v)}
            className="text-teal-600 hover:text-teal-700 font-medium underline-offset-4 hover:underline"
          >
            {showAllYearsOnMobile ? 'Show key years' : 'Show all years'}
          </button>
        </div>
        <div className="overflow-x-auto sl-scroll" data-mobile-key={showAllYearsOnMobile ? 'all' : 'key'}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 pr-3 font-medium text-slate-400 uppercase tracking-wide text-[11px] min-w-[180px]">Measure</th>
                {[1, 2, 3, 4, 5].map((y) => (
                  <th key={y} data-year={y} className="text-center px-3 py-2 font-medium text-slate-400 uppercase tracking-wide text-[11px] min-w-[85px]">Year {y}</th>
                ))}
                <th className="text-center px-3 py-2 font-medium text-slate-400 uppercase tracking-wide text-[11px] min-w-[140px]">Target</th>
              </tr>
            </thead>
            <tbody>
              {scorecard.measures.map((m) => (
                <tr key={m.name} className="border-b border-slate-100">
                  <td className="py-2.5 pr-3 text-slate-600 font-medium text-[13px]">
                    {m.name}
                    <div className="text-[10px] text-slate-400 font-normal mt-0.5">{m.formula}</div>
                    {m.note && <div className="text-[9px] text-slate-400/70 font-normal mt-0.5 italic">{m.note}</div>}
                  </td>
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const v = m.values[idx]
                    const s = m.statuses[idx]
                    const badgeStatus = fromFpfStatus(s)
                    const display = v === null
                      ? 'N/A'
                      : m.name.includes('Margin') || m.name === 'Enrollment Variance'
                        ? `${v}%`
                      : m.name === 'Cash Flow' || m.name === 'Multi-Year Cash Flow'
                        ? Math.abs(v as number) >= 1_000_000
                          ? `$${((v as number) / 1_000_000).toFixed(1)}M`
                          : `$${Math.round(v as number / 1000)}K`
                      : m.name === 'Days of Cash'
                        ? `${v}`
                      : m.name === 'Debt Default'
                        ? 'N/A'
                      : typeof v === 'number'
                        ? v.toFixed(2)
                        : String(v)
                    return (
                      <td key={idx} data-year={idx + 1} className="px-3 py-2.5 text-center align-middle">
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-tabular text-xs text-slate-700">{display}</span>
                          <StatusBadge status={badgeStatus} />
                        </div>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-center text-[10px] leading-snug">
                    {m.stage1Target === m.stage2Target ? (
                      <div className="font-tabular text-slate-500">{m.stage1Target}</div>
                    ) : (
                      <>
                        <div className="font-tabular text-slate-500"><span className="text-slate-400">S1:</span> {m.stage1Target}</div>
                        <div className="font-tabular text-slate-500"><span className="text-slate-400">S2:</span> {m.stage2Target}</div>
                      </>
                    )}
                    {(m.stage1Approaching || m.stage2Approaching) && (
                      m.stage1Approaching === m.stage2Approaching ? (
                        <div className="font-tabular text-[9px] text-slate-400 mt-0.5">
                          Approaching: {m.stage1Approaching}
                        </div>
                      ) : (
                        <>
                          <div className="font-tabular text-[9px] text-slate-400 mt-0.5">
                            <span>S1 approaching:</span> {m.stage1Approaching || 'N/A'}
                          </div>
                          <div className="font-tabular text-[9px] text-slate-400">
                            <span>S2 approaching:</span> {m.stage2Approaching || 'N/A'}
                          </div>
                        </>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-[11px]">
          {LEGEND.map(({ status, label }) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm border" style={{ background: healthColor(status, 'cssBg'), borderColor: healthColor(status, 'hexDot') }} /> {label}
            </span>
          ))}
        </div>
      </div>

      {/* Collapsible threshold-methodology disclosure */}
      <div className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setNotesOpen(!notesOpen)}
          className="w-full px-5 py-3 flex items-center justify-between text-left text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          How thresholds are calculated
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${notesOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {notesOpen && (
          <div className="px-5 pb-4 space-y-3 text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
            <p>
              This scorecard projects your school&apos;s performance against the WA Charter School Commission&apos;s Financial Performance
              Framework (FPF). During operations, the Commission calculates these measures from your audited financial statements and
              balance sheet. In planning mode, SchoolLaunch uses projected values as proxies.
            </p>
            <p>
              <strong className="text-slate-600">Current Ratio</strong> and <strong className="text-slate-600">Debt-to-Asset Ratio</strong> are
              balance sheet measures. In planning mode, Current Ratio is approximated as Ending Cash &divide; (Annual Expenses / 12).
              The Commission will calculate these differently once your school has audited financials.
            </p>
            <p>
              <strong className="text-slate-600">Cash Flow</strong> shows the year-over-year change in your ending cash balance &mdash;
              a key indicator of whether your school is building or depleting reserves over time. Multi-Year Cash Flow compares
              the current year to two years prior, capturing the 3-year trend.
            </p>
            <p>
              <strong className="text-slate-600">Days of Cash</strong> uses the FPF formula: Unrestricted Cash &divide; ((Total Expenses &minus; Depreciation) / 365).
              Depreciation is $0 in planning mode but the formula is structured to accommodate it.
            </p>
            <p className="text-slate-400 italic">
              Based on the Commission&apos;s Financial Performance Framework &amp; Guidance, Updated August 8, 2024.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
