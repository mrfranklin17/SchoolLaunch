'use client'

import { useState, useMemo, useId } from 'react'
import { calcCommissionRevenue, calcSmallSchoolEnhancementFromGrades } from '@/lib/calculations'
import { DEFAULT_ASSUMPTIONS } from '@/lib/types'
import { REGIONALIZATION_FACTORS } from '@/lib/regionalization'
import type { Pathway } from '@/lib/stateConfig'
import { getStateConfig } from '@/lib/stateConfig'

const REGIONAL_DEFAULTS: Record<string, { frl: number; iep: number; ell: number; hicap: number }> = {
  'king_county': { frl: 35, iep: 14, ell: 15, hicap: 7 },
  'pierce_county': { frl: 50, iep: 13, ell: 10, hicap: 5 },
  'snohomish_county': { frl: 40, iep: 13, ell: 12, hicap: 6 },
  'spokane_county': { frl: 55, iep: 14, ell: 8, hicap: 4 },
  'clark_county': { frl: 45, iep: 13, ell: 9, hicap: 5 },
  'other': { frl: 50, iep: 13, ell: 10, hicap: 5 },
}

function formatRegionName(key: string): string {
  const entry = REGIONALIZATION_FACTORS[key]
  if (entry) return entry.label.split('(')[0].trim()
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface Props {
  enrollment: number
  region: string
  openingGrades?: string[]
  initialData: {
    pctFrl: number
    pctIep: number
    pctEll: number
    pctHicap: number
  }
  pathway?: Pathway
  onNext: (data: { pctFrl: number; pctIep: number; pctEll: number; pctHicap: number }) => void
  onSkip?: () => void
  onBack: () => void
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function StepDemographics({ enrollment, region, openingGrades, initialData, pathway, onNext, onSkip, onBack }: Props) {
  const config = getStateConfig(pathway)
  const isWaCharter = config.pathway === 'wa_charter'
  const isOptional = config.pathway === 'generic_private' || config.pathway === 'generic_micro'
  const showRegionalDefaults = isWaCharter && !!region

  const [pctFrl, setPctFrl] = useState(initialData.pctFrl ?? 50)
  const [pctIep, setPctIep] = useState(initialData.pctIep ?? 12)
  const [pctEll, setPctEll] = useState(initialData.pctEll ?? 10)
  const [pctHicap, setPctHicap] = useState(initialData.pctHicap ?? 5)
  const [showRegionalHint, setShowRegionalHint] = useState(false)

  const regionDefaults = REGIONAL_DEFAULTS[region] || REGIONAL_DEFAULTS['other']

  const rev = useMemo(() => {
    const sse = calcSmallSchoolEnhancementFromGrades(
      enrollment,
      openingGrades || [],
      DEFAULT_ASSUMPTIONS.aafte_pct,
      DEFAULT_ASSUMPTIONS.regular_ed_per_pupil,
      DEFAULT_ASSUMPTIONS.regionalization_factor || 1.0,
    )
    return calcCommissionRevenue(enrollment, pctFrl, pctIep, pctEll, pctHicap, DEFAULT_ASSUMPTIONS, 1, sse)
  }, [enrollment, pctFrl, pctIep, pctEll, pctHicap, openingGrades])

  const demographicRevenue = rev.stateSped + rev.sped + rev.idea + rev.titleI + rev.lap + rev.lapHighPoverty + rev.tbip + rev.hicap
  const totalRevenue = rev.total
  const demoPct = totalRevenue > 0 ? ((demographicRevenue / totalRevenue) * 100).toFixed(1) : '0'

  function applyRegionalDefaults() {
    setPctFrl(regionDefaults.frl)
    setPctIep(regionDefaults.iep)
    setPctEll(regionDefaults.ell)
    setPctHicap(regionDefaults.hicap)
    setShowRegionalHint(false)
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault()
    onNext({ pctFrl, pctIep, pctEll, pctHicap })
  }

  const titleIWarning = pctFrl > 0 && pctFrl <= 40
  const highIep = pctIep > 18

  return (
    <form onSubmit={handleNext} className="space-y-6 max-w-2xl">
      {/* Optional banner for private/micro */}
      {isOptional && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <p className="text-sm text-blue-800">
            Demographics are optional for {config.display_name.toLowerCase()}s. If your school will apply for any public funding (e.g., Title I services, IDEA passthrough), enter your estimates below. Otherwise, skip this step.
          </p>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="mt-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 px-4 py-1.5 rounded-lg transition-colors"
            >
              Skip This Step
            </button>
          )}
        </div>
      )}

      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-500 max-w-md">
          {isOptional
            ? 'If you expect to serve students with IEPs or apply for federal grants, enter your demographic estimates below.'
            : 'Student demographics determine categorical grant eligibility. Use your community assessment data or start with regional averages.'}
        </p>
        {showRegionalDefaults && (
          <button
            type="button"
            onClick={() => setShowRegionalHint(!showRegionalHint)}
            className="text-xs text-teal-600 hover:text-teal-800 font-medium whitespace-nowrap ml-4"
          >
            Use {formatRegionName(region)} defaults
          </button>
        )}
      </div>

      {showRegionalHint && (
        <div className="bg-teal-50 border border-teal-100 rounded-lg p-4">
          <p className="text-sm text-teal-800 mb-2">
            Regional averages for <span className="font-medium">{formatRegionName(region)}</span>:
          </p>
          <div className="grid grid-cols-4 gap-3 text-xs text-teal-700 mb-3">
            <div>FRL: {regionDefaults.frl}%</div>
            <div>IEP: {regionDefaults.iep}%</div>
            <div>ELL: {regionDefaults.ell}%</div>
            <div>HiCap: {regionDefaults.hicap}%</div>
          </div>
          <button
            type="button"
            onClick={applyRegionalDefaults}
            className="text-xs font-medium text-teal-700 bg-teal-100 hover:bg-teal-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            Apply These Defaults
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <SliderField
            label="Free/Reduced Lunch"
            value={pctFrl}
            onChange={setPctFrl}
            min={0}
            max={100}
            regional={regionDefaults.frl}
          />
          <SliderField
            label="Students with IEPs"
            value={pctIep}
            onChange={setPctIep}
            min={0}
            max={100}
            regional={regionDefaults.iep}
          />
          <SliderField
            label="English Language Learners"
            value={pctEll}
            onChange={setPctEll}
            min={0}
            max={60}
            regional={regionDefaults.ell}
          />
          <SliderField
            label="Highly Capable"
            value={pctHicap}
            onChange={setPctHicap}
            min={0}
            max={15}
            regional={regionDefaults.hicap}
          />
        </div>

        <div>
          <div className="bg-slate-50 rounded-xl p-5 sticky top-4">
            {isOptional ? (
              /* Private/Micro: no categorical grant lines */
              <>
                <h3 className="text-sm font-semibold text-slate-800 mb-4">Demographics Impact</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Private schools typically do not receive categorical public funding (Title I, IDEA, etc.). Demographics you enter here help the advisory panel provide more relevant staffing and program recommendations.
                </p>
                {pctIep > 0 && (
                  <div className="mt-4 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                    <p className="text-xs text-teal-700">
                      IEP at {pctIep}% — budget for learning support staff or contracted special education services.
                    </p>
                  </div>
                )}
              </>
            ) : (
              /* WA Charter and Generic Charter: show grant estimates */
              <>
                <h3 className="text-sm font-semibold text-slate-800 mb-4">Demographic-Driven Revenue</h3>
                <p className="text-xs text-slate-400 mb-4">Based on {enrollment} students</p>
                <div className="space-y-2">
                  {isWaCharter && (
                    <>
                      {/* WA-specific Special Education group */}
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide pt-1">Special Education</div>
                      <GrantRow label="State Special Education" value={rev.stateSped} />
                      <GrantRow label="SPED Apportionment" value={rev.sped} />
                    </>
                  )}

                  {/* Federal programs — available to all charter types */}
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide pt-1">{isWaCharter ? '' : 'Federal Programs'}</div>
                  <GrantRow label="IDEA (Federal)" value={rev.idea} />
                  <GrantRow label="Title I" value={rev.titleI} note={pctFrl <= 40 ? '(requires >40% FRL)' : undefined} />

                  {isWaCharter && (
                    <>
                      {/* WA-specific state categorical */}
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide pt-2">State Categorical</div>
                      <GrantRow label="LAP" value={rev.lap} />
                      <GrantRow label="LAP High Poverty" value={rev.lapHighPoverty} />
                      <GrantRow label="TBIP (Bilingual)" value={rev.tbip} />
                      <GrantRow label="Highly Capable" value={rev.hicap} />
                    </>
                  )}

                  <div className="border-t border-slate-200 pt-3 mt-3">
                    <div className="flex justify-between font-semibold text-slate-800">
                      <span>Total Demographic Revenue</span>
                      <span>{fmt(demographicRevenue)}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {demoPct}% of total estimated revenue
                    </p>
                  </div>
                </div>

                {/* Compliance callouts */}
                {titleIWarning && (
                  <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-amber-700">
                      FRL at {pctFrl}% — just below the 40% Title I threshold. A small increase unlocks {fmt(Math.round(enrollment * (pctFrl / 100) * DEFAULT_ASSUMPTIONS.title_i_per_pupil))}.
                    </p>
                  </div>
                )}
                {highIep && (
                  <div className="mt-4 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                    <p className="text-xs text-teal-700">
                      IEP at {pctIep}% — above typical ({regionDefaults.iep}%). Budget for additional special education staff and contracted services.
                    </p>
              </div>
            )}

            <p className="text-xs text-slate-400 mt-4 italic">These are estimates only. Actual awards vary.</p>
              </>
            )}
          </div>
        </div>
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
          className="bg-teal-600 text-white px-8 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors"
        >
          Continue
        </button>
        {isOptional && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="px-6 py-2.5 rounded-lg font-medium text-slate-500 hover:text-slate-700 transition-colors"
          >
            Skip
          </button>
        )}
      </div>
    </form>
  )
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  regional,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  regional: number
}) {
  const labelId = useId()
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span id={labelId} className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm font-semibold text-slate-800">{value}%</span>
      </div>
      <input
        type="range"
        aria-labelledby={labelId}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-teal-600"
      />
      <div className="flex justify-between text-xs text-slate-400">
        <span>{min}%</span>
        {regional > 0 && <span className="text-slate-400">Avg: {regional}%</span>}
        <span>{max}%</span>
      </div>
    </div>
  )
}

function GrantRow({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-600">
        {label}
        {note && <span className="text-xs text-slate-400 ml-1">{note}</span>}
      </span>
      <span className={`font-medium ${value > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
        {fmt(value)}
      </span>
    </div>
  )
}
