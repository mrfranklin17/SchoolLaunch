import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/signup', '/invite', '/auth/confirm']

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Public routes — skip auth entirely, no session check needed
  if (PUBLIC_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // --- Onboarding enforcement ---
  // Only check for routes that need it (dashboard and onboarding)
  const isOnboardingRoute = pathname === '/onboarding' || pathname.startsWith('/onboarding/')
  const isDashboardRoute = pathname === '/dashboard' || pathname.startsWith('/dashboard/')

  if (isOnboardingRoute || isDashboardRoute) {
    // Newest first, so the CEO school gated here is the one the onboarding page opens
    // (it picks the newest CEO row too); an unordered pick could disagree and bounce.
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role, school_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    // Admins are exempt from onboarding enforcement
    const hasAdminRole = roles?.some(r => r.role === 'org_admin' || r.role === 'super_admin')

    if (!hasAdminRole && roles?.length) {
      const ceoRole = roles.find(r => r.role === 'school_ceo' && r.school_id)

      if (ceoRole?.school_id) {
        const { data: profile } = await supabase
          .from('school_profiles')
          .select('onboarding_complete')
          .eq('school_id', ceoRole.school_id)
          .single()

        const onboardingComplete = profile?.onboarding_complete === true

        if (!onboardingComplete && !isOnboardingRoute) {
          // Not complete → lock into onboarding
          const url = request.nextUrl.clone()
          url.pathname = '/onboarding'
          return NextResponse.redirect(url)
        }

        if (onboardingComplete && isOnboardingRoute) {
          // Already complete → onboarding is a one-time flow
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }
    }
  }

  return supabaseResponse
}
