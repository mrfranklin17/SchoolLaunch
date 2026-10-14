#!/usr/bin/env node
/**
 * T-INFRA-02: purge a school (and optionally its test user) left behind when the E2E
 * hard-delete phase fails. Same order as Phase 14b of full-founder-journey.spec.ts.
 *
 *   node scripts/purge-orphan.cjs <school_id> [user_id]            # dry run: counts rows
 *   node scripts/purge-orphan.cjs <school_id> [user_id] --confirm  # deletes
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from the environment or
 * .env.local). The auth user is deleted only when it holds no role at any other school.
 * This deletes production data: only run it on a school_id printed by a CLEANUP INCOMPLETE banner.
 */
const { readFileSync, existsSync } = require('node:fs')
const { createClient } = require('@supabase/supabase-js')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABLES = [
  'scenarios', 'grade_expansion_plan', 'staffing_positions', 'budget_projections',
  'alignment_reviews', 'alignment_security_events', 'org_notes', 'invitations', 'user_roles',
  'school_profiles',
]

function env(name) {
  if (process.env[name]) return process.env[name]
  if (existsSync('.env.local')) {
    const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

async function main() {
  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')
  const [schoolId, userId] = args.filter((a) => !a.startsWith('--'))
  if (!schoolId || !UUID.test(schoolId) || (userId && !UUID.test(userId))) {
    console.error('Usage: node scripts/purge-orphan.cjs <school_id> [user_id] [--confirm]')
    process.exit(2)
  }
  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(2)
  }
  const db = createClient(url, key, { auth: { persistSession: false } })

  const { data: school } = await db.from('schools').select('id, name').eq('id', schoolId).maybeSingle()
  console.log(school ? `School: ${school.name} (${schoolId})` : `School ${schoolId}: no schools row`)

  let failed = false
  for (const table of [...TABLES, 'schools']) {
    const col = table === 'schools' ? 'id' : 'school_id'
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(col, schoolId)
    if (error) { console.log(`  ${table}: ${error.message}`); failed = true; continue }
    if (!confirm) { console.log(`  ${table}: ${count} row(s)`); continue }
    if (!count) continue
    const { error: delError } = await db.from(table).delete().eq(col, schoolId)
    console.log(`  ${table}: ${delError ? `FAILED ${delError.message}` : `deleted ${count}`}`)
    if (delError) failed = true
  }

  if (userId) {
    const { data: otherRoles } = await db.from('user_roles').select('school_id').eq('user_id', userId).neq('school_id', schoolId)
    if (otherRoles && otherRoles.length > 0) {
      console.log(`  auth user ${userId}: kept (has roles at ${otherRoles.length} other school(s))`)
    } else if (!confirm) {
      console.log(`  auth user ${userId}: would be deleted`)
    } else {
      const { error } = await db.auth.admin.deleteUser(userId)
      console.log(`  auth user ${userId}: ${error ? `FAILED ${error.message}` : 'deleted'}`)
      if (error) failed = true
    }
  }

  if (!confirm) console.log('\nDry run. Re-run with --confirm to delete.')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
