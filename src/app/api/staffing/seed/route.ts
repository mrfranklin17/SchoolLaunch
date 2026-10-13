import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { authenticateRequest } from '@/lib/apiAuth'
import { expansionToEnrollmentArray, getRetentionRate } from '@/lib/gradeExpansion'
import type { GradeExpansionEntry } from '@/lib/types'
// R-REV-05: seed roster + salaries now come from the single source of truth.
import { SEED_POSITIONS } from '@/lib/staffingDefaults'

const SALARY_ESCALATOR = 0.025 // 2.5%

function computeFtePerYear(
  fixedFte: number | null,
  driver: string,
  positionType: string,
  enrollments: number[],
  sectionsPerYear: number[],
): number[] {
  // Fixed positions: same FTE every year
  if (driver === 'fixed' || fixedFte !== null) {
    const v = fixedFte ?? 1
    return [v, v, v, v, v]
  }

  // Teacher: FTE = sections per year
  if (positionType === 'teacher_elem' || positionType === 'teacher_ms' || positionType === 'teacher_hs') {
    const y1 = sectionsPerYear[0] || Math.ceil(enrollments[0] / 24) || 4
    return [0, 1, 2, 3, 4].map((i) => {
      if (i === 0) return y1
      const sections = sectionsPerYear[i] || sectionsPerYear[i - 1] || y1
      return sections
    })
  }

  // Paraeducator: scale with enrollment, minimum 2
  if (positionType === 'paraeducator') {
    const y1 = Math.max(2, Math.round(enrollments[0] / 48 * 2) / 2)
    return [0, 1, 2, 3, 4].map((i) => {
      if (i === 0) return y1
      if (enrollments[0] <= 0) return y1
      const ratio = enrollments[i] / enrollments[0]
      const scaled = Math.round(y1 * ratio * 2) / 2
      return Math.max(y1, scaled)
    })
  }

  // Default per-pupil scaling
  const y1 = 1
  return [0, 1, 2, 3, 4].map((i) => {
    if (i === 0) return y1
    if (enrollments[0] <= 0) return y1
    const ratio = enrollments[i] / enrollments[0]
    const scaled = Math.round(y1 * ratio * 2) / 2
    return Math.max(y1, scaled)
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { schoolId } = body

  if (!schoolId) {
    return NextResponse.json({ error: 'Missing schoolId' }, { status: 400 })
  }

  // The service-role client below bypasses RLS, so only signed-in members of this school
  // may trigger the seed (the Staffing tab calls it on load for every role).
  const auth = await authenticateRequest(request, { schoolId })
  if (auth instanceof NextResponse) return auth

  const admin = createServiceRoleClient()

  // Atomic check: count existing rows for this school
  const { count, error: countError } = await admin
    .from('staffing_positions')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)

  if (countError) {
    return NextResponse.json({ error: 'Failed to check existing positions', detail: countError }, { status: 500 })
  }

  // Already has positions — do NOT seed
  if ((count ?? 0) > 0) {
    return NextResponse.json({ seeded: false, existingCount: count })
  }

  // Load school profile for enrollment data
  const { data: profile } = await admin
    .from('school_profiles')
    .select('target_enrollment_y1, target_enrollment_y2, target_enrollment_y3, target_enrollment_y4, target_enrollment_y5, retention_rate, grade_config')
    .eq('school_id', schoolId)
    .single()

  // Load grade expansion plan
  const { data: expansionPlan } = await admin
    .from('grade_expansion_plan')
    .select('year, grade_level, sections, students_per_section, is_new_grade')
    .eq('school_id', schoolId)
    .order('year', { ascending: true })

  // Compute enrollments
  const y1 = profile?.target_enrollment_y1 || 96
  let enrollments: number[]
  if (expansionPlan && expansionPlan.length > 0) {
    const retentionRate = getRetentionRate(profile ?? {})
    enrollments = expansionToEnrollmentArray(expansionPlan as GradeExpansionEntry[], retentionRate)
  } else {
    enrollments = [
      y1,
      profile?.target_enrollment_y2 || y1,
      profile?.target_enrollment_y3 || y1,
      profile?.target_enrollment_y4 || y1,
      profile?.target_enrollment_y5 || y1,
    ]
  }

  // Compute sections per year
  const sectionsPerYear = [0, 0, 0, 0, 0]
  if (expansionPlan && expansionPlan.length > 0) {
    for (const entry of expansionPlan) {
      if (entry.year >= 1 && entry.year <= 5) {
        sectionsPerYear[entry.year - 1] += entry.sections
      }
    }
    for (let i = 1; i < 5; i++) {
      if (sectionsPerYear[i] === 0 && sectionsPerYear[i - 1] > 0) {
        sectionsPerYear[i] = sectionsPerYear[i - 1]
      }
    }
  }

  // Build the 30 rows (6 positions × 5 years)
  const rows: Array<{
    school_id: string; year: number; title: string; category: string;
    fte: number; annual_salary: number; position_type: string;
    driver: string; classification: string; benchmark_salary: number;
    students_per_position: number; sort_order: number;
  }> = []

  for (let pi = 0; pi < SEED_POSITIONS.length; pi++) {
    const pos = SEED_POSITIONS[pi]
    const ftePerYear = computeFtePerYear(pos.fixedFte, pos.driver, pos.positionType, enrollments, sectionsPerYear)

    for (let y = 1; y <= 5; y++) {
      rows.push({
        school_id: schoolId,
        year: y,
        title: pos.title,
        category: pos.category,
        fte: ftePerYear[y - 1],
        annual_salary: Math.round(pos.salary * Math.pow(1 + SALARY_ESCALATOR, y - 1)),
        position_type: pos.positionType,
        driver: pos.driver,
        classification: pos.classification,
        benchmark_salary: pos.benchmarkSalary,
        students_per_position: pos.studentsPerPosition,
        sort_order: pi,
      })
    }
  }

  const { error: insertError } = await admin.from('staffing_positions').insert(rows)

  if (insertError) {
    return NextResponse.json({ error: 'Failed to seed positions', detail: insertError }, { status: 500 })
  }

  return NextResponse.json({ seeded: true, rowCount: rows.length })
}
