import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const body = await request.json()
  const { email, password, fullName } = body

  if (!email || !password || !fullName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  // Create auth user via Supabase Auth admin API (service role)
  const admin = createServiceRoleClient()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError) {
    // Handle duplicate email
    if (authError.message?.includes('already been registered') || authError.message?.includes('already exists')) {
      return NextResponse.json({ error: 'An account with this email already exists. Please sign in instead.' }, { status: 409 })
    }
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const userId = authData.user.id

  // Create school (no organization — self-serve)
  const { data: school, error: schoolError } = await admin
    .from('schools')
    .insert({
      name: 'My School',
      organization_id: null,
      status: 'planning',
    })
    .select('id')
    .single()

  if (schoolError || !school) {
    // Cleanup: delete the auth user
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to create school', detail: schoolError }, { status: 500 })
  }

  // Create school_profiles record
  const { error: profileError } = await admin
    .from('school_profiles')
    .insert({
      school_id: school.id,
      onboarding_complete: false,
      max_class_size: 24,
    })

  if (profileError) {
    await admin.from('schools').delete().eq('id', school.id)
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to create school profile', detail: profileError }, { status: 500 })
  }

  // Create user_roles record
  const { error: roleError } = await admin
    .from('user_roles')
    .insert({
      user_id: userId,
      role: 'school_ceo',
      school_id: school.id,
      organization_id: null,
      display_name: fullName,
    })

  if (roleError) {
    await admin.from('school_profiles').delete().eq('school_id', school.id)
    await admin.from('schools').delete().eq('id', school.id)
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to assign role', detail: roleError }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    userId,
    schoolId: school.id,
  })
}
