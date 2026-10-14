'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface TeamMember {
  id: string
  user_id: string
  role: string
  display_name: string | null
  email: string | null
  created_at: string
}

interface PendingInvitation {
  id: string
  email: string
  role: string
  created_at: string
  expires_at: string
}

const ROLE_BADGES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  school_ceo: { label: 'Owner', bg: 'var(--navy-dark)', fg: '#fff', border: 'var(--navy-dark)' },
  school_editor: { label: 'Editor', bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
  school_viewer: { label: 'Viewer', bg: '#F1F5F9', fg: '#525F73', border: '#E2E8F0' },
}

function RolePill({ role }: { role: string }) {
  const badge = ROLE_BADGES[role] || ROLE_BADGES.school_viewer
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap"
      style={{ background: badge.bg, color: badge.fg, borderColor: badge.border }}
    >
      {badge.label}
    </span>
  )
}

function PendingPill() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap"
      style={{ background: '#F1F5F9', color: '#525F73', borderColor: '#E2E8F0' }}
    >
      Invited
    </span>
  )
}

function getInitials(displayName: string, email: string | null): string {
  const source = displayName.trim() || (email || '').split('@')[0]
  if (!source) return '?'
  const parts = source.split(/[\s.]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function ActionMenu({ children }: { children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="12" r="1.25" />
          <circle cx="12" cy="12" r="1.25" />
          <circle cx="19" cy="12" r="1.25" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-44 rounded-lg border border-slate-200 bg-white py-1"
          style={{ boxShadow: 'var(--shadow-2)' }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

interface InviteSuccess {
  url: string
  email: string
  role: 'school_editor' | 'school_viewer'
}

export default function TeamSection({ schoolId, currentUserId, schoolName }: { schoolId: string; currentUserId: string; schoolName: string }) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInvitation[]>([])
  const [loadingTeam, setLoadingTeam] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'school_editor' | 'school_viewer'>('school_editor')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<InviteSuccess | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const fetchTeam = useCallback(async () => {
    try {
      const res = await fetch(`/api/team?schoolId=${schoolId}`)
      if (res.ok) {
        const data = await res.json()
        setMembers(data.members || [])
        setPendingInvites(data.pendingInvitations || [])
      }
    } catch (err) {
      console.error('Failed to fetch team:', err)
    }
    setLoadingTeam(false)
  }, [schoolId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount: state is set after the request resolves
    fetchTeam()
  }, [fetchTeam])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      const submittedEmail = inviteEmail.trim()
      const submittedRole = inviteRole
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: submittedEmail, role: submittedRole, schoolId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInviteError(data.error || 'Failed to send invitation')
      } else {
        const fullUrl = `${window.location.origin}${data.inviteUrl}`
        setInviteSuccess({ url: fullUrl, email: submittedEmail, role: submittedRole })
        setInviteEmail('')
        await fetchTeam()
      }
    } catch {
      setInviteError('Network error. Please try again.')
    }
    setInviting(false)
  }

  function buildMailtoHref(success: InviteSuccess): string {
    const token = new URL(success.url, window.location.origin).searchParams.get('token') || ''
    const inviteUrl = `https://schoollaunch.vercel.app/invite?token=${token}`
    const roleLabel = success.role === 'school_editor' ? 'Editor' : 'Viewer'
    const roleDescription = success.role === 'school_editor'
      ? 'you can edit the financial model, staffing plan, and revenue assumptions'
      : 'you can view the financial model and run exports but cannot make changes'
    const subject = `You're invited to collaborate on ${schoolName} in SchoolLaunch`
    const body = `Hi,\n\nI'd like to invite you to help build our financial plan for ${schoolName} in SchoolLaunch.\n\nClick this link to accept the invitation and create your account:\n\n${inviteUrl}\n\nYou'll have ${roleLabel} access — ${roleDescription}.\n\nThis invitation expires in 7 days.\n\nThanks!`
    return `mailto:${success.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  async function handleChangeRole(userId: string, newRole: string) {
    const res = await fetch(`/api/team/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole, schoolId }),
    })
    if (res.ok) await fetchTeam()
  }

  async function handleRemoveMember(userId: string) {
    const res = await fetch(`/api/team/${userId}?schoolId=${schoolId}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmRemove(null)
      await fetchTeam()
    }
  }

  async function handleRevokeInvite(invitationId: string) {
    // Use service-bypassing delete — invitation policies allow org members
    const res = await fetch(`/api/team/invite?invitationId=${invitationId}&schoolId=${schoolId}`, { method: 'DELETE' })
    if (res.ok) await fetchTeam()
  }

  if (loadingTeam) {
    return (
      <div data-tour="team-section" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Team Members</h2>
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          <span className="ml-2 text-sm text-slate-400">Loading team...</span>
        </div>
      </div>
    )
  }

  return (
    <div data-tour="team-section" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
      <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Team Members</h2>
      <p className="text-sm text-slate-500 mb-5">Invite collaborators to work on your school&apos;s financial plan.</p>

      {/* Current team list */}
      <div className="space-y-2 mb-5">
        {members.map((m) => {
          const isMe = m.user_id === currentUserId
          const isCeo = m.role === 'school_ceo'
          const displayName = m.display_name || m.email || 'Unknown user'

          return (
            <div key={m.id} className="flex items-center gap-3 py-2.5 px-3 rounded-lg border border-slate-100 hover:bg-slate-50/40 transition-colors">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{ background: 'var(--navy-dark)', color: '#fff', fontFamily: 'var(--font-heading-var)' }}
                aria-hidden="true"
              >
                {getInitials(displayName, m.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {displayName}{isMe && <span className="text-slate-400 font-normal"> (you)</span>}
                </div>
                {m.email && (
                  <div className="text-xs text-slate-500 truncate">{m.email}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <RolePill role={m.role} />
                {!isCeo && !isMe && confirmRemove !== m.user_id && (
                  <ActionMenu>
                    {(close) => (
                      <>
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-medium">Change role</div>
                        <button
                          role="menuitem"
                          onClick={() => { handleChangeRole(m.user_id, 'school_editor'); close() }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${m.role === 'school_editor' ? 'text-teal-700 font-medium' : 'text-slate-700'}`}
                        >
                          Editor {m.role === 'school_editor' && <span className="ml-1 text-teal-500">✓</span>}
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => { handleChangeRole(m.user_id, 'school_viewer'); close() }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${m.role === 'school_viewer' ? 'text-teal-700 font-medium' : 'text-slate-700'}`}
                        >
                          Viewer {m.role === 'school_viewer' && <span className="ml-1 text-teal-500">✓</span>}
                        </button>
                        <div className="my-1 border-t border-slate-100" />
                        <button
                          role="menuitem"
                          onClick={() => { setConfirmRemove(m.user_id); close() }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-rose-50"
                          style={{ color: 'var(--rose-700)' }}
                        >
                          Remove from team
                        </button>
                      </>
                    )}
                  </ActionMenu>
                )}
                {confirmRemove === m.user_id && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleRemoveMember(m.user_id)}
                      className="text-xs px-2 py-1 text-white rounded-lg"
                      style={{ background: 'var(--rose-600)' }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="text-xs px-2 py-1 text-slate-500 hover:text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pending invitations */}
      {pendingInvites.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Pending Invitations</h3>
          <div className="space-y-2">
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-2.5 px-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--bg-table-alt)' }}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-700 truncate">{inv.email}</div>
                  <div className="text-xs text-slate-400">
                    Invited {new Date(inv.created_at).toLocaleDateString()} · {(ROLE_BADGES[inv.role] || ROLE_BADGES.school_viewer).label}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <PendingPill />
                  <ActionMenu>
                    {(close) => (
                      <button
                        role="menuitem"
                        onClick={() => { handleRevokeInvite(inv.id); close() }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-rose-50"
                        style={{ color: 'var(--rose-700)' }}
                      >
                        Revoke invitation
                      </button>
                    )}
                  </ActionMenu>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite form */}
      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Invite a Team Member</h3>
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            placeholder="colleague@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          <select
            value={inviteRole}
            aria-label="Role for the invited teammate"
            onChange={(e) => setInviteRole(e.target.value as 'school_editor' | 'school_viewer')}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="school_editor">Editor</option>
            <option value="school_viewer">Viewer</option>
          </select>
          <button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {inviting ? 'Sending...' : 'Send Invite'}
          </button>
        </form>

        {inviteError && (
          <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inviteError}</div>
        )}

        {inviteSuccess && (
          <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-3">
            <p className="text-xs text-emerald-700 font-medium mb-2">Invitation created for {inviteSuccess.email}.</p>
            <a
              href={inviteSuccess.email ? buildMailtoHref(inviteSuccess) : undefined}
              aria-disabled={!inviteSuccess.email}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors ${inviteSuccess.email ? '' : 'opacity-50 pointer-events-none'}`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              Send Email Invite
            </a>
            <div className="mt-3">
              <p className="text-[11px] text-slate-500 mb-1">Or copy the link to share another way</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteSuccess.url}
                  className="flex-1 text-xs bg-white border border-emerald-200 rounded px-2 py-1.5 text-slate-700 font-mono"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(inviteSuccess.url); }}
                  className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-400 leading-relaxed">
          Editors can modify your staffing plan, revenue model, and operations budget.
          Viewers can see everything and run exports but cannot make changes.
          Only you (the school owner) can invite or remove team members.
        </p>
      </div>
    </div>
  )
}
