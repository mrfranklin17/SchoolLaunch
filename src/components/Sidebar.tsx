'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/hooks/usePermissions'
import SchoolLogo from '@/components/SchoolLogo'
import { useSchoolSession, SELECTED_SCHOOL_KEY } from '@/contexts/SchoolSessionContext'

interface SidebarSchool {
  school_id: string
  school_name: string
  role: string
  logo_url: string | null
}

interface PortfolioSchool {
  school_id: string
  school_name: string
  logo_url: string | null
}

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  school_ceo: { label: 'Owner', className: 'bg-teal-500/20 text-teal-300' },
  school_editor: { label: 'Editor', className: 'bg-blue-500/20 text-blue-300' },
  school_viewer: { label: 'Viewer', className: 'bg-slate-500/20 text-slate-400' },
}

const navGroups = [
  {
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
    ],
  },
  {
    items: [
      { href: '/dashboard/revenue', label: 'Revenue', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      { href: '/dashboard/staffing', label: 'Staffing', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { href: '/dashboard/operations', label: 'Operations', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    ],
  },
  {
    items: [
      { href: '/dashboard/cashflow', label: 'Cash Flow', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/dashboard/multiyear', label: 'Multi-Year', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { href: '/dashboard/scenarios', label: 'Scenarios', icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
    ],
  },
  {
    items: [
      { href: '/dashboard/ask', label: 'Ask SchoolLaunch', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
      { href: '/dashboard/advisory', label: 'Advisory Panel', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
      { href: '/dashboard/alignment', label: 'Alignment Review', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
      { href: '/dashboard/scorecard', label: 'Commission Scorecard', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    ],
  },
  {
    items: [
      { href: '/dashboard/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
]

function NavIcon({ d, active }: { d: string; active: boolean }) {
  return (
    <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2 : 1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [mobileOpen, setMobileOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [schools, setSchools] = useState<SidebarSchool[]>([])
  const [portfolioSchools, setPortfolioSchools] = useState<PortfolioSchool[]>([])
  const { role } = usePermissions()
  const { config: pathwayConfig, roles, memberships, school: currentSchool, loading: sessionLoading } = useSchoolSession()
  const isAdmin = role === 'org_admin' || role === 'super_admin'
  const roleBadge = role && !isAdmin ? ROLE_BADGE[role] : null

  useEffect(() => {
    // Roles and memberships come from the session; this only adds logos and the org's schools.
    if (sessionLoading) return
    async function loadSchools() {
      if (roles.length === 0) return

      // Admin path: load all schools in the org for the portfolio nav.
      const adminRole = roles.find((r) => r.role === 'org_admin' || r.role === 'super_admin')
      if (adminRole && adminRole.organization_id) {
        const { data: orgSchools } = await supabase
          .from('schools')
          .select('id, name')
          .eq('organization_id', adminRole.organization_id)
          .order('name')
        const schoolIds = (orgSchools || []).map((s) => s.id)
        const { data: profiles } = schoolIds.length > 0
          ? await supabase.from('school_profiles').select('school_id, logo_url').in('school_id', schoolIds)
          : { data: [] }
        setPortfolioSchools((orgSchools || []).map((s) => ({
          school_id: s.id,
          school_name: s.name,
          logo_url: profiles?.find((p) => p.school_id === s.id)?.logo_url || null,
        })))
      }

      // School-roles path: school switcher (only when ≥2 school memberships).
      if (memberships.length <= 1) return
      const { data: profiles } = await supabase
        .from('school_profiles')
        .select('school_id, logo_url')
        .in('school_id', memberships.map((m) => m.id))
      setSchools(memberships.map((m) => ({
        school_id: m.id,
        school_name: m.name || 'Unnamed School',
        role: m.role,
        logo_url: profiles?.find((p) => p.school_id === m.id)?.logo_url || null,
      })))
    }
    loadSchools()
  }, [supabase, sessionLoading, roles, memberships])

  function switchSchool(schoolId: string) {
    sessionStorage.setItem(SELECTED_SCHOOL_KEY, schoolId)
    setSwitcherOpen(false)
    window.location.href = '/dashboard'
  }

  async function handleLogout() {
    sessionStorage.removeItem(SELECTED_SCHOOL_KEY)
    await supabase.auth.signOut()
    router.push('/login')
  }

  // The school the dashboard is actually showing (also when nothing was picked in the switcher).
  const currentSchoolId = currentSchool?.id ?? null
  const hasMultipleSchools = schools.length > 1

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="text-white text-lg font-semibold tracking-tight" style={{ fontFamily: 'var(--font-heading-var)' }}>
            School<span className="text-emerald-400">Launch</span>
          </div>
          {roleBadge && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${roleBadge.className}`}>
              {roleBadge.label}
            </span>
          )}
        </div>
      </div>

      {/* School switcher (multi-school users only) */}
      {hasMultipleSchools && (
        <div className="px-3 py-2 border-b border-white/10 relative">
          <button
            onClick={() => setSwitcherOpen(!switcherOpen)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.06] transition-colors"
          >
            <span className="text-xs text-slate-400 truncate">
              {schools.find((s) => s.school_id === currentSchoolId)?.school_name || schools[0]?.school_name || 'Select school'}
            </span>
            <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform flex-shrink-0 ${switcherOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {switcherOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-[#1a1f2e] border border-white/10 rounded-lg shadow-xl z-50 py-1">
              {schools.map((s) => {
                const isCurrent = s.school_id === currentSchoolId
                const badge = ROLE_BADGE[s.role]
                return (
                  <button
                    key={s.school_id}
                    onClick={() => !isCurrent && switchSchool(s.school_id)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                      isCurrent ? 'text-teal-400 bg-white/[0.04]' : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <SchoolLogo name={s.school_name} logoUrl={s.logo_url} size={24} />
                      <span className="truncate">{s.school_name}</span>
                    </span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      {badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${badge.className}`}>{badge.label}</span>}
                      {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav data-tour="sidebar-nav" className="flex-1 px-3 py-3 overflow-y-auto sl-scroll">
        {isAdmin ? (
          <AdminNav
            pathname={pathname}
            portfolioSchools={portfolioSchools}
            onNavigate={() => setMobileOpen(false)}
          />
        ) : (
          navGroups.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="mx-3 my-2 border-t border-white/[0.06]" />}
              <div className="space-y-0.5">
                {group.items.map(({ href, label: rawLabel, icon }) => {
                  const label = (href === '/dashboard/scorecard' && pathwayConfig.pathway !== 'wa_charter')
                    ? 'Financial Health'
                    : rawLabel
                  const active = pathname === href
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 relative ${
                        active
                          ? 'text-white font-medium'
                          : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                      }`}
                      style={active ? { background: 'rgba(16, 185, 129, 0.1)' } : undefined}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-emerald-500" />
                      )}
                      <NavIcon d={icon} active={active} />
                      <span style={{ fontFamily: 'var(--font-heading-var)' }}>{label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={handleLogout}
          className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] rounded-lg transition-colors"
          style={{ fontFamily: 'var(--font-heading-var)' }}
        >
          Sign Out
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-white shadow-md border border-slate-200"
      >
        <svg className="w-5 h-5 text-slate-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside
            className="absolute left-0 top-0 h-full w-64 flex flex-col z-50"
            style={{ background: 'linear-gradient(180deg, var(--navy) 0%, var(--navy-dark) 100%)' }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className="fixed left-0 top-0 h-full w-60 flex-col z-40 hidden md:flex"
        style={{ background: 'linear-gradient(180deg, var(--navy) 0%, var(--navy-dark) 100%)' }}
      >
        {sidebarContent}
      </aside>
    </>
  )
}

function AdminNav({
  pathname,
  portfolioSchools,
  onNavigate,
}: {
  pathname: string
  portfolioSchools: PortfolioSchool[]
  onNavigate: () => void
}) {
  const portfolioActive = pathname === '/portfolio'
  const portfolioIcon = 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2m4-3V5a2 2 0 012-2h2a2 2 0 012 2v3'
  return (
    <div className="space-y-0.5">
      <Link
        href="/portfolio"
        onClick={onNavigate}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 relative ${
          portfolioActive ? 'text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
        }`}
        style={portfolioActive ? { background: 'rgba(16, 185, 129, 0.1)' } : undefined}
      >
        {portfolioActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-emerald-500" />
        )}
        <NavIcon d={portfolioIcon} active={portfolioActive} />
        <span style={{ fontFamily: 'var(--font-heading-var)' }}>Portfolio</span>
      </Link>

      {portfolioSchools.length > 0 && (
        <>
          <div className="mx-3 my-2 border-t border-white/[0.06]" />
          <div className="px-3 mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Schools
          </div>
          <div className="space-y-0.5">
            {portfolioSchools.map((s) => {
              const href = `/portfolio/${s.school_id}`
              const active = pathname === href
              return (
                <Link
                  key={s.school_id}
                  href={href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    active ? 'text-white bg-white/[0.06]' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <SchoolLogo name={s.school_name} logoUrl={s.logo_url} size={24} />
                  <span className="truncate" style={{ fontFamily: 'var(--font-heading-var)' }}>{s.school_name}</span>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
