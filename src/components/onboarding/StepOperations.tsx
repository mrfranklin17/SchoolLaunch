'use client'

import { useState, useMemo } from 'react'
import { calcCommissionRevenue, calcAuthorizerFeeCommission } from '@/lib/calculations'
import { FormField } from '@/components/ui/FormField'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { stateApportionmentBase } from '@/lib/budgetEngine'
import { DEFAULT_ASSUMPTIONS } from '@/lib/types'
import type { StartupFundingSource } from '@/lib/types'
import type { Pathway } from '@/lib/stateConfig'
import { getStateConfig } from '@/lib/stateConfig'
import { evaluateFacilityPct, healthColor } from '@/lib/healthThresholds'

interface OperationsData {
  facilityMode: 'sqft' | 'flat'
  facilitySqft: number
  facilityCostPerSqft: number
  facilityMonthly: number
  suppliesPerPupil: number
  contractedPerPupil: number
  technologyPerPupil: number
  foodProgram: boolean
  insurance: number
  miscPct: number
}

interface Props {
  enrollment: number
  totalPersonnelCost: number
  pctFrl: number
  pctIep: number
  pctEll: number
  pctHicap: number
  pathway?: Pathway
  /** Year-1 Small School Enhancement, computed like the engine (from the grade plan; $0 without one). */
  sseY1?: number
  tuitionRate?: number
  financialAidPct?: number
  initialData: OperationsData
  startupFunding: StartupFundingSource[]
  onComplete: (data: OperationsData, funding: StartupFundingSource[], customRevenue?: { key: string; label: string; amount: number }[]) => void
  onBack: () => void
  saving: boolean
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function CheckboxRow({
  id,
  checked,
  onChange,
  textClassName,
  containerClassName,
  helperText,
  children,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  textClassName: string
  containerClassName?: string
  helperText?: string
  children: React.ReactNode
}) {
  const labelId = `${id}-label`
  return (
    <div className={containerClassName ? `flex items-center gap-3 ${containerClassName}` : 'flex items-center gap-2 mt-3'}>
      <input
        type="checkbox"
        id={id}
        aria-labelledby={labelId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-teal-600"
      />
      <div>
        <span id={labelId} className={textClassName}>{children}</span>
        {helperText && <p className="text-xs text-slate-400">{helperText}</p>}
      </div>
    </div>
  )
}

export const defaultOperationsData: OperationsData = {
  facilityMode: 'flat',
  facilitySqft: 15000,
  facilityCostPerSqft: 18,
  facilityMonthly: 15000,
  suppliesPerPupil: 200,
  contractedPerPupil: 150,
  technologyPerPupil: 180,
  foodProgram: true,
  insurance: 18000,
  miscPct: 2,
}

export function getDefaultOperationsData(pathway?: Pathway): OperationsData {
  if (!pathway || pathway === 'wa_charter') return defaultOperationsData
  const config = getStateConfig(pathway)
  const od = config.operations_defaults
  return {
    facilityMode: 'flat',
    facilitySqft: 15000,
    facilityCostPerSqft: 18,
    facilityMonthly: pathway === 'generic_micro' ? 5000 : 15000,
    suppliesPerPupil: od.supplies_per_student ?? 200,
    contractedPerPupil: od.contracted_services_per_student ?? 150,
    technologyPerPupil: od.technology_per_student ?? 180,
    foodProgram: pathway !== 'generic_micro',
    insurance: od.insurance_annual ?? 18000,
    miscPct: od.contingency_pct ?? 2,
  }
}

const ALL_YEARS = [0, 1, 2, 3, 4]
const YEAR_LABELS: Record<number, string> = { 0: 'Year 0', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4' }

const DEFAULT_STARTUP_SOURCES: StartupFundingSource[] = [
  {
    source: 'Federal CSP Grant',
    amount: 0,
    type: 'grant',
    status: 'projected',
    selectedYears: [0, 1, 2, 3, 4],
    yearAllocations: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
  },
]

let fundingKeyCounter = 0
function nextFundingKey() {
  return `fund-${++fundingKeyCounter}`
}

interface FundingRow {
  key: string
  source: string
  amount: number
  type: 'grant' | 'donation' | 'debt' | 'other'
  status: 'received' | 'pledged' | 'applied' | 'projected' | 'n/a'
  expanded: boolean
  selectedYears: number[]
  yearAllocations: Record<number, number>
}

function migrateToRow(f: StartupFundingSource): Omit<FundingRow, 'key' | 'expanded'> {
  // Handle new format
  if (f.selectedYears && f.yearAllocations) {
    return {
      source: f.source,
      amount: f.amount,
      type: f.type,
      status: f.status,
      selectedYears: [...f.selectedYears],
      yearAllocations: { ...f.yearAllocations },
    }
  }
  // Legacy: old {year0, year1, year2} format
  const legacy = f.yearAllocations as unknown as { year0?: number; year1?: number; year2?: number } | undefined
  if (legacy && ('year0' in legacy || 'year1' in legacy || 'year2' in legacy)) {
    const allocs: Record<number, number> = {}
    const selected: number[] = []
    if (legacy.year0 != null) { allocs[0] = legacy.year0; selected.push(0) }
    if (legacy.year1 != null) { allocs[1] = legacy.year1; selected.push(1) }
    if (legacy.year2 != null) { allocs[2] = legacy.year2; selected.push(2) }
    if (selected.length === 0) selected.push(0)
    return { source: f.source, amount: f.amount, type: f.type, status: f.status, selectedYears: selected, yearAllocations: allocs }
  }
  // No allocations at all: default to year 0
  return {
    source: f.source,
    amount: f.amount,
    type: f.type,
    status: f.status,
    selectedYears: [0],
    yearAllocations: { 0: f.amount },
  }
}

export default function StepOperations({
  enrollment,
  totalPersonnelCost,
  pctFrl,
  pctIep,
  pctEll,
  pctHicap,
  pathway,
  sseY1 = 0,
  tuitionRate,
  financialAidPct,
  initialData,
  startupFunding,
  onComplete,
  onBack,
  saving,
}: Props) {
  const config = getStateConfig(pathway)
  const isCharter = config.pathway === 'wa_charter' || config.pathway === 'generic_charter'
  const isWaCharter = config.pathway === 'wa_charter'
  const isMicro = config.pathway === 'generic_micro'
  const isTuitionBased = config.revenue_model === 'tuition'
  const showAuthorizerFee = isCharter
  const showFoodProgram = !isMicro

  const [facilityMode, setFacilityMode] = useState(initialData.facilityMode)
  const [facilitySqft, setFacilitySqft] = useState(initialData.facilitySqft)
  const [facilityCostPerSqft, setFacilityCostPerSqft] = useState(initialData.facilityCostPerSqft)
  const [facilityMonthly, setFacilityMonthly] = useState(initialData.facilityMonthly)
  const [foodProgram, setFoodProgram] = useState(showFoodProgram ? initialData.foodProgram : false)
  const [facilityEstimate, setFacilityEstimate] = useState(false)

  // Additional revenue inputs for generic pathways
  const [perPupilRate, setPerPupilRate] = useState(config.pathway === 'generic_charter'
    ? (config.revenue_lines.find(l => l.key === 'per_pupil_funding')?.default_rate ?? 10000)
    : 0)
  const [registrationFees, setRegistrationFees] = useState(isTuitionBased ? (config.pathway === 'generic_micro' ? 250 : 500) : 0)
  const [fundraisingAmount, setFundraisingAmount] = useState(0)

  const [funding, setFunding] = useState<FundingRow[]>(
    (startupFunding.length > 0 ? startupFunding : DEFAULT_STARTUP_SOURCES).map((f) => ({
      ...migrateToRow(f),
      key: nextFundingKey(),
      expanded: false,
    }))
  )

  // Revenue calculation — pathway-aware
  const totalRevenue = useMemo(() => {
    if (isTuitionBased) {
      const rate = tuitionRate ?? config.tuition_rate_default ?? 0
      const aidPct = financialAidPct ?? config.financial_aid_pct_default ?? 0
      return enrollment * rate * (1 - aidPct) + registrationFees * enrollment + fundraisingAmount
    }
    if (config.pathway === 'generic_charter') {
      return enrollment * perPupilRate + fundraisingAmount
    }
    const rev = calcCommissionRevenue(enrollment, pctFrl, pctIep, pctEll, pctHicap, DEFAULT_ASSUMPTIONS, 1, sseY1)
    return rev.total
  }, [enrollment, pctFrl, pctIep, pctEll, pctHicap, sseY1, config, tuitionRate, financialAidPct, perPupilRate, registrationFees, fundraisingAmount, isTuitionBased])

  const authorizerFee = useMemo(() => {
    if (!showAuthorizerFee) return 0
    if (isWaCharter) {
      const rev = calcCommissionRevenue(enrollment, pctFrl, pctIep, pctEll, pctHicap, DEFAULT_ASSUMPTIONS)
      return calcAuthorizerFeeCommission(stateApportionmentBase(rev, sseY1))
    }
    // Generic charter: default 0% authorizer fee (editable in dashboard later)
    return Math.round(totalRevenue * config.authorizer_fee)
  }, [enrollment, pctFrl, pctIep, pctEll, pctHicap, showAuthorizerFee, isWaCharter, totalRevenue, config, sseY1])

  const estimatedFacilityAnnual = Math.round(totalRevenue * 0.15)
  const estimatedFacilityMonthly = Math.round(estimatedFacilityAnnual / 12)

  const opsData = initialData
  const costs = useMemo(() => {
    const facility = facilityEstimate
      ? estimatedFacilityAnnual
      : facilityMode === 'sqft'
        ? facilitySqft * facilityCostPerSqft
        : facilityMonthly * 12
    const supplies = opsData.suppliesPerPupil * enrollment
    const contracted = opsData.contractedPerPupil * enrollment
    const technology = opsData.technologyPerPupil * enrollment
    const insurance = opsData.insurance
    const subtotal = facility + supplies + contracted + technology + authorizerFee + insurance + totalPersonnelCost
    const misc = Math.round(subtotal * (opsData.miscPct / 100))
    return { facility, supplies, contracted, technology, authorizerFee, insurance, misc }
  }, [facilityMode, facilitySqft, facilityCostPerSqft, facilityMonthly, enrollment, authorizerFee, totalPersonnelCost, facilityEstimate, estimatedFacilityAnnual, opsData])

  const totalOps = costs.facility + costs.supplies + costs.contracted + costs.technology + costs.authorizerFee + costs.insurance + costs.misc
  const totalExpenses = totalPersonnelCost + totalOps
  const netPosition = totalRevenue - totalExpenses
  const facilityPct = totalRevenue > 0 ? ((costs.facility / totalRevenue) * 100).toFixed(1) : '0'
  // R-HEALTH-01: the shared facility band (warning shows when the cost fails it).
  const facilityHealth = evaluateFacilityPct(totalRevenue > 0 ? Number(facilityPct) : null)

  // Dynamic funding summary — only include years that have allocations
  const fundingSummary = useMemo(() => {
    let total = 0
    const byYear: Record<number, number> = {}
    for (const f of funding) {
      total += f.amount
      for (const yr of f.selectedYears) {
        byYear[yr] = (byYear[yr] || 0) + (f.yearAllocations[yr] || 0)
      }
    }
    const activeYears = ALL_YEARS.filter((yr) => byYear[yr] != null && byYear[yr] !== undefined)
    return { total, byYear, activeYears }
  }, [funding])

  function updateFundingField(key: string, field: string, value: string | number) {
    setFunding((prev) =>
      prev.map((f) => (f.key === key ? { ...f, [field]: value } : f))
    )
  }

  function toggleYear(key: string, year: number) {
    setFunding((prev) =>
      prev.map((f) => {
        if (f.key !== key) return f
        const has = f.selectedYears.includes(year)
        const selectedYears = has
          ? f.selectedYears.filter((y) => y !== year)
          : [...f.selectedYears, year].sort((a, b) => a - b)
        const yearAllocations = { ...f.yearAllocations }
        if (has) {
          delete yearAllocations[year]
        } else if (yearAllocations[year] == null) {
          yearAllocations[year] = 0
        }
        return { ...f, selectedYears, yearAllocations }
      })
    )
  }

  function updateAllocation(key: string, year: number, value: number) {
    setFunding((prev) =>
      prev.map((f) => {
        if (f.key !== key) return f
        return { ...f, yearAllocations: { ...f.yearAllocations, [year]: value } }
      })
    )
  }

  function toggleExpanded(key: string) {
    setFunding((prev) =>
      prev.map((f) => (f.key === key ? { ...f, expanded: !f.expanded } : f))
    )
  }

  function removeFunding(key: string) {
    setFunding((prev) => prev.filter((f) => f.key !== key))
  }

  function addFunding() {
    setFunding((prev) => [
      ...prev,
      {
        key: nextFundingKey(),
        source: '',
        amount: 0,
        type: 'grant',
        status: 'projected',
        expanded: true,
        selectedYears: [0],
        yearAllocations: { 0: 0 },
      },
    ])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // When facility estimate is checked, override to flat mode with the estimated monthly cost
    const effectiveFacilityMode = facilityEstimate ? 'flat' as const : facilityMode
    const effectiveFacilityMonthly = facilityEstimate ? estimatedFacilityMonthly : facilityMonthly
    const fullData: OperationsData = {
      facilityMode: effectiveFacilityMode,
      facilitySqft,
      facilityCostPerSqft,
      facilityMonthly: effectiveFacilityMonthly,
      suppliesPerPupil: defaultOperationsData.suppliesPerPupil,
      contractedPerPupil: defaultOperationsData.contractedPerPupil,
      technologyPerPupil: defaultOperationsData.technologyPerPupil,
      foodProgram,
      insurance: defaultOperationsData.insurance,
      miscPct: defaultOperationsData.miscPct,
    }
    const cleanFunding: StartupFundingSource[] = funding
      .filter((f) => f.source.trim() || f.amount > 0)
      .map(({ source, amount, type, status, selectedYears, yearAllocations }) => ({
        source,
        amount,
        type,
        status,
        selectedYears,
        yearAllocations,
      }))
    // Build custom revenue lines for generic pathways
    const customRevenue: { key: string; label: string; amount: number }[] = []
    if (config.pathway === 'generic_charter' && perPupilRate > 0) {
      customRevenue.push({ key: 'per_pupil_funding', label: 'Per-Pupil Funding', amount: perPupilRate * enrollment })
    }
    if (isTuitionBased && registrationFees > 0) {
      customRevenue.push({ key: 'registration_fees', label: 'Registration Fees', amount: registrationFees * enrollment })
    }
    if (fundraisingAmount > 0) {
      customRevenue.push({ key: 'fundraising', label: 'Fundraising/Donations', amount: fundraisingAmount })
    }
    onComplete(fullData, cleanFunding, customRevenue.length > 0 ? customRevenue : undefined)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <p className="text-sm text-slate-500">
        Set your facility lease and startup funding. We&apos;ll fill in standard operations costs automatically.
      </p>

      {/* Facilities */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Facilities</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFacilityMode('sqft')}
              className={`text-xs px-3 py-1 rounded-lg ${facilityMode === 'sqft' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Sq Footage
            </button>
            <button
              type="button"
              onClick={() => setFacilityMode('flat')}
              className={`text-xs px-3 py-1 rounded-lg ${facilityMode === 'flat' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Flat Monthly
            </button>
          </div>
        </div>

        {facilityMode === 'sqft' ? (
          <div className={`grid grid-cols-2 gap-4 ${facilityEstimate ? 'opacity-50 pointer-events-none' : ''}`}>
            <FormField label="Square Footage">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  value={facilitySqft}
                  onChange={(e) => setFacilitySqft(Number(e.target.value))}
                  disabled={facilityEstimate}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100"
                />
              )}
            </FormField>
            <FormField label="$/sqft/yr">
              {(id) => (
                <CurrencyInput
                  id={id}
                  value={facilityCostPerSqft}
                  onChange={setFacilityCostPerSqft}
                  step={0.5}
                  disabled={facilityEstimate}
                  fullWidth
                />
              )}
            </FormField>
          </div>
        ) : (
          <div className={facilityEstimate ? 'opacity-50 pointer-events-none' : ''}>
            <FormField label="Monthly Lease Amount">
              {(id) => (
                <CurrencyInput
                  id={id}
                  value={facilityMonthly}
                  onChange={setFacilityMonthly}
                  step={500}
                  disabled={facilityEstimate}
                  fullWidth
                />
              )}
            </FormField>
          </div>
        )}

        {/* Facility estimate checkbox */}
        <CheckboxRow
          id="facilityEstimate"
          checked={facilityEstimate}
          onChange={setFacilityEstimate}
          textClassName="text-xs text-slate-600"
        >
          I don&apos;t have facility costs yet — estimate for me
        </CheckboxRow>

        {facilityEstimate && (
          <p className="text-xs text-teal-600 mt-1">
            Estimated: {fmt(estimatedFacilityMonthly)}/month (15% of projected operating revenue)
          </p>
        )}

        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-slate-400">Annual: {fmt(costs.facility)}</p>
          <p className="text-xs text-slate-400">Facility = {facilityPct}% of revenue</p>
        </div>
        {!facilityEstimate && facilityHealth.status === 'fails' && (
          <p className={`text-xs mt-1 ${healthColor(facilityHealth.status, 'twText')}`}>Above {facilityHealth.band.approachingAt}% of revenue — consider negotiating terms or exploring co-location.</p>
        )}
      </div>

      {/* Food program — hidden for micro */}
      {showFoodProgram && (
        <CheckboxRow
          id="foodProgram"
          checked={foodProgram}
          onChange={setFoodProgram}
          textClassName="text-sm font-medium text-slate-700"
          containerClassName="bg-white border border-slate-200 rounded-xl p-4"
          helperText={isWaCharter || config.pathway === 'generic_charter' ? 'If enabled, assumes net neutral (federal reimbursement offsets cost)' : 'If enabled, adds food service as a budget line item. Adjust the per-student cost in your dashboard.'}
        >
          Food Program
        </CheckboxRow>
      )}

      {/* Revenue Configuration — generic pathways only */}
      {!isWaCharter && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Revenue Configuration</h3>
          {config.pathway === 'generic_charter' && (
            <div className="space-y-3">
              <FormField
                label="Per-Pupil Public Funding Rate (annual)"
                helperText={`Primary per-pupil funding from your state. ${enrollment} students x ${fmt(perPupilRate)} = ${fmt(enrollment * perPupilRate)}`}
              >
                {(id) => (
                  <CurrencyInput id={id} value={perPupilRate} onChange={setPerPupilRate} fullWidth />
                )}
              </FormField>
              <FormField label="Fundraising / Donations (annual)">
                {(id) => (
                  <CurrencyInput id={id} value={fundraisingAmount} onChange={setFundraisingAmount} fullWidth />
                )}
              </FormField>
              {config.authorizer_fee_editable && (
                <p className="text-xs text-slate-500 italic">Authorizer fee: {(config.authorizer_fee * 100).toFixed(0)}% — editable in Settings after onboarding.</p>
              )}
            </div>
          )}
          {isTuitionBased && (
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm text-slate-700">
                  Tuition Revenue: {enrollment} students x {fmt(tuitionRate ?? config.tuition_rate_default ?? 0)} = {fmt(enrollment * (tuitionRate ?? config.tuition_rate_default ?? 0))}
                  {(financialAidPct ?? 0) > 0 && <span className="text-slate-500"> (less {((financialAidPct ?? 0) * 100).toFixed(0)}% financial aid)</span>}
                </p>
              </div>
              <FormField label="Registration / Enrollment Fees (per student)">
                {(id) => (
                  <CurrencyInput id={id} value={registrationFees} onChange={setRegistrationFees} fullWidth />
                )}
              </FormField>
              <FormField label="Fundraising / Annual Fund">
                {(id) => (
                  <CurrencyInput id={id} value={fundraisingAmount} onChange={setFundraisingAmount} fullWidth />
                )}
              </FormField>
            </div>
          )}
        </div>
      )}

      {/* Startup Funding */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Startup Funding</h3>
        <p className="text-xs text-slate-400 mb-4">Grants, donations, and loans that fund pre-opening and early operations. Select which years each source covers, then allocate.</p>

        <div className="space-y-3">
          {funding.map((f) => {
            const allocated = f.selectedYears.reduce((s, yr) => s + (f.yearAllocations[yr] || 0), 0)
            const remaining = f.amount - allocated
            const overAllocated = remaining < 0

            return (
              <div key={f.key} className="border border-slate-200 rounded-lg">
                {/* Header row */}
                <div className="flex items-center gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(f.key)}
                    className="text-slate-400 hover:text-slate-600 flex-shrink-0"
                    aria-label="Toggle year allocation"
                  >
                    <svg className={`w-4 h-4 transition-transform ${f.expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <input
                    type="text"
                    value={f.source}
                    onChange={(e) => updateFundingField(f.key, 'source', e.target.value)}
                    placeholder="Source name"
                    className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <CurrencyInput
                    value={f.amount}
                    onChange={(v) => updateFundingField(f.key, 'amount', v)}
                    step={5000}
                    placeholder="Total award"
                    ariaLabel="Total award"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => updateFundingField(f.key, 'type', e.target.value)}
                    className="px-2 py-1.5 border border-slate-200 rounded text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="grant">Grant</option>
                    <option value="donation">Donation</option>
                    <option value="debt">Loan</option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    value={f.status}
                    onChange={(e) => updateFundingField(f.key, 'status', e.target.value)}
                    className="px-2 py-1.5 border border-slate-200 rounded text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="received">received</option>
                    <option value="pledged">pledged</option>
                    <option value="applied">applied</option>
                    <option value="projected">projected</option>
                    <option value="n/a">n/a</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeFunding(f.key)}
                    className="text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0"
                  >
                    &times;
                  </button>
                </div>

                {/* Expanded: year selection + allocation */}
                {f.expanded && (
                  <div className="px-3 pb-3 pt-0">
                    <div className="bg-slate-50 rounded-lg p-3 space-y-3">
                      {/* Year selector chips */}
                      <div>
                        <p className="text-xs font-medium text-slate-600 mb-1.5">Applicable Years</p>
                        <div className="flex gap-1.5">
                          {ALL_YEARS.map((yr) => {
                            const active = f.selectedYears.includes(yr)
                            return (
                              <button
                                key={yr}
                                type="button"
                                onClick={() => toggleYear(f.key, yr)}
                                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                                  active
                                    ? 'border-teal-600 bg-teal-50 text-teal-700'
                                    : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-500'
                                }`}
                              >
                                {yr === 0 ? 'Yr 0' : `Yr ${yr}`}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Allocation inputs for selected years */}
                      {f.selectedYears.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-600 mb-1.5">Allocation</p>
                          <div className="flex flex-wrap gap-3">
                            {f.selectedYears.map((yr) => (
                              <FormField
                                key={yr}
                                label={yr === 0 ? 'Year 0 (Pre-Open)' : `Year ${yr}`}
                                className="flex-1 min-w-[100px]"
                              >
                                {(id) => (
                                  <CurrencyInput
                                    id={id}
                                    value={f.yearAllocations[yr] || 0}
                                    onChange={(v) => updateAllocation(f.key, yr, v)}
                                    step={1000}
                                    fullWidth
                                  />
                                )}
                              </FormField>
                            ))}
                          </div>

                          {/* Unallocated indicator */}
                          {f.amount > 0 && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[11px] text-slate-500">Unallocated:</span>
                              <span className={`text-xs font-medium ${
                                overAllocated ? 'text-red-600' : remaining > 0 ? 'text-amber-600' : 'text-slate-500'
                              }`}>
                                {fmt(remaining)}
                              </span>
                              {overAllocated && (
                                <span className="text-[11px] text-red-500">— exceeds total award</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {f.selectedYears.length === 0 && (
                        <p className="text-xs text-slate-400 italic">Select at least one year to allocate funding.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={addFunding}
          className="text-xs text-teal-600 hover:text-teal-800 font-medium mt-3"
        >
          + Add Funding Source
        </button>

        {/* Dynamic funding summary */}
        {funding.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className={`grid gap-3 text-center`} style={{ gridTemplateColumns: `repeat(${1 + fundingSummary.activeYears.length}, minmax(0, 1fr))` }}>
              <div>
                <p className="text-[11px] text-slate-500">Total Awards</p>
                <p className="text-sm font-semibold text-slate-800">{fmt(fundingSummary.total)}</p>
              </div>
              {fundingSummary.activeYears.map((yr) => (
                <div key={yr}>
                  <p className="text-[11px] text-slate-500">{YEAR_LABELS[yr]}</p>
                  <p className="text-sm font-semibold text-slate-800">{fmt(fundingSummary.byYear[yr] || 0)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Defaults note */}
      <p className="text-xs text-slate-400 italic">
        Operations costs like supplies, technology, insurance, and contingency use regional benchmarks. You can customize these on your dashboard.
      </p>

      {/* Live Financial Summary */}
      <div className="bg-slate-800 rounded-xl p-5 text-white">
        <h3 className="text-sm font-semibold mb-4 uppercase tracking-wide text-slate-300">Year 1 Financial Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-400">Total Revenue</p>
            <p className="text-lg font-semibold">{fmt(totalRevenue)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Personnel</p>
            <p className="text-lg font-semibold">{fmt(totalPersonnelCost)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Operations</p>
            <p className="text-lg font-semibold">{fmt(totalOps)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Total Expenses</p>
            <p className="text-lg font-semibold">{fmt(totalExpenses)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Net Position</p>
            <p className={`text-lg font-semibold ${netPosition >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(netPosition)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Startup Funding</p>
            <p className="text-lg font-semibold text-blue-400">{fmt(fundingSummary.total)}</p>
          </div>
        </div>
        {netPosition < 0 && (
          <p className="text-xs text-amber-300 mt-3">
            Negative net position is common for Year 1. Startup funding of {fmt(Math.abs(netPosition))}+ is recommended to cover the gap.
          </p>
        )}
      </div>

      <div className="pt-4 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-lg font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-teal-600 text-white px-8 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Building Your Budget...
            </>
          ) : (
            'Complete Onboarding'
          )}
        </button>
      </div>
    </form>
  )
}
