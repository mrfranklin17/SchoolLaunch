'use client'

import { useState, useMemo } from 'react'
import { ALL_GRADES, sortGrades, deriveGradeConfig } from '@/lib/gradeExpansion'
import { REGIONALIZATION_FACTORS } from '@/lib/regionalization'
import { US_STATES, derivePathway, getStateConfig } from '@/lib/stateConfig'
import type { Pathway } from '@/lib/stateConfig'
import Tooltip from '@/components/ui/Tooltip'
import { FormField } from '@/components/ui/FormField'
import { openingYearOptions } from '@/lib/openingYears'

const COUNTY_KEYS = Object.keys(REGIONALIZATION_FACTORS)


const SCHOOL_TYPES = [
  { value: 'charter' as const, label: 'Charter School', description: 'Publicly funded, independently operated' },
  { value: 'private' as const, label: 'Private School', description: 'Tuition-funded independent school' },
  { value: 'micro' as const, label: 'Micro School', description: 'Small-format, typically under 150 students' },
]

const FISCAL_YEAR_MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
]

interface Props {
  initialData: {
    schoolName: string
    region: string
    plannedOpenYear: number
    foundingGrades: string[]
    buildoutGrades: string[]
    state?: string
    schoolType?: 'charter' | 'private' | 'micro'
    fiscalYearStartMonth?: number
  }
  onNext: (data: {
    schoolName: string
    region: string
    plannedOpenYear: number
    foundingGrades: string[]
    buildoutGrades: string[]
    gradeConfig: string
    regionalizationFactor: number
    state: string
    schoolType: 'charter' | 'private' | 'micro'
    pathway: Pathway
    fiscalYearStartMonth: number
  }) => void
}

export default function StepIdentity({ initialData, onNext }: Props) {
  const [schoolName, setSchoolName] = useState(initialData.schoolName)
  const initialPathwayChoice: 'wa_charter' | 'other' =
    derivePathway(initialData.state || 'WA', initialData.schoolType || 'charter') === 'wa_charter'
      ? 'wa_charter'
      : 'other'
  const [pathwayChoice, setPathwayChoice] = useState<'wa_charter' | 'other'>(initialPathwayChoice)
  const [selectedState, setSelectedState] = useState(initialData.state || 'WA')
  const [schoolType, setSchoolType] = useState<'charter' | 'private' | 'micro'>(initialData.schoolType || 'charter')
  // Map old region labels to county keys for backward compat
  const initialCountyKey = COUNTY_KEYS.includes(initialData.region)
    ? initialData.region
    : COUNTY_KEYS.find((k) => REGIONALIZATION_FACTORS[k].label === initialData.region) || 'king_county'
  const [region, setRegion] = useState(initialCountyKey)
  const [years] = useState(() => openingYearOptions(initialData.plannedOpenYear))
  const [plannedOpenYear, setPlannedOpenYear] = useState(initialData.plannedOpenYear || years[0])
  const [foundingGrades, setFoundingGrades] = useState<string[]>(
    initialData.foundingGrades.length > 0 ? initialData.foundingGrades : []
  )
  const [buildoutGrades, setBuildoutGrades] = useState<string[]>(
    initialData.buildoutGrades.length > 0 ? initialData.buildoutGrades : []
  )
  const [touched, setTouched] = useState(false)

  // Derive pathway from current selections
  const pathway = derivePathway(selectedState, schoolType)
  const isWaCharter = pathway === 'wa_charter'

  // Fiscal year start month — initialized from config for current pathway
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(() => {
    // If the initial pathway is already non-WA, use whatever was saved
    const initialPathway = derivePathway(initialData.state || 'WA', initialData.schoolType || 'charter')
    if (initialPathway !== 'wa_charter' && initialData.fiscalYearStartMonth) {
      return initialData.fiscalYearStartMonth
    }
    // Otherwise use the config default for the current pathway
    return getStateConfig(initialPathway).fiscal_year_start_month
  })

  const nameError = touched && schoolName.trim().length < 3 ? 'School name must be at least 3 characters' : null
  const gradesError = touched && foundingGrades.length === 0 ? 'Select at least one founding grade' : null
  const buildoutError = touched && buildoutGrades.length === 0 ? 'Select at least one build-out grade' : null

  function toggleFoundingGrade(grade: string) {
    setFoundingGrades((prev) => {
      const next = prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade]
      // Auto-add to buildout if not already there
      if (!prev.includes(grade)) {
        setBuildoutGrades((bo) => bo.includes(grade) ? bo : sortGrades([...bo, grade]))
      }
      return sortGrades(next)
    })
  }

  function toggleBuildoutGrade(grade: string) {
    setBuildoutGrades((prev) => {
      if (prev.includes(grade)) {
        // Don't allow removing a founding grade from buildout
        if (foundingGrades.includes(grade)) return prev
        return prev.filter((g) => g !== grade)
      }
      return sortGrades([...prev, grade])
    })
  }

  const summary = useMemo(() => {
    if (foundingGrades.length === 0 || buildoutGrades.length === 0) return null
    const sortedFounding = sortGrades(foundingGrades)
    const sortedBuildout = sortGrades(buildoutGrades)
    const fFirst = sortedFounding[0]
    const fLast = sortedFounding[sortedFounding.length - 1]
    const bFirst = sortedBuildout[0]
    const bLast = sortedBuildout[sortedBuildout.length - 1]
    const foundingLabel = fFirst === fLast ? fFirst : `${fFirst}–${fLast}`
    const buildoutLabel = bFirst === bLast ? bFirst : `${bFirst}–${bLast}`
    const expansionGrades = buildoutGrades.length - foundingGrades.length
    return {
      foundingLabel,
      buildoutLabel,
      foundingCount: foundingGrades.length,
      buildoutCount: buildoutGrades.length,
      expansionGrades,
    }
  }, [foundingGrades, buildoutGrades])

  function handleNext(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (schoolName.trim().length < 3) return
    if (foundingGrades.length === 0 || buildoutGrades.length === 0) return
    onNext({
      schoolName: schoolName.trim(),
      region: isWaCharter ? region : '',
      plannedOpenYear,
      foundingGrades,
      buildoutGrades,
      gradeConfig: deriveGradeConfig(buildoutGrades),
      regionalizationFactor: isWaCharter ? (REGIONALIZATION_FACTORS[region]?.factor ?? 1.0) : 1.0,
      state: selectedState,
      schoolType,
      pathway,
      fiscalYearStartMonth: isWaCharter ? 9 : fiscalYearStartMonth,
    })
  }

  return (
    <form onSubmit={handleNext} className="space-y-6 max-w-xl">
      <p className="text-sm text-slate-500">
        Tell us about your school. This information shapes the financial model.
      </p>

      {/* Pathway tile selector */}
      <div role="radiogroup" aria-label="School pathway" className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PathwayTile
          selected={pathwayChoice === 'wa_charter'}
          title="Washington State Charter School"
          description="Commission-aligned financial planning for WA charter applicants"
          onSelect={() => {
            setPathwayChoice('wa_charter')
            setSelectedState('WA')
            setSchoolType('charter')
            setFiscalYearStartMonth(9)
          }}
        />
        <PathwayTile
          selected={pathwayChoice === 'other'}
          title="Another state or school type"
          description="Charter, private, or micro school outside Washington"
          onSelect={() => {
            setPathwayChoice('other')
            // If user is leaving WA charter, default state to non-WA so derivePathway returns generic_charter
            if (selectedState === 'WA' && schoolType === 'charter') {
              setSelectedState('OR')
              setFiscalYearStartMonth(getStateConfig(derivePathway('OR', schoolType)).fiscal_year_start_month)
            }
          }}
        />
      </div>

      {/* State + School Type — only when "Another state or school type" tile is selected */}
      {pathwayChoice === 'other' && (
        <>
          <FormField label="State">
            {(id) => (
              <select
                id={id}
                value={selectedState}
                onChange={(e) => {
                  const newState = e.target.value
                  setSelectedState(newState)
                  // Update fiscal year default when pathway changes
                  const newPathway = derivePathway(newState, schoolType)
                  if (newPathway !== 'wa_charter') {
                    setFiscalYearStartMonth(getStateConfig(newPathway).fiscal_year_start_month)
                  }
                }}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900 bg-white"
              >
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label="School Type">
            {() => (
              <div role="radiogroup" aria-label="School Type" className="grid grid-cols-3 gap-3">
                {SCHOOL_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={schoolType === t.value}
                    onClick={() => {
                      setSchoolType(t.value)
                      // Update fiscal year default from config when switching types
                      const newPathway = derivePathway(selectedState, t.value)
                      if (newPathway !== 'wa_charter') {
                        setFiscalYearStartMonth(getStateConfig(newPathway).fiscal_year_start_month)
                      }
                    }}
                    className={`px-3 py-3 rounded-lg border-2 text-left transition-all ${
                      schoolType === t.value
                        ? 'border-teal-600 bg-teal-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className={`text-sm font-medium ${schoolType === t.value ? 'text-teal-700' : 'text-slate-700'}`}>
                      {t.label}
                    </div>
                    <div className={`text-xs mt-0.5 ${schoolType === t.value ? 'text-teal-600' : 'text-slate-400'}`}>
                      {t.description}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </FormField>
        </>
      )}

      <FormField label="School Name" required errorText={nameError ?? undefined}>
        {(id) => (
          <input
            id={id}
            type="text"
            value={schoolName}
            onChange={(e) => { setSchoolName(e.target.value); setTouched(true) }}
            className={`w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900 ${
              nameError ? 'border-red-300 bg-red-50' : 'border-slate-300'
            }`}
            placeholder="e.g., Cascade Academy"
          />
        )}
      </FormField>

      {/* WA County/Region — only for WA Charter pathway */}
      {isWaCharter && (
        <FormField
          label="WA County / Region"
          helperText={`County sets the regionalization factor (${REGIONALIZATION_FACTORS[region]?.factor.toFixed(3) ?? '1.000'}×) which adjusts state funding rates based on your school's location.`}
        >
          {(id) => (
            <select
              id={id}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900 bg-white"
            >
              {COUNTY_KEYS.map((key) => (
                <option key={key} value={key}>{REGIONALIZATION_FACTORS[key].label}</option>
              ))}
            </select>
          )}
        </FormField>
      )}

      {/* Fiscal Year Start Month — only for non-WA pathways */}
      {!isWaCharter && (
        <FormField
          label="Fiscal Year Start Month"
          helperText="When your school's fiscal year begins. Most charter schools use July; most private schools use September."
        >
          {(id) => (
            <select
              id={id}
              value={fiscalYearStartMonth}
              onChange={(e) => setFiscalYearStartMonth(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900 bg-white"
            >
              {FISCAL_YEAR_MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
        </FormField>
      )}

      <FormField label="Planned Opening Year">
        {(id) => (
          <select
            id={id}
            value={plannedOpenYear}
            onChange={(e) => setPlannedOpenYear(Number(e.target.value))}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900 bg-white"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}–{y + 1} School Year</option>
            ))}
          </select>
        )}
      </FormField>

      {/* Founding Grades */}
      <FormField
        label="Founding Grades — grades you will serve in Year 1"
        required
        errorText={gradesError ?? undefined}
      >
        {() => (
          <div role="group" aria-label="Founding Grades" className="flex flex-wrap gap-1.5">
            {ALL_GRADES.map((g) => {
              const selected = foundingGrades.includes(g)
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleFoundingGrade(g)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                    selected
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {g}
                </button>
              )
            })}
          </div>
        )}
      </FormField>

      {/* Build-Out Grades */}
      <FormField
        label="Grades at Full Build-Out — all grades you will eventually serve"
        required
        helperText="Founding grades are pre-selected. Additional grades will be added during expansion years."
        errorText={buildoutError ?? undefined}
      >
        {() => (
          <div role="group" aria-label="Grades at Full Build-Out" className="flex flex-wrap gap-1.5">
            {ALL_GRADES.map((g) => {
              const selected = buildoutGrades.includes(g)
              const isFounding = foundingGrades.includes(g)
              return (
                <Tooltip key={g} content={isFounding ? 'Founding grade (included automatically)' : null}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleBuildoutGrade(g)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                      selected
                        ? isFounding
                          ? 'border-teal-600 bg-teal-100 text-teal-800 cursor-default'
                          : 'border-teal-600 bg-teal-50 text-teal-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    {g}
                    {isFounding && selected && (
                      <span className="ml-1 text-xs text-teal-500">F</span>
                    )}
                  </button>
                </Tooltip>
              )
            })}
          </div>
        )}
      </FormField>

      {/* Dynamic Summary */}
      {summary && (
        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
          <p className="text-sm font-medium text-teal-800">
            Opening with {summary.foundingLabel} ({summary.foundingCount} {summary.foundingCount === 1 ? 'grade' : 'grades'})
            {' → '}
            Growing to {summary.buildoutLabel} ({summary.buildoutCount} {summary.buildoutCount === 1 ? 'grade' : 'grades'})
          </p>
          {summary.expansionGrades > 0 && (
            <p className="text-xs text-teal-600 mt-1">
              {summary.expansionGrades} {summary.expansionGrades === 1 ? 'grade' : 'grades'} added during expansion (Years 2–5)
            </p>
          )}
          {summary.expansionGrades === 0 && (
            <p className="text-xs text-teal-600 mt-1">
              No expansion — all grades served from Year 1
            </p>
          )}
        </div>
      )}

      <div className="pt-4">
        <button
          type="submit"
          className="bg-teal-600 text-white px-8 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors"
        >
          Continue
        </button>
      </div>
    </form>
  )
}

function PathwayTile({
  selected,
  title,
  description,
  onSelect,
}: {
  selected: boolean
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`relative text-left rounded-xl border-2 px-5 py-4 transition-all ${
        selected
          ? 'border-[var(--navy-dark)] bg-slate-50'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
      style={selected ? { background: 'rgba(17, 29, 53, 0.04)' } : undefined}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="absolute top-3 right-3 inline-flex items-center justify-center w-6 h-6 rounded-full text-white"
          style={{ background: 'var(--navy-dark)' }}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      <div
        className={`text-sm font-semibold pr-8 ${selected ? 'text-slate-900' : 'text-slate-800'}`}
        style={{ fontFamily: 'var(--font-heading-var)' }}
      >
        {title}
      </div>
      <p className={`text-xs mt-1 ${selected ? 'text-slate-600' : 'text-slate-500'}`}>
        {description}
      </p>
    </button>
  )
}
