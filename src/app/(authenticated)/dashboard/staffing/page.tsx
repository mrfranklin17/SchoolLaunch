'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { calcBenefits } from '@/lib/calculations'
import { createClient } from '@/lib/supabase/client'
import { replaceStaffingPositions, replaceFailureMessage } from '@/lib/atomicReplace'
import { COMMISSION_POSITIONS, getCommissionPosition } from '@/lib/types'
import { SALARY_SOURCE_NOTE } from '@/lib/staffingDefaults'
import { expansionToEnrollmentArray, getRetentionRate } from '@/lib/gradeExpansion'
import { evaluatePersonnelPct, healthColor, healthPathway } from '@/lib/healthThresholds'
import { personnelPctOfRevenue } from '@/lib/budgetEngine'
import { usePermissions } from '@/hooks/usePermissions'
import Tooltip from '@/components/ui/Tooltip'
import { PageHeader } from '@/components/ui/PageHeader'
import { StaffingSkeleton } from '../_skeletons'
import { Callout } from '@/components/ui/Callout'
import { toast } from '@/components/ui/Toast'

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtFte(n: number) {
  return n % 1 === 0 ? n.toString() : n.toFixed(1)
}

// ─── Cascade cue key helper ──────────────────────────────────────────────────
// Stable composite key for tracking cells whose FTE value was raised by the
// cascade-forward UX in updateFte. Used by both StaffingPage state handlers
// and PositionRow's render-time className.
const cellKey = (id: string, yi: number) => `${id}:${yi}`

// ─── Authoritative classification mapping by position type ────────────────────
// These override whatever is stored in the DB or in COMMISSION_POSITIONS.

const POSITION_CLASSIFICATION: Record<string, 'Administrative' | 'Certificated' | 'Classified'> = {
  // Administrative
  ceo_director: 'Administrative',
  principal: 'Administrative',
  asst_principal: 'Administrative',
  coo: 'Administrative',
  cfo: 'Administrative',
  nutrition_mgr: 'Administrative',
  facilities_mgr: 'Administrative',
  // Certificated
  teacher_elem: 'Certificated',
  teacher_ms: 'Certificated',
  teacher_hs: 'Certificated',
  sped_teacher: 'Certificated',
  el_specialist: 'Certificated',
  instructional_coach: 'Certificated',
  interventionist: 'Certificated',
  counselor: 'Certificated',
  social_worker: 'Certificated',
  psychologist: 'Certificated',
  substitute_pool: 'Certificated',
  // Classified
  paraeducator: 'Classified',
  registrar: 'Classified',
  office_mgr: 'Classified',
  it_coordinator: 'Classified',
  custodian: 'Classified',
  food_service: 'Classified',
  security: 'Classified',
  transport_coord: 'Classified',
  hr_specialist: 'Classified',
  // Fallback
  custom: 'Classified',
}

// ─── Authoritative driver mapping by position type ────────────────────────────

const POSITION_DRIVER: Record<string, string> = {
  // Fixed
  ceo_director: 'fixed',
  principal: 'fixed',
  asst_principal: 'fixed',
  coo: 'fixed',
  cfo: 'fixed',
  office_mgr: 'fixed',
  counselor: 'fixed',
  social_worker: 'fixed',
  psychologist: 'fixed',
  nutrition_mgr: 'fixed',
  facilities_mgr: 'fixed',
  it_coordinator: 'fixed',
  security: 'fixed',
  transport_coord: 'fixed',
  hr_specialist: 'fixed',
  registrar: 'fixed',
  // Per Pupil
  teacher_elem: 'per_pupil',
  teacher_ms: 'per_pupil',
  teacher_hs: 'per_pupil',
  instructional_coach: 'per_pupil',
  interventionist: 'per_pupil',
  paraeducator: 'per_pupil',
  custodian: 'per_pupil',
  food_service: 'per_pupil',
  substitute_pool: 'per_pupil',
  // SPED — fixed by default (1 FTE is sufficient; user can override)
  sped_teacher: 'fixed',
  // Per Pupil - EL
  el_specialist: 'per_pupil_el',
  // Fallback
  custom: 'fixed',
}

// ─── Students per position (for FTE auto-scaling) ─────────────────────────────

const POSITION_STUDENTS_PER: Record<string, number> = {
  teacher_elem: 24,
  teacher_ms: 24,
  teacher_hs: 24,
  sped_teacher: 12,
  el_specialist: 30,
  instructional_coach: 200,
  interventionist: 50,
  paraeducator: 48,
  custodian: 200,
  food_service: 100,
  substitute_pool: 200,
  asst_principal: 300,
}

function getClassification(positionType: string): 'Administrative' | 'Certificated' | 'Classified' {
  return POSITION_CLASSIFICATION[positionType] || 'Classified'
}

function getDriver(positionType: string): string {
  return POSITION_DRIVER[positionType] || 'fixed'
}

function getStudentsPerPosition(positionType: string): number {
  return POSITION_STUDENTS_PER[positionType] || 0
}

function classificationToCategory(cls: string): 'certificated' | 'classified' | 'admin' {
  if (cls === 'Administrative') return 'admin'
  if (cls === 'Certificated') return 'certificated'
  return 'classified'
}

// ─── Position type grouping for dropdown ──────────────────────────────────────

const ADMIN_TYPES = COMMISSION_POSITIONS.filter((cp) => getClassification(cp.type) === 'Administrative')
const CERT_TYPES = COMMISSION_POSITIONS.filter((cp) => getClassification(cp.type) === 'Certificated')
const CLASS_TYPES = COMMISSION_POSITIONS.filter((cp) => getClassification(cp.type) === 'Classified')

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MultiYearPosition {
  id: string
  positionType: string
  title: string
  classification: 'Administrative' | 'Certificated' | 'Classified'
  category: 'certificated' | 'classified' | 'admin'
  salary: number
  benchmarkSalary: number
  driver: string
  studentsPerPosition: number
  fte: [number, number, number, number, number]
  // Per-year manual-override flags. Set true when a user manually edits a
  // Y2-Y5 cell on a per-pupil-driver position; recompute paths skip flagged
  // indices so user values survive Y1 edits, type changes, and driver toggles.
  // Y1 (index 0) is never flagged — Y1 is the seed for per-pupil scaling.
  manualOverride: [boolean, boolean, boolean, boolean, boolean]
  sortOrder: number
}

let nextId = 0
function tempId() { return `new-${++nextId}` }

function inferPositionType(title: string): string {
  const t = title.toLowerCase().trim()
  if (/\bceo\b/.test(t) || /\bexecutive director\b/.test(t)) return 'ceo_director'
  if (/\bassistant principal\b/.test(t) || /\bvice principal\b/.test(t) || /\bap\b/.test(t)) return 'asst_principal'
  if (/\bprincipal\b/.test(t) || /\bhead of school\b/.test(t)) return 'principal'
  if (/\bregistrar\b/.test(t) || /\benrollment manager\b/.test(t)) return 'registrar'
  if (/\bcoo\b/.test(t) || /\boperations manager\b/.test(t)) return 'coo'
  if (/\bcfo\b/.test(t) || /\bfinance\b/.test(t) || /\bbusiness manager\b/.test(t)) return 'cfo'
  if (/\bit coordinator\b/.test(t)) return 'it_coordinator'
  if (/\bfacilities manager\b/.test(t)) return 'facilities_mgr'
  if (/\bnutrition\b/.test(t)) return 'nutrition_mgr'
  if (/\bspecial ed\b/.test(t) || /\bsped\b/.test(t)) return 'sped_teacher'
  if (/\bell teacher\b/.test(t) || /\bell specialist\b/.test(t) || /\benglish learner\b/.test(t)) return 'el_specialist'
  if (/\binstructional coach\b/.test(t) || /\bcurriculum\b/.test(t)) return 'instructional_coach'
  if (/\bintervention\b/.test(t)) return 'interventionist'
  if (/\bsubstitute\b/.test(t)) return 'substitute_pool'
  if (/\bsubject teacher\b/.test(t)) return 'teacher_ms'
  if (/\bteacher\b/.test(t)) return 'teacher_elem'
  if (/\bparaeducator\b/.test(t) || /\bpara\b/.test(t) || /\binstructional aide\b/.test(t)) return 'paraeducator'
  if (/\bcounselor\b/.test(t)) return 'counselor'
  if (/\bsocial worker\b/.test(t)) return 'social_worker'
  if (/\bpsychologist\b/.test(t)) return 'psychologist'
  if (/\boffice manager\b/.test(t) || /\badministrative assistant\b/.test(t)) return 'office_mgr'
  if (/\bhuman resources\b/.test(t) || /\bhr\b/.test(t)) return 'hr_specialist'
  if (/\bcustodian\b/.test(t) || /\bjanitor\b/.test(t)) return 'custodian'
  if (/\bsecurity\b/.test(t) || /\bsafety\b/.test(t)) return 'security'
  if (/\bfood service\b/.test(t)) return 'food_service'
  if (/\btransportation\b/.test(t)) return 'transport_coord'
  return 'custom'
}

const CLASSIFICATION_COLORS: Record<string, { bg: string; text: string }> = {
  Administrative: { bg: 'bg-purple-50', text: 'text-purple-700' },
  Certificated: { bg: 'bg-blue-50', text: 'text-blue-700' },
  Classified: { bg: 'bg-slate-100', text: 'text-slate-600' },
}

const DRIVER_LABELS: Record<string, string> = {
  fixed: 'Fixed',
  per_pupil: 'Per Pupil',
  per_pupil_sped: 'Per Pupil (SPED)',
  per_pupil_el: 'Per Pupil (EL)',
}

const TEACHER_TYPES = new Set(['teacher_elem', 'teacher_ms', 'teacher_hs'])

/** Is this a classroom teacher position whose FTE should match sections? */
function isTeacherType(positionType: string): boolean {
  return TEACHER_TYPES.has(positionType)
}

/** Compute smart default FTE for years 2-5 based on driver and enrollment growth.
 *  For teacher positions, uses sections-per-year from the grade expansion plan.
 *  For other per-pupil positions, scales proportionally with enrollment ratio. */
function computeSmartFte(
  y1Fte: number,
  driver: string,
  positionType: string,
  enrollments: number[],
  sectionsPerYear: number[],
): [number, number, number, number, number] {
  const fte: [number, number, number, number, number] = [y1Fte, y1Fte, y1Fte, y1Fte, y1Fte]
  if (driver === 'fixed' || enrollments[0] <= 0) return fte

  // Teacher positions: Y2-Y5 FTE = sections for that year, Y1 stays as provided
  if (isTeacherType(positionType) && sectionsPerYear[0] > 0) {
    fte[0] = y1Fte
    for (let y = 1; y <= 4; y++) {
      const sections = sectionsPerYear[y] || sectionsPerYear[y - 1] || y1Fte
      // If user overrode Y1 relative to sections, scale proportionally
      const y1Sections = sectionsPerYear[0]
      if (y1Fte !== y1Sections && y1Sections > 0) {
        fte[y] = Math.round((y1Fte / y1Sections) * sections * 2) / 2
      } else {
        fte[y] = sections
      }
    }
    return fte
  }

  // Other per-pupil positions: scale proportionally with enrollment ratio from Y1
  for (let y = 1; y <= 4; y++) {
    if (enrollments[y] <= 0) continue
    const ratio = enrollments[y] / enrollments[0]
    fte[y] = Math.round(y1Fte * ratio * 2) / 2
    if (fte[y] < y1Fte) fte[y] = y1Fte
  }
  return fte
}

/** Recalculate Y2-Y5 based on a new Y1 FTE value for a per-pupil position */
function recomputePerPupilFte(
  newY1: number,
  driver: string,
  positionType: string,
  enrollments: number[],
  sectionsPerYear: number[],
): [number, number, number, number, number] {
  return computeSmartFte(newY1, driver, positionType, enrollments, sectionsPerYear)
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StaffingPage() {
  const {
    schoolData: { schoolId, schoolName, positions: dbPositions, allPositions: dbAllPositions, gradeExpansionPlan, profile, loading, reload },
    assumptions,
    pathway,
    y1,
  } = useScenario()
  const { canEdit } = usePermissions()
  useDocumentTitle('Staffing', schoolName)
  const [positions, setPositions] = useState<MultiYearPosition[]>([])
  // Session-only set of cells whose FTE was raised by the cascade-forward UX.
  // Keyed by `${positionId}:${yearIndex}`. Cleared on save, useEffect rebuild,
  // and any handler that re-derives the whole row.
  const [cascadedCells, setCascadedCells] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [showAllYearsOnMobile, setShowAllYearsOnMobile] = useState(false)
  const seedingRef = useRef(false)
  const supabase = createClient()
  const benefitsRate = assumptions.benefits_load_pct / 100
  const salaryEscalator = assumptions.salary_escalator_pct / 100

  // Compute per-year enrollment from grade expansion plan
  const enrollments = useMemo(() => {
    if (gradeExpansionPlan.length > 0) {
      return expansionToEnrollmentArray(gradeExpansionPlan, getRetentionRate(profile))
    }
    return [
      profile.target_enrollment_y1,
      profile.target_enrollment_y2 || profile.target_enrollment_y1,
      profile.target_enrollment_y3 || profile.target_enrollment_y1,
      profile.target_enrollment_y4 || profile.target_enrollment_y1,
      profile.target_enrollment_y5 || profile.target_enrollment_y1,
    ]
  }, [gradeExpansionPlan, profile])

  // Compute total sections per year from grade expansion plan
  const sectionsPerYear = useMemo(() => {
    const result = [0, 0, 0, 0, 0]
    if (gradeExpansionPlan.length === 0) return result
    for (const entry of gradeExpansionPlan) {
      if (entry.year >= 1 && entry.year <= 5) {
        result[entry.year - 1] += entry.sections
      }
    }
    // Fill forward if plan doesn't cover all 5 years
    for (let i = 1; i < 5; i++) {
      if (result[i] === 0 && result[i - 1] > 0) result[i] = result[i - 1]
    }
    return result
  }, [gradeExpansionPlan])

  // Operating revenue for Year 1 (personnel % denominator) — the engine's Year-1 row, same source as Overview
  const y1Revenue = y1.revenue.operatingRevenue

  // Server-side seed: call API endpoint that atomically checks + inserts
  const ensureSeeded = useCallback(async () => {
    if (!schoolId || seedingRef.current) return
    seedingRef.current = true
    setSeeding(true)

    try {
      const res = await fetch('/api/staffing/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.seeded) {
          await reload()
        }
      }
    } catch (err) {
      console.error('Seed check failed:', err)
    }

    setSeeding(false)
  }, [schoolId, reload])

  useEffect(() => {
    // Rebuild from DB wipes any in-progress cascade cue — values are now DB-truth.
    setCascadedCells(new Set())
    // No positions loaded from the hook — ask the server to seed if needed
    if (dbPositions.length === 0 && dbAllPositions.length === 0) {
      if (schoolId && !seedingRef.current) ensureSeeded()
      return
    }

    const y1Positions = dbAllPositions.filter((p) => p.year === 1)
    const source = y1Positions.length > 0 ? y1Positions : dbPositions

    const result: MultiYearPosition[] = source.map((p, idx) => {
      const posType = (p.position_type && p.position_type !== 'custom') ? p.position_type : inferPositionType(p.title)
      const cp = getCommissionPosition(posType)

      const classification = getClassification(posType)
      const driver = getDriver(posType)
      const studentsPerPos = getStudentsPerPosition(posType)

      const fte: [number, number, number, number, number] = [0, 0, 0, 0, 0]
      fte[0] = p.fte
      const manualOverride: [boolean, boolean, boolean, boolean, boolean] = [false, false, false, false, false]
      manualOverride[0] = p.manual_override ?? false

      const hasMultiYear = dbAllPositions.some((ap) => ap.year > 1)

      if (hasMultiYear) {
        for (let y = 2; y <= 5; y++) {
          const match = dbAllPositions.find(
            (ap) => ap.year === y && ap.sort_order === p.sort_order && (ap.position_type === posType || ap.title === p.title)
          )
          fte[y - 1] = match?.fte ?? fte[0]
          manualOverride[y - 1] = match?.manual_override ?? false
        }
      } else {
        const smartFte = computeSmartFte(p.fte, driver, posType, enrollments, sectionsPerYear)
        for (let y = 1; y < 5; y++) fte[y] = smartFte[y]
      }

      return {
        id: p.id || tempId(),
        positionType: posType,
        title: p.title,
        classification,
        category: classificationToCategory(classification),
        salary: p.annual_salary,
        benchmarkSalary: p.benchmark_salary || cp?.salary || 0,
        driver,
        studentsPerPosition: studentsPerPos,
        fte,
        manualOverride,
        sortOrder: p.sort_order ?? idx,
      }
    })

    result.sort((a, b) => a.sortOrder - b.sortOrder)
    setPositions(result)
  }, [dbPositions, dbAllPositions, enrollments, sectionsPerYear, schoolId])

  function salaryForYear(baseSalary: number, year: number) {
    return Math.round(baseSalary * Math.pow(1 + salaryEscalator, year - 1))
  }

  // Compute per-year totals
  const yearTotals = useMemo(() => {
    return [0, 1, 2, 3, 4].map((yi) => {
      const year = yi + 1
      let totalFte = 0
      let totalSalaries = 0
      let totalBenefits = 0
      let certFte = 0
      let classFte = 0
      let adminFte = 0

      for (const pos of positions) {
        const fte = pos.fte[yi]
        const sal = salaryForYear(pos.salary, year) * fte
        totalFte += fte
        totalSalaries += sal
        totalBenefits += calcBenefits(sal, benefitsRate)
        if (pos.classification === 'Certificated') certFte += fte
        else if (pos.classification === 'Classified') classFte += fte
        else adminFte += fte
      }

      const totalPersonnel = totalSalaries + totalBenefits
      return { totalFte, totalSalaries, totalBenefits, totalPersonnel, certFte, classFte, adminFte }
    })
  }, [positions, benefitsRate, salaryEscalator])

  const y1Totals = yearTotals[0]
  // Shared definition (personnel ÷ operating revenue); the numerator is the live (possibly
  // unsaved) positions total so the badge responds while editing.
  const personnelPctY1 = y1Revenue > 0
    ? personnelPctOfRevenue({ personnel: { total: y1Totals.totalPersonnel }, revenue: y1.revenue }).toFixed(1)
    : '0'
  // Thresholds, labels and colors come from src/lib/healthThresholds.ts (R-HEALTH-01)
  const personnelHealth = evaluatePersonnelPct(Number(personnelPctY1), 1, healthPathway(pathway))

  function updateFte(id: string, yearIndex: number, value: number) {
    const target = positions.find((p) => p.id === id)
    if (!target) return

    // Per-pupil Y1 edit re-derives Y2-Y5 from the new Y1, but preserves any
    // cells the user has manually overridden (manualOverride flag honored).
    if (yearIndex === 0 && target.driver !== 'fixed') {
      setPositions((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p
          const recomputed = recomputePerPupilFte(value, p.driver, p.positionType, enrollments, sectionsPerYear)
          const fte = recomputed.map((v, i) => p.manualOverride[i] ? p.fte[i] : v) as [number, number, number, number, number]
          return { ...p, fte }
        })
      )
      setCascadedCells((prev) => {
        const next = new Set(prev)
        for (let j = 0; j < 5; j++) next.delete(cellKey(id, j))
        return next
      })
      return
    }

    // Otherwise: single-year edit (Y2-Y5 manual override OR fixed-driver any year).
    // Cascade forward only on a true increase for fixed-driver positions.
    // For per-pupil Y2-Y5 edits, mark manualOverride[yearIndex] so subsequent
    // recomputes (Y1 edit, type change, fixed→per-pupil toggle) preserve it.
    const oldValue = target.fte[yearIndex]
    const newlyCascaded: number[] = []
    if (target.driver === 'fixed' && value > oldValue) {
      for (let j = yearIndex + 1; j < 5; j++) {
        if (target.fte[j] < value) newlyCascaded.push(j)
      }
    }
    const markManualOverride = target.driver !== 'fixed' && yearIndex !== 0

    setPositions((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const fte = [...p.fte] as [number, number, number, number, number]
        fte[yearIndex] = value
        for (const j of newlyCascaded) fte[j] = value
        if (markManualOverride) {
          const manualOverride = [...p.manualOverride] as [boolean, boolean, boolean, boolean, boolean]
          manualOverride[yearIndex] = true
          return { ...p, fte, manualOverride }
        }
        return { ...p, fte }
      })
    )

    setCascadedCells((prev) => {
      const next = new Set(prev)
      // The user touched this cell — it's now user-owned, not cascade-derived.
      next.delete(cellKey(id, yearIndex))
      // Mark each newly-raised forward cell.
      for (const j of newlyCascaded) next.add(cellKey(id, j))
      return next
    })
  }

  function toggleDriver(id: string) {
    setPositions((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const catalogDefault = getDriver(p.positionType)
        // Positions whose catalog default is already 'fixed' have nothing to toggle to.
        if (catalogDefault === 'fixed') return p
        if (p.driver === 'fixed') {
          // Switching back to per-pupil scaling — re-derive Y2-Y5 from Y1,
          // but preserve cells the user has manually overridden.
          const recomputed = computeSmartFte(p.fte[0], catalogDefault, p.positionType, enrollments, sectionsPerYear)
          const newFte = recomputed.map((v, i) => p.manualOverride[i] ? p.fte[i] : v) as [number, number, number, number, number]
          return { ...p, driver: catalogDefault, fte: newFte }
        }
        // Switching to fixed — preserve existing FTE values intact.
        // manualOverride flags are intentionally preserved across the toggle so
        // they continue to protect values if the user toggles back to per-pupil.
        return { ...p, driver: 'fixed' }
      })
    )
    // Driver change either re-derives the row or unlocks cells for fresh editing —
    // either way, clear any cascade cue for this position.
    setCascadedCells((prev) => {
      const next = new Set(prev)
      for (let j = 0; j < 5; j++) next.delete(cellKey(id, j))
      return next
    })
  }

  function selectPositionType(id: string, type: string) {
    const cp = getCommissionPosition(type)
    if (!cp) return

    const driver = getDriver(type)
    const studentsPerPos = getStudentsPerPosition(type)

    setPositions((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        // For custom positions, keep the current section's classification
        const classification = type === 'custom' ? p.classification : getClassification(type)
        const recomputed = computeSmartFte(p.fte[0] || 1, driver, type, enrollments, sectionsPerYear)
        // Preserve manually-overridden cells across the type change.
        const newFte = recomputed.map((v, i) => p.manualOverride[i] ? p.fte[i] : v) as [number, number, number, number, number]
        return {
          ...p,
          positionType: type,
          title: type === 'custom' ? p.title : cp.name,
          classification,
          category: classificationToCategory(classification),
          benchmarkSalary: cp.salary,
          salary: cp.salary > 0 ? cp.salary : p.salary,
          driver,
          studentsPerPosition: studentsPerPos,
          fte: newFte,
        }
      })
    )
    // Type change re-derives all 5 years — clear cascade cue for this position.
    setCascadedCells((prev) => {
      const next = new Set(prev)
      for (let j = 0; j < 5; j++) next.delete(cellKey(id, j))
      return next
    })
  }

  function updateSalary(id: string, value: number) {
    setPositions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, salary: value } : p))
    )
  }

  function updateTitle(id: string, value: string) {
    setPositions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, title: value } : p))
    )
  }

  function addPosition(classification?: 'Administrative' | 'Certificated' | 'Classified') {
    const cls = classification || 'Classified'
    const fte = computeSmartFte(1, 'fixed', 'custom', enrollments, sectionsPerYear)
    setPositions((prev) => {
      const maxSort = prev.reduce((m, p) => Math.max(m, p.sortOrder), 0)
      return [
        ...prev,
        {
          id: tempId(),
          positionType: 'custom',
          title: 'New Position',
          classification: cls,
          category: classificationToCategory(cls),
          salary: 45000,
          benchmarkSalary: 0,
          driver: 'fixed',
          studentsPerPosition: 0,
          fte,
          manualOverride: [false, false, false, false, false],
          sortOrder: maxSort + 1,
        },
      ]
    })
  }

  function removePosition(id: string) {
    setPositions((prev) => prev.filter((p) => p.id !== id))
    setCascadedCells((prev) => {
      const next = new Set(prev)
      for (let j = 0; j < 5; j++) next.delete(cellKey(id, j))
      return next
    })
  }

  // Drag-and-drop reordering within a classification group
  const dragRef = useRef<{ id: string; classification: string } | null>(null)

  function handleDragStart(id: string, classification: string) {
    dragRef.current = { id, classification }
  }

  function handleDrop(targetId: string) {
    const drag = dragRef.current
    if (!drag || drag.id === targetId) { dragRef.current = null; return }

    setPositions((prev) => {
      const dragPos = prev.find((p) => p.id === drag.id)
      const dropPos = prev.find((p) => p.id === targetId)
      if (!dragPos || !dropPos) return prev
      // Only reorder within the same classification
      if (dragPos.classification !== dropPos.classification) return prev

      const group = prev.filter((p) => p.classification === dragPos.classification)
      const rest = prev.filter((p) => p.classification !== dragPos.classification)
      const fromIdx = group.findIndex((p) => p.id === drag.id)
      const toIdx = group.findIndex((p) => p.id === targetId)
      const [moved] = group.splice(fromIdx, 1)
      group.splice(toIdx, 0, moved)
      // Reassign sort orders within group
      group.forEach((p, i) => { p.sortOrder = i })

      // Rebuild full array maintaining classification group order
      const adminGroup = dragPos.classification === 'Administrative' ? group : (rest.filter((p) => p.classification === 'Administrative'))
      const certGroup = dragPos.classification === 'Certificated' ? group : (rest.filter((p) => p.classification === 'Certificated'))
      const classGroup = dragPos.classification === 'Classified' ? group : (rest.filter((p) => p.classification === 'Classified'))
      return [...adminGroup, ...certGroup, ...classGroup]
    })
    dragRef.current = null
  }

  async function save() {
    if (!schoolId) return
    setSaving(true)

    const rows: Array<{
      school_id: string
      year: number
      title: string
      category: string
      fte: number
      annual_salary: number
      position_type: string
      driver: string
      classification: string
      benchmark_salary: number
      students_per_position: number
      sort_order: number
      manual_override: boolean
    }> = []

    for (const pos of positions) {
      for (let y = 1; y <= 5; y++) {
        rows.push({
          school_id: schoolId,
          year: y,
          title: pos.title,
          category: pos.category,
          fte: pos.fte[y - 1],
          annual_salary: salaryForYear(pos.salary, y),
          position_type: pos.positionType,
          driver: pos.driver,
          classification: pos.classification,
          benchmark_salary: pos.benchmarkSalary,
          students_per_position: pos.studentsPerPosition,
          sort_order: pos.sortOrder,
          manual_override: pos.manualOverride[y - 1],
        })
      }
    }

    // Delete + insert in one transaction — a failed insert must not wipe the school's staffing.
    const result = await replaceStaffingPositions(supabase, schoolId, rows)
    if (!result.ok) {
      console.error('Save staffing failed:', result.message)
      setSaving(false)
      toast.error(replaceFailureMessage('staffing', result), { duration: Infinity })
      return
    }

    // Personnel totals are live-computed from staffing_positions —
    // no Total Personnel row to maintain in budget_projections.

    setSaving(false)
    toast.success('Saved')
    await reload()
    // Explicit cue reset — also fired implicitly by the useEffect rebuild that
    // reload() triggers, but explicit is clearer than relying on the side effect.
    setCascadedCells(new Set())
  }

  if (loading || seeding) {
    return <StaffingSkeleton />
  }

  // Group positions by classification for display
  const adminPositions = positions.filter((p) => p.classification === 'Administrative')
  const certPositions = positions.filter((p) => p.classification === 'Certificated')
  const classifiedPositions = positions.filter((p) => p.classification === 'Classified')

  const groups = [
    { label: 'Administrative', positions: adminPositions, color: CLASSIFICATION_COLORS.Administrative },
    { label: 'Certificated', positions: certPositions, color: CLASSIFICATION_COLORS.Certificated },
    { label: 'Classified', positions: classifiedPositions, color: CLASSIFICATION_COLORS.Classified },
  ]

  return (
    <div className="animate-fade-in">
      {!canEdit && (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
          You have view-only access. Contact the school owner to request edit permissions.
        </div>
      )}

      <PageHeader
        title="Staffing Plan"
        subtitle="Multi-year staffing projection — Commission V8 template format."
        badges={
          <div data-tour="personnel-pct" className={`text-sm font-semibold px-3 py-1.5 rounded-full ${healthColor(personnelHealth.status, 'twCard')}`}>
            Personnel: {personnelPctY1}% of Revenue
            <span className="text-[10px] opacity-70 ml-1">(Y1)</span>
          </div>
        }
      />

      {/* Enrollment context row */}
      <div className="mb-4 flex items-center gap-6 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Enrollment:</span>
        {enrollments.map((e, i) => (
          <span key={i}>Y{i + 1}: <span className="font-semibold text-slate-700">{e}</span></span>
        ))}
        {salaryEscalator > 0 && (
          <span className="ml-auto">Salary escalator: {(salaryEscalator * 100).toFixed(1)}%/yr</span>
        )}
      </div>

      {/* Personnel-% advisory — fires when outside the year-aware healthy band */}
      {/* Threshold and copy come from src/lib/healthThresholds.ts (F-001/F-011, R-HEALTH-01) */}
      {(() => {
        if (personnelHealth.status === 'meets' || personnelHealth.status === 'na') return null
        // Escalate to crit exactly when the value is outside the band's approaching range
        const variant = personnelHealth.status === 'fails' ? 'crit' : 'warn'
        const title = `Personnel at ${Number(personnelPctY1).toFixed(1)}% of Year 1 revenue`
        return (
          <div className="mb-4">
            <Callout variant={variant} title={title}>
              {personnelHealth.long}
            </Callout>
          </div>
        )
      })()}

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
      <div data-tour="staffing-table" data-mobile-key={showAllYearsOnMobile ? 'all' : 'key'} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm mb-4">
        <div className="overflow-x-auto">
          <table className="sl-table w-full text-sm">
            <thead>
              <tr>
                <th className="py-3 w-6"></th>
                <th className="text-left px-3 py-3 min-w-[220px]">Position</th>
                <th data-tour="driver-column" className="text-left px-2 py-3 w-[80px]">Driver</th>
                <th data-tour="bm-column" className="text-right px-2 py-3 w-[100px]">
                  <Tooltip content={SALARY_SOURCE_NOTE} position="top" multiline>
                    <span tabIndex={0} className="cursor-help border-b border-dotted border-slate-400">Salary (Y1)</span>
                  </Tooltip>
                </th>
                {[1, 2, 3, 4, 5].map((y) => (
                  <th key={y} data-year={y} {...(y === 1 ? { 'data-tour': 'year-columns' } : {})} className="text-right px-2 py-3 w-[70px]">Y{y} FTE</th>
                ))}
                <th className="px-2 py-3 w-[50px]"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupSection
                  key={group.label}
                  label={group.label}
                  classification={group.label as 'Administrative' | 'Certificated' | 'Classified'}
                  color={group.color}
                  positions={group.positions}
                  benefitsRate={benefitsRate}
                  onSelectType={selectPositionType}
                  onUpdateFte={updateFte}
                  onToggleDriver={toggleDriver}
                  onUpdateSalary={updateSalary}
                  onUpdateTitle={updateTitle}
                  onRemove={removePosition}
                  onAdd={addPosition}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                  canEdit={canEdit}
                  cascadedCells={cascadedCells}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200">
                <td className="px-3 py-2 font-semibold text-slate-700" colSpan={3}>Total FTE</td>
                <td className="px-2 py-2"></td>
                {yearTotals.map((yt, i) => (
                  <td key={i} className="text-right px-2 py-2 font-semibold text-slate-800">{fmtFte(yt.totalFte)}</td>
                ))}
                <td></td>
              </tr>
              <tr className="bg-slate-50">
                <td className="px-3 py-2 text-slate-600 font-medium" colSpan={3}>Total Salaries</td>
                <td className="px-2 py-2"></td>
                {yearTotals.map((yt, i) => (
                  <td key={i} className="text-right px-2 py-2 font-medium text-slate-700 text-xs">{fmt(yt.totalSalaries)}</td>
                ))}
                <td></td>
              </tr>
              <tr className="bg-slate-50">
                <td className="px-3 py-2 text-slate-600 font-medium" colSpan={3}>
                  Benefits ({assumptions.benefits_load_pct}%)
                </td>
                <td className="px-2 py-2"></td>
                {yearTotals.map((yt, i) => (
                  <td key={i} className="text-right px-2 py-2 font-medium text-slate-700 text-xs">{fmt(yt.totalBenefits)}</td>
                ))}
                <td></td>
              </tr>
              <tr className="bg-slate-100 border-t border-slate-300">
                <td className="px-3 py-3 font-bold text-slate-800" colSpan={3}>Total Personnel Cost</td>
                <td className="px-2 py-3"></td>
                {yearTotals.map((yt, i) => (
                  <td key={i} className="text-right px-2 py-3 font-bold text-slate-800 text-xs">{fmt(yt.totalPersonnel)}</td>
                ))}
                <td></td>
              </tr>
              <tr className="bg-slate-50 text-xs text-slate-500">
                <td className="px-3 py-2" colSpan={4}>
                  Staff: {fmtFte(y1Totals.adminFte)} Admin / {fmtFte(y1Totals.certFte)} Cert / {fmtFte(y1Totals.classFte)} Class (Y1)
                </td>
                {yearTotals.map((yt, i) => (
                  <td key={i} className="text-right px-2 py-2">
                    {fmtFte(yt.adminFte)}/{fmtFte(yt.certFte)}/{fmtFte(yt.classFte)}
                  </td>
                ))}
                <td></td>
              </tr>
            </tfoot>
          </table>
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
            <div className="flex items-center gap-3">
              <button
                data-tour="add-position"
                onClick={() => addPosition()}
                className="px-3 py-1.5 text-sm font-medium text-teal-600 border border-teal-300 rounded-lg hover:bg-teal-50 transition-colors"
              >
                + Add Position
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* --- Group Section --- */

function GroupSection({
  label,
  classification,
  color,
  positions,
  benefitsRate,
  onSelectType,
  onUpdateFte,
  onToggleDriver,
  onUpdateSalary,
  onUpdateTitle,
  onRemove,
  onAdd,
  onDragStart,
  onDrop,
  canEdit,
  cascadedCells,
}: {
  label: string
  classification: 'Administrative' | 'Certificated' | 'Classified'
  color: { bg: string; text: string }
  positions: MultiYearPosition[]
  benefitsRate: number
  onSelectType: (id: string, type: string) => void
  onUpdateFte: (id: string, yearIndex: number, value: number) => void
  onToggleDriver: (id: string) => void
  onUpdateSalary: (id: string, value: number) => void
  onUpdateTitle: (id: string, value: string) => void
  onRemove: (id: string) => void
  onAdd: (classification: 'Administrative' | 'Certificated' | 'Classified') => void
  onDragStart: (id: string, classification: string) => void
  onDrop: (targetId: string) => void
  canEdit: boolean
  cascadedCells: Set<string>
}) {
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={10} className="px-3 py-1.5">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${color.bg} ${color.text}`}>
            {label}
          </span>
        </td>
      </tr>
      {positions.map((pos) => (
        <PositionRow
          key={pos.id}
          pos={pos}
          classification={classification}
          benefitsRate={benefitsRate}
          onSelectType={onSelectType}
          onUpdateFte={onUpdateFte}
          onToggleDriver={onToggleDriver}
          onUpdateSalary={onUpdateSalary}
          onUpdateTitle={onUpdateTitle}
          onRemove={onRemove}
          onDragStart={onDragStart}
          onDrop={onDrop}
          canEdit={canEdit}
          cascadedCells={cascadedCells}
        />
      ))}
      {canEdit && (
        <tr className="border-b border-slate-100">
          <td colSpan={10} className="px-3 py-1.5">
            <button
              onClick={() => onAdd(classification)}
              className={`text-xs font-medium ${color.text} opacity-70 hover:opacity-100 transition-opacity`}
            >
              + Add {label} Position
            </button>
          </td>
        </tr>
      )}
    </>
  )
}

/* --- Position Row --- */

/** Get position types relevant to a classification */
function getTypesForClassification(cls: 'Administrative' | 'Certificated' | 'Classified') {
  if (cls === 'Administrative') return ADMIN_TYPES
  if (cls === 'Certificated') return CERT_TYPES
  return CLASS_TYPES
}

function PositionRow({
  pos,
  classification,
  benefitsRate,
  onSelectType,
  onUpdateFte,
  onToggleDriver,
  onUpdateSalary,
  onUpdateTitle,
  onRemove,
  onDragStart,
  onDrop,
  canEdit,
  cascadedCells,
}: {
  pos: MultiYearPosition
  classification: 'Administrative' | 'Certificated' | 'Classified'
  benefitsRate: number
  onSelectType: (id: string, type: string) => void
  onUpdateFte: (id: string, yearIndex: number, value: number) => void
  onToggleDriver: (id: string) => void
  onUpdateSalary: (id: string, value: number) => void
  onUpdateTitle: (id: string, value: string) => void
  onRemove: (id: string) => void
  onDragStart: (id: string, classification: string) => void
  onDrop: (targetId: string) => void
  canEdit: boolean
  cascadedCells: Set<string>
}) {
  const driverLabel = DRIVER_LABELS[pos.driver] || pos.driver.replace(/_/g, ' ')
  const driverCatalogDefault = getDriver(pos.positionType)
  const canToggleDriver = driverCatalogDefault !== 'fixed' && canEdit
  const toggleTargetLabel = pos.driver === 'fixed'
    ? (DRIVER_LABELS[driverCatalogDefault] || driverCatalogDefault.replace(/_/g, ' '))
    : 'Fixed'

  const sectionTypes = getTypesForClassification(classification)
  const isCustom = pos.positionType === 'custom'

  const totalComp = pos.salary > 0 ? Math.round(pos.salary * (1 + benefitsRate)) : 0

  return (
    <tr
      className="border-b border-slate-100 hover:bg-slate-50/50"
      draggable={canEdit}
      onDragStart={canEdit ? () => onDragStart(pos.id, pos.classification) : undefined}
      onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
      onDrop={canEdit ? () => onDrop(pos.id) : undefined}
    >
      {canEdit ? (
        <td className="px-1 py-1.5 w-6 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 select-none">
          <Tooltip content="Drag to reorder">
            <span className="inline-flex mx-auto" aria-label="Drag to reorder">
              <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="2" r="1.5"/><circle cx="9" cy="2" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="3" cy="14" r="1.5"/><circle cx="9" cy="14" r="1.5"/></svg>
            </span>
          </Tooltip>
        </td>
      ) : (
        <td className="px-1 py-1.5 w-6" />
      )}
      <td className="px-3 py-1.5">
        <select
          value={pos.positionType}
          onChange={(e) => onSelectType(pos.id, e.target.value)}
          disabled={!canEdit}
          className="w-full border border-slate-200 rounded px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-600"
        >
          {sectionTypes.map(cp => (
            <option key={cp.type} value={cp.type}>{cp.name}</option>
          ))}
          <option value="custom">Custom Position</option>
        </select>
        {isCustom && (
          <input
            value={pos.title}
            onChange={(e) => onUpdateTitle(pos.id, e.target.value)}
            disabled={!canEdit}
            className="w-full border border-slate-200 rounded px-2 py-1 text-sm mt-1 disabled:bg-slate-50"
            placeholder="Custom position name"
          />
        )}
      </td>
      <td className="px-2 py-1.5">
        {canToggleDriver ? (
          <button
            type="button"
            onClick={() => onToggleDriver(pos.id)}
            title={`Click to switch to ${toggleTargetLabel}`}
            aria-label={`Driver: ${driverLabel}. Click to switch to ${toggleTargetLabel}.`}
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              pos.driver === 'fixed'
                ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                : 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'
            }`}
          >
            {driverLabel}
          </button>
        ) : (
          <span className="text-[10px] text-slate-500">{driverLabel}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          step={1000}
          value={pos.salary}
          onChange={(e) => onUpdateSalary(pos.id, Number(e.target.value))}
          disabled={!canEdit}
          className="w-24 text-right border border-slate-200 rounded px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-600"
        />
        {totalComp > 0 && (
          <div
            className="font-tabular text-[13px] text-right mt-0.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            {fmt(totalComp)} <span className="text-slate-400">× {(1 + benefitsRate).toFixed(2)} benefits</span>
          </div>
        )}
      </td>
      {[0, 1, 2, 3, 4].map((yi) => {
        const isCascaded = cascadedCells.has(cellKey(pos.id, yi))
        const isManualOverride = pos.driver !== 'fixed' && yi !== 0 && pos.manualOverride[yi]
        return (
          <td key={yi} data-year={yi + 1} className="px-2 py-1.5">
            <input
              type="number"
              step={0.5}
              min={0}
              value={pos.fte[yi]}
              onChange={(e) => onUpdateFte(pos.id, yi, Number(e.target.value))}
              disabled={!canEdit}
              title={isManualOverride ? "Manual override — won't recalculate from enrollment." : undefined}
              aria-label={
                isManualOverride
                  ? `Year ${yi + 1} FTE manually overridden; won't recalculate from enrollment`
                  : isCascaded
                    ? `Year ${yi + 1} FTE cascaded forward; type to override`
                    : undefined
              }
              className={`w-14 text-right border border-slate-200 rounded px-1.5 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-600 disabled:cursor-not-allowed ${
                isManualOverride ? 'bg-amber-50' : isCascaded ? 'bg-teal-50' : ''
              }`}
            />
          </td>
        )
      })}
      <td className="px-2 py-1.5">
        {canEdit && (
          <button
            onClick={() => onRemove(pos.id)}
            className="text-red-400 hover:text-red-600 text-xs"
          >
            &times;
          </button>
        )}
      </td>
    </tr>
  )
}
