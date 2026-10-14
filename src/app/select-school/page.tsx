'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SELECTED_SCHOOL_KEY } from '@/lib/useSchoolData'
import { Suspense } from 'react'
import SchoolLogo from '@/components/SchoolLogo'

interface SchoolOption {
  school_id: string
  role: string
  school_name: string
  grade_config: string
  planned_open_year: number
  onboarding_complete: boolean
  created_at: string
  logo_url: string | null
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  school_ceo: { label: 'Owner', className: 'bg-teal-100 text-teal-700' },
  school_editor: { label: 'Editor', className: 'bg-blue-100 text-blue-700' },
  school_viewer: { label: 'Viewer', className: 'bg-slate-100 text-slate-600' },
}

function SchoolPickerContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [loading, setLoading] = useState(true)
  // Reference time for the "New" badge, fixed per visit (render stays pure).
  const [now] = useState(() => Date.now())

  // Auto-select if coming from invitation acceptance
  const joinedSchoolId = searchParams.get('joined')

  function selectSchool(schoolId: string) {
    sessionStorage.setItem(SELECTED_SCHOOL_KEY, schoolId)
    router.push('/dashboard')
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: roles } = await supabase
        .from('user_roles')
        .select('school_id, role, created_at')
        .eq('user_id', user.id)
        .in('role', ['school_ceo', 'school_editor', 'school_viewer'])
        .order('created_at', { ascending: false })

      if (!roles || roles.length === 0) {
        router.push('/login')
        return
      }

      if (roles.length === 1) {
        sessionStorage.setItem(SELECTED_SCHOOL_KEY, roles[0].school_id)
        router.push('/dashboard')
        return
      }

      // Auto-select if just accepted an invitation
      if (joinedSchoolId && roles.find((r) => r.school_id === joinedSchoolId)) {
        selectSchool(joinedSchoolId)
        return
      }

      // Fetch school details for each role
      const schoolIds = roles.map((r) => r.school_id).filter(Boolean)
      const { data: schoolData } = await supabase
        .from('schools')
        .select('id, name')
        .in('id', schoolIds)

      const { data: profiles } = await supabase
        .from('school_profiles')
        .select('school_id, grade_config, planned_open_year, onboarding_complete, logo_url')
        .in('school_id', schoolIds)

      const options: SchoolOption[] = roles
        .filter((r) => r.school_id)
        .map((r) => {
          const school = schoolData?.find((s) => s.id === r.school_id)
          const profile = profiles?.find((p) => p.school_id === r.school_id)
          return {
            school_id: r.school_id,
            role: r.role,
            school_name: school?.name || 'Unnamed School',
            grade_config: profile?.grade_config || '',
            planned_open_year: profile?.planned_open_year || 0,
            onboarding_complete: profile?.onboarding_complete ?? false,
            created_at: r.created_at,
            logo_url: profile?.logo_url || null,
          }
        })

      setSchools(options)
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading your schools...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-extrabold text-white"
              style={{ background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)' }}
            >
              S
            </div>
            <span className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'var(--font-heading-var)' }}>
              School<span className="text-emerald-600">Launch</span>
            </span>
          </div>
          <p className="text-slate-500">Select a school to open</p>
        </div>

        <div className="space-y-3">
          {schools.map((s) => {
            const badge = ROLE_BADGES[s.role] || ROLE_BADGES.school_viewer
            const isNew = now - new Date(s.created_at).getTime() < 24 * 60 * 60 * 1000

            return (
              <button
                key={s.school_id}
                onClick={() => selectSchool(s.school_id)}
                className="w-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:border-teal-300 hover:shadow-md transition-all text-left group"
              >
                <div className="flex items-start gap-4">
                  <SchoolLogo name={s.school_name} logoUrl={s.logo_url} size={48} />
                  <div className="flex-1 flex items-start justify-between min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-800 group-hover:text-teal-700 transition-colors truncate">
                        {s.school_name}
                      </h3>
                      {isNew && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium flex-shrink-0">
                          New
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      {s.grade_config && <span>{s.grade_config}</span>}
                      {s.grade_config && s.planned_open_year > 0 && <span>&middot;</span>}
                      {s.planned_open_year > 0 && <span>Opening {s.planned_open_year}</span>}
                      {!s.onboarding_complete && (
                        <>
                          <span>&middot;</span>
                          <span className="text-amber-600">Setup incomplete</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function SelectSchoolPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    }>
      <SchoolPickerContent />
    </Suspense>
  )
}
