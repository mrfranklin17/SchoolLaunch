import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Phase 6c (ROADMAP.md): Editors send chat-proposed plan changes to the Owner, who reviews them
 * in the Inbox. These checks pin the access rules in the routes, the migration and the UI wiring;
 * the flow itself is verified live (see the PR).
 *
 * Run: npx playwright test tests/session4/change-requests.spec.ts
 */

const read = (p: string) => readFileSync(p, 'utf8')
const sqlBody = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

test.describe('change requests', () => {
  test('Owners and Editors can send; only the Owner declines or marks read', () => {
    const route = read('src/app/api/change-requests/route.ts')
    expect(route).toContain("const ownerOnly = action === 'decline' || action === 'mark_read'")
    expect(route).toContain("requireRoles: ownerOnly ? ['school_ceo'] : ['school_ceo', 'school_editor']")
    // Sending is limited to what an Owner could apply.
    expect(route).toContain('canApplyFromChat(changes as PlanChange[])')
  })

  test('applying a request applies the stored changes, then marks the request applied', () => {
    const route = read('src/app/api/plan-changes/apply/route.ts')
    expect(route).toContain("requireRoles: ['school_ceo']")
    expect(route).toContain('loadPendingRequest(auth.supabase, schoolId!, requestId)')
    expect(route).toContain('pending.request.changes')
    expect(route).toContain('markRequestApplied(')
  })

  test('undoing a change that came from a request marks the request undone', () => {
    expect(read('src/app/api/plan-changes/undo/route.ts')).toContain('markRequestUndone(auth.supabase, schoolId!, body.changeId)')
  })

  test('resolving only ever touches a pending request', () => {
    const store = read('src/lib/changeRequestStore.ts')
    expect(store).toContain(".eq('status', 'pending')")
    expect(store).toContain("This request is no longer pending.")
    expect(store).toContain("{ column: 'requested_by', value: userId }")
  })

  test('the migration is additive, with RLS: Owner resolves, requester only withdraws, no delete', () => {
    const sql = sqlBody('supabase/migrations/20261026185528_phase6c_change_requests.sql')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b/i)
    expect(sql).toMatch(/change_requests_insert_editor[\s\S]*requested_by = auth\.uid\(\)[\s\S]*status = 'pending'/)
    expect(sql).toMatch(/change_requests_withdraw_own[\s\S]*USING \(requested_by = auth\.uid\(\) AND status = 'pending'\)[\s\S]*WITH CHECK \(requested_by = auth\.uid\(\) AND status = 'withdrawn'\)/)
    // Viewers cannot read requests.
    expect(sql).toMatch(/change_requests_select_school_editors[\s\S]*ur\.role IN \('school_ceo', 'school_editor'\)/)
  })

  test('the Inbox, its badge and the Owner notice are wired in for Owners and Editors on WA', () => {
    const sidebar = read('src/components/Sidebar.tsx')
    expect(sidebar).toContain("href: '/dashboard/inbox'")
    expect(sidebar).toContain("const showInbox = (role === 'school_ceo' || role === 'school_editor') && pathwayConfig.pathway === 'wa_charter'")
    const layout = read('src/app/(authenticated)/layout.tsx')
    expect(layout).toContain('<ChangeRequestsProvider>')
    expect(layout).toContain('<ChangeRequestNotice />')
    expect(read('src/components/ChangeRequestNotice.tsx')).toContain("role !== 'school_ceo'")
    // Opening the Inbox clears the Owner's unread count.
    expect(read('src/app/(authenticated)/dashboard/inbox/page.tsx')).toContain("action: 'mark_read'")
  })

  test('the card offers Send to Owner to Editors and Decline to the Owner on a request', () => {
    const card = read('src/components/chat/ChangePreviewCard.tsx')
    expect(card).toContain("action: 'create'")
    expect(card).toContain("action: 'decline'")
    expect(card).toContain("action: 'withdraw'")
    expect(card).toContain('requestId: request.id')
  })
})
