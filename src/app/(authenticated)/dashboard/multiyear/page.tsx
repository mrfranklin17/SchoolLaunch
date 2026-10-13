'use client'

import { useMemo, useState } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import { beginningCashOf, computeCarryForwardBreakdown } from '@/lib/budgetEngine'
import { evaluateDaysOfCash, healthColor, healthPathway } from '@/lib/healthThresholds'
import type { StartupFundingSource } from '@/lib/types'
import Link from 'next/link'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatCurrency } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import Tooltip from '@/components/ui/Tooltip'
import { MultiYearSkeleton } from '../_skeletons'
import { DaysOfCashChart, RevenueExpenseChart } from '@/components/charts/FiveYearCharts'
import { fiveYearSeries } from '@/lib/chartData'

const fmt = (n: number) => formatCurrency(n, 'accounting')

export default function MultiYearPage() {
  const {
    schoolData: { schoolName, profile, gradeExpansionPlan, loading },
    assumptions,
    pathway,
    multiYear: yearsWithStartup,
  } = useScenario()
  useDocumentTitle('Multi-Year', schoolName)

  const fundingSources: StartupFundingSource[] = profile.startup_funding && profile.startup_funding.length > 0
    ? profile.startup_funding
    : []

  const totalFunding = fundingSources.reduce((s, f) => s + f.amount, 0)
  const securedFunding = fundingSources
    .filter((f) => f.status === 'received' || f.status === 'pledged')
    .reduce((s, f) => s + f.amount, 0)

  // Year 0 carry-forward + its display components — single source via the engine (P-UX-20).
  // No raw pre_opening_* reads here; the breakdown canonicalizes (inherits P-UX-19 crash-safety).
  // carryForward equals the context's preOpenCash, the Year 1 starting cash of every row below.
  const cf = useMemo(() => computeCarryForwardBreakdown(profile), [profile])
  const carryForward = cf.carryForward
  const year0Total = cf.year0Total
  const preOpenActualSpend = cf.preOpenActualSpend
  const preOpenExpenses = cf.preOpenExpenses
  const thresholdPathway = healthPathway(pathway)

  const hasExpansion = gradeExpansionPlan && gradeExpansionPlan.length > 0
  const trend = useMemo(() => fiveYearSeries(yearsWithStartup, thresholdPathway), [yearsWithStartup, thresholdPathway])
  const [showAllYearsOnMobile, setShowAllYearsOnMobile] = useState(false)

  if (loading) {
    return <MultiYearSkeleton />
  }

  const yrs = [1, 2, 3, 4, 5]

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Multi-Year Projection"
        subtitle={`Five-year projection with ${assumptions.salary_escalator_pct}% annual salary escalator, ${assumptions.ops_escalator_pct}% operations escalator, and ${assumptions.revenue_cola_pct}% revenue COLA.`}
      />
      <MobileYearToggle showAll={showAllYearsOnMobile} onToggle={() => setShowAllYearsOnMobile(v => !v)} />

      {/* Startup Funding Sources — read-only summary */}
      {fundingSources.length > 0 && (
        <div data-tour="funding-sources-table" className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Startup Funding Sources</h2>
            <Link
              href="/dashboard/revenue"
              className="px-3 py-1.5 text-xs font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
            >
              Manage on Revenue tab
            </Link>
          </div>

          <div className="overflow-x-auto sl-scroll">
            <table className="w-full text-sm sl-table">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Source</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 w-20">Status</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-500 w-24">Year 0</th>
                  {yrs.map((y) => (
                    <th key={y} className="text-right px-3 py-2 font-semibold text-slate-600 w-24">Year {y}</th>
                  ))}
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 w-28">Total</th>
                </tr>
              </thead>
              <tbody>
                {fundingSources.map((src, idx) => {
                  const allocs = src.yearAllocations || {}
                  const isSecured = src.status === 'received' || src.status === 'pledged'
                  return (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{src.source || '(unnamed)'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 text-[10px] rounded font-medium ${
                          isSecured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {src.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                        {(() => {
                          if (allocs[0]) return fmt(allocs[0])
                          if (!src.selectedYears || src.selectedYears.length === 0) return fmt(src.amount)
                          return '—'
                        })()}
                      </td>
                      {yrs.map((y) => (
                        <td key={y} className="px-3 py-2 text-right text-slate-600 tabular-nums">
                          {allocs[y] ? fmt(allocs[y]) : '—'}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-medium text-slate-800 tabular-nums">{fmt(src.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200">
                  <td className="px-3 py-2 font-bold text-slate-800">Total</td>
                  <td></td>
                  <td className="px-3 py-2 text-right font-bold text-slate-500 tabular-nums">
                    {year0Total > 0 ? fmt(year0Total) : '—'}
                  </td>
                  {yrs.map((y) => {
                    const yearTotal = yearsWithStartup[y - 1]?.revenue.grantRevenue ?? 0
                    return (
                      <td key={y} className="px-3 py-2 text-right font-bold text-slate-800 tabular-nums">
                        {yearTotal > 0 ? fmt(yearTotal) : '—'}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-bold text-slate-800 tabular-nums">{fmt(totalFunding)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Secured vs Pending badges */}
          <div className="flex flex-wrap gap-3 mt-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-xs">
              <span className="text-emerald-600 font-semibold">Secured:</span>
              <span className="text-emerald-700 font-bold ml-1">{fmt(securedFunding)}</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
              <span className="text-amber-600 font-semibold">Pending:</span>
              <span className="text-amber-700 font-bold ml-1">{fmt(totalFunding - securedFunding)}</span>
            </div>
          </div>

          {/* Year 0 carry-forward summary */}
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Year 0 Funding: <strong className="text-slate-800">{fmt(year0Total)}</strong></span>
            <span className="text-slate-300">|</span>
            <span>Pre-Opening {preOpenActualSpend > 0 ? 'Actual Spend' : 'Budget'}: <strong className="text-slate-800">{fmt(preOpenExpenses)}</strong></span>
            <span className="text-slate-300">|</span>
            <span>Carry-Forward to Year 1: <strong className={carryForward >= 0 ? 'text-emerald-700' : 'text-red-600'}>{fmt(carryForward)}</strong></span>
          </div>
        </div>
      )}

      {/* 5-year trend charts (same engine rows as the table below) */}
      {trend.length > 0 && (
        <div data-tour="multiyear-charts" className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm min-w-0">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Revenue vs. Expenses</h2>
            <RevenueExpenseChart points={trend} />
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm min-w-0">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Days of Cash</h2>
            <DaysOfCashChart points={trend} />
          </div>
        </div>
      )}

      {/* Main multi-year table */}
      <div
        data-tour="multiyear-table"
        data-mobile-key={showAllYearsOnMobile ? 'all' : 'key'}
        className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto sl-scroll"
      >
        <table className="w-full text-sm whitespace-nowrap sl-table">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 font-semibold text-slate-600 min-w-[200px]"></th>
              {yrs.map((y) => (
                <th key={y} data-year={y} className="text-right px-5 py-3 font-semibold text-slate-600 min-w-[130px] num">
                  Year {y}
                  <div className="text-[10px] font-normal text-slate-400">
                    {yearsWithStartup[y - 1]?.enrollment || 0} students
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Enrollment Breakdown (grade expansion) */}
            {hasExpansion && (
              <>
                <SectionHeader label="Enrollment (Grade Expansion)" cols={5} />
                <tr className="border-b border-slate-100 bg-teal-50/30">
                  <td className="px-5 py-2.5 text-slate-600">Grades Served</td>
                  {yearsWithStartup.map((y) => (
                    <td key={y.year} data-year={y.year} className="px-5 py-2.5 text-right text-xs text-slate-600">
                      {y.expansionDetail?.grades.join(', ') || '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-5 py-2.5 text-slate-600">New Grades Added</td>
                  {yearsWithStartup.map((y) => (
                    <td key={y.year} data-year={y.year} className="px-5 py-2.5 text-right text-teal-600 font-medium text-xs">
                      {y.expansionDetail?.newGrades.length ? `+${y.expansionDetail.newGrades.join(', ')}` : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-5 py-2.5 text-slate-600">Returning Students</td>
                  {yearsWithStartup.map((y) => (
                    <td key={y.year} data-year={y.year} className="px-5 py-2.5 text-right text-slate-600">
                      {y.expansionDetail ? (y.year === 1 ? '—' : y.expansionDetail.returning) : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-5 py-2.5 text-slate-600">New Grade Students</td>
                  {yearsWithStartup.map((y) => (
                    <td key={y.year} data-year={y.year} className="px-5 py-2.5 text-right text-teal-600">
                      {y.expansionDetail ? (y.year === 1 ? '—' : (y.expansionDetail.newGrade > 0 ? `+${y.expansionDetail.newGrade}` : '—')) : '—'}
                    </td>
                  ))}
                </tr>
                <TotalRow label="Total Enrollment" values={yearsWithStartup.map((y) => y.enrollment)} format="number" />
              </>
            )}

            {/* Revenue Section */}
            <SectionHeader label="Revenue" cols={5} />
            <Row label="Regular Ed Apportionment" values={yearsWithStartup.map((y) => y.revenue.regularEd)} />
            <Row label="SPED Apportionment" values={yearsWithStartup.map((y) => y.revenue.sped)} />
            <Row label="State Special Education" values={yearsWithStartup.map((y) => y.revenue.stateSped)} />
            <Row label="Facilities Revenue" values={yearsWithStartup.map((y) => y.revenue.facilitiesRev)} />
            <Row label="Levy Equity" values={yearsWithStartup.map((y) => y.revenue.levyEquity)} />
            <Row label="Title I" values={yearsWithStartup.map((y) => y.revenue.titleI)} />
            <Row label="IDEA (Federal Special Ed)" values={yearsWithStartup.map((y) => y.revenue.idea)} />
            <Row label="LAP" values={yearsWithStartup.map((y) => y.revenue.lap)} />
            <Row label="LAP High Poverty" values={yearsWithStartup.map((y) => y.revenue.lapHighPoverty)} />
            <Row label="TBIP" values={yearsWithStartup.map((y) => y.revenue.tbip)} />
            <Row label="HiCap" values={yearsWithStartup.map((y) => y.revenue.hicap)} />
            {yearsWithStartup.some((y) => y.revenue.smallSchoolEnhancement > 0) && (
              <Row label="Small School Enhancement" values={yearsWithStartup.map((y) => y.revenue.smallSchoolEnhancement)} />
            )}
            {yearsWithStartup.some((y) => y.revenue.foodServiceRev > 0) && (
              <Row label="Food Service (NSLP)" values={yearsWithStartup.map((y) => y.revenue.foodServiceRev)} />
            )}
            {yearsWithStartup.some((y) => y.revenue.transportationRev > 0) && (
              <Row label="Transportation (State)" values={yearsWithStartup.map((y) => y.revenue.transportationRev)} />
            )}
            {/* F-006: Operating Revenue row sits ABOVE Interest line — earned from operations only. */}
            <TotalRow
              label="Operating Revenue"
              values={yearsWithStartup.map((y) => y.revenue.operatingRevenue)}
              tooltip="Earned from school operations. Interest income and grants reported separately below."
            />
            <Row label="Interest & Other Income" values={yearsWithStartup.map((y) => y.revenue.interestIncome)} />
            {yearsWithStartup.some((y) => y.revenue.grantRevenue > 0) && (
              <Row label="Startup & Other Grants" values={yearsWithStartup.map((y) => y.revenue.grantRevenue)} />
            )}
            <TotalRow label="Total Revenue" values={yearsWithStartup.map((y) => y.revenue.total)} />

            {/* Personnel Section */}
            <SectionHeader label="Personnel" cols={5} />
            <Row label="Certificated Staff" values={yearsWithStartup.map((y) => y.personnel.certificated)} />
            <Row label="Classified Staff" values={yearsWithStartup.map((y) => y.personnel.classified)} />
            <Row label="Admin Staff" values={yearsWithStartup.map((y) => y.personnel.admin)} />
            <Row label={`Benefits (${assumptions.benefits_load_pct}%)`} values={yearsWithStartup.map((y) => y.personnel.benefits)} />
            <TotalRow label="Total Personnel" values={yearsWithStartup.map((y) => y.personnel.total)} />

            {/* Staffing summary */}
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <td className="px-5 py-2 text-xs text-slate-500 italic">Staff Count</td>
              {yearsWithStartup.map((y) => (
                <td key={y.year} data-year={y.year} className="px-5 py-2 text-right text-xs text-slate-500 italic">
                  {y.staffing.totalPositions} ({y.staffing.teachers}T, {y.staffing.paras}P, {y.staffing.officeStaff}O)
                </td>
              ))}
            </tr>

            {/* Operations Section */}
            <SectionHeader label="Operations" cols={5} />
            <Row label="Facilities" values={yearsWithStartup.map((y) => y.operations.facilities)} />
            <Row label="Supplies & Materials" values={yearsWithStartup.map((y) => y.operations.supplies)} />
            <Row label="Contracted Services" values={yearsWithStartup.map((y) => y.operations.contracted)} />
            <Row label="Technology" values={yearsWithStartup.map((y) => y.operations.technology)} />
            <Row label="Authorizer Fee" values={yearsWithStartup.map((y) => y.operations.authorizerFee)} />
            <Row label="Insurance" values={yearsWithStartup.map((y) => y.operations.insurance)} />
            <Row label="Food Service" values={yearsWithStartup.map((y) => y.operations.foodService)} />
            <Row label="Transportation" values={yearsWithStartup.map((y) => y.operations.transportation)} />
            <Row label="Curriculum & Materials" values={yearsWithStartup.map((y) => y.operations.curriculum)} />
            <Row label="Professional Development" values={yearsWithStartup.map((y) => y.operations.profDev)} />
            <Row label="Marketing & Outreach" values={yearsWithStartup.map((y) => y.operations.marketing)} />
            <Row label="Fundraising" values={yearsWithStartup.map((y) => y.operations.fundraising)} />
            <Row label="Misc/Contingency" values={yearsWithStartup.map((y) => y.operations.contingency)} />
            <TotalRow label="Total Operations" values={yearsWithStartup.map((y) => y.operations.total)} />

            {/* Summary Section */}
            <SectionHeader label="Summary" cols={5} dataTour="summary-rows" />
            <TotalRow label={yearsWithStartup.some((y) => y.revenue.grantRevenue > 0) ? 'Total Revenue (incl. Grants)' : 'Total Revenue'} values={yearsWithStartup.map((y) => y.revenue.total)} />
            <TotalRow label="Total Expenses" values={yearsWithStartup.map((y) => y.totalExpenses)} />
            <tr className="border-b border-slate-200">
              <td className="px-5 py-3 font-bold text-slate-800">Net Position</td>
              {yearsWithStartup.map((y) => (
                <td key={y.year} data-year={y.year} className={`px-5 py-3 text-right font-bold ${y.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmt(y.net)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-slate-100 bg-slate-50/30">
              <td className="px-5 py-2.5 text-slate-600">Beginning Cash</td>
              {yearsWithStartup.map((y) => {
                const beginCash = beginningCashOf(y)
                return (
                  <td key={y.year} data-year={y.year} className={`px-5 py-2.5 text-right tabular-nums font-medium ${beginCash >= 0 ? 'text-slate-700' : 'text-red-600'}`}>
                    {fmt(beginCash)}
                  </td>
                )
              })}
            </tr>
            <tr className="border-b border-slate-200">
              <td className="px-5 py-3 font-bold text-slate-800">Ending Cash</td>
              {yearsWithStartup.map((y) => (
                <td key={y.year} data-year={y.year} className={`px-5 py-3 text-right font-bold ${y.endingCash >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmt(y.endingCash)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-5 py-3 font-bold text-slate-800">Days Cash</td>
              {yearsWithStartup.map((y) => {
                // Engine Days of Cash (equals the FPF scorecard's), colored by the year's band.
                const days = y.reserveDays
                const health = evaluateDaysOfCash(days, y.year, thresholdPathway)
                return (
                  <td key={y.year} data-year={y.year} className={`px-5 py-3 text-right font-bold ${healthColor(health.status, 'twText')}`}>
                    {days}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
        <p className="px-5 py-3 text-xs text-slate-400 italic border-t border-slate-100">
          Beginning Cash each year equals the prior year&apos;s Ending Cash. Year 1 begins with funds carried forward from pre-opening.
        </p>
      </div>
    </div>
  )
}

function MobileYearToggle({ showAll, onToggle }: { showAll: boolean; onToggle: () => void }) {
  return (
    <div className="md:hidden mb-3 flex items-center justify-between text-xs">
      <span className="text-slate-500">{showAll ? 'Showing all years' : 'Key years (Y1, Y3, Y5)'}</span>
      <button
        type="button"
        onClick={onToggle}
        className="text-teal-600 hover:text-teal-700 font-medium underline-offset-4 hover:underline"
      >
        {showAll ? 'Show key years' : 'Show all years'}
      </button>
    </div>
  )
}

function SectionHeader({ label, cols, dataTour }: { label: string; cols: number; dataTour?: string }) {
  return (
    <tr className="bg-slate-100 border-b border-slate-200 section-header" {...(dataTour ? { 'data-tour': dataTour } : {})}>
      <td className="px-5 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide" colSpan={cols + 1}>
        {label}
      </td>
    </tr>
  )
}

function Row({ label, values }: { label: string; values: number[] }) {
  return (
    <tr className="border-b border-slate-100 even:bg-slate-50/30">
      <td className="px-5 py-2.5 text-slate-600">{label}</td>
      {values.map((v, i) => (
        <td key={i} data-year={i + 1} className="px-5 py-2.5 text-right text-slate-600 tabular-nums num">{fmt(v)}</td>
      ))}
    </tr>
  )
}

function TotalRow({ label, values, format = 'currency', tooltip }: { label: string; values: number[]; format?: 'currency' | 'number'; tooltip?: string }) {
  return (
    <tr className="border-b border-slate-200 bg-slate-50 total">
      <td className="px-5 py-3 font-bold text-slate-800">
        {tooltip ? (
          <Tooltip content={tooltip}>
            <span className="border-b border-dotted border-slate-400 cursor-help">{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </td>
      {values.map((v, i) => (
        <td key={i} data-year={i + 1} className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums num">
          {format === 'number' ? v.toLocaleString() : fmt(v)}
        </td>
      ))}
    </tr>
  )
}
