'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSchoolSession, SELECTED_SCHOOL_KEY } from '@/contexts/SchoolSessionContext'
import type { SchoolProfile, StaffingPosition, BudgetProjection, GradeExpansionEntry } from '@/lib/types'

export { SELECTED_SCHOOL_KEY }

export interface SchoolData {
  schoolId: string
  schoolName: string
  profile: SchoolProfile
  positions: StaffingPosition[]
  allPositions: StaffingPosition[]
  projections: BudgetProjection[]
  gradeExpansionPlan: GradeExpansionEntry[]
  loading: boolean
  reload: () => Promise<void>
}

export function useSchoolData(): SchoolData {
  const [schoolId, setSchoolId] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [profile, setProfile] = useState<SchoolProfile>({
    school_id: '',
    region: '',
    planned_open_year: 0,
    grade_config: '',
    target_enrollment_y1: 0,
    target_enrollment_y2: 0,
    target_enrollment_y3: 0,
    target_enrollment_y4: 0,
    target_enrollment_y5: 0,
    max_class_size: 24,
    pct_frl: 0,
    pct_iep: 0,
    pct_ell: 0,
    pct_hicap: 0,
    onboarding_complete: false,
  })
  const [positions, setPositions] = useState<StaffingPosition[]>([])
  const [allPositions, setAllPositions] = useState<StaffingPosition[]>([])
  const [projections, setProjections] = useState<BudgetProjection[]>([])
  const [gradeExpansionPlan, setGradeExpansionPlan] = useState<GradeExpansionEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  const [supabase] = useState(() => createClient())
  // The current school comes from SchoolSessionProvider (one lookup, one selection rule).
  const session = useSchoolSession()
  const sid = session.school?.id ?? null

  const load = useCallback(async () => {
    if (!sid) return
    const [schoolRes, profileRes, posRes, projRes, gepRes] = await Promise.all([
      supabase.from('schools').select('name').eq('id', sid).single(),
      supabase.from('school_profiles').select('*').eq('school_id', sid).single(),
      supabase.from('staffing_positions').select('*').eq('school_id', sid).order('year'),
      supabase.from('budget_projections').select('*').eq('school_id', sid).eq('year', 1),
      supabase.from('grade_expansion_plan').select('*').eq('school_id', sid).order('year').order('grade_level'),
    ])

    setSchoolId(sid)
    if (schoolRes.data) setSchoolName(schoolRes.data.name)
    if (profileRes.data) setProfile(profileRes.data as SchoolProfile)
    if (posRes.data) {
      const all = posRes.data as StaffingPosition[]
      setAllPositions(all)
      setPositions(all.filter((p) => p.year === 1))
    }
    if (projRes.data) setProjections(projRes.data as BudgetProjection[])
    if (gepRes.data) setGradeExpansionPlan(gepRes.data as GradeExpansionEntry[])

    setLoaded(true)
  }, [supabase, sid])

  useEffect(() => {
    if (!session.loading && sid) load()
  }, [session.loading, sid, load])

  // Loading until the session resolves and, when there is a school, its data has loaded once.
  // No school membership (e.g. an org-only admin) means nothing to load.
  const loading = session.loading || (!!sid && !loaded)

  return { schoolId, schoolName, profile, positions, allPositions, projections, gradeExpansionPlan, loading, reload: load }
}
