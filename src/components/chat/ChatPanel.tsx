'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useScenario } from '@/lib/ScenarioContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useChat } from '@/contexts/ChatContext'
import { chatTabForPath } from '@/lib/chatTabs'
import { ChatComposer, ChatStatus, ChatThread } from '@/components/chat/ChatThread'

/**
 * Ask SchoolLaunch beside every dashboard tab (Phase 6e): a button in the bottom-right corner
 * opens a side panel (full screen on a phone) holding the same conversation as the Ask tab.
 * Questions carry the tab they were asked from. Not shown on the Ask tab itself.
 */
export default function ChatPanel() {
  const pathname = usePathname()
  const tab = chatTabForPath(pathname)
  const { schoolData, pathwayConfig } = useScenario()
  const { canUseAI } = usePermissions()
  const { messages, streaming, cooldown, send } = useChat()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const titleId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wasOpen = useRef(false)

  // Focus the question box on open; return focus to the button on close.
  useEffect(() => {
    if (open) inputRef.current?.focus()
    else if (wasOpen.current) toggleRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!tab || !canUseAI || schoolData.loading) return null
  const suggestions = pathwayConfig.pathway === 'wa_charter' ? tab.suggestions : []

  return (
    <>
      {!open && (
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls={panelId}
          className="fixed bottom-5 right-5 md:bottom-6 md:right-6 z-40 inline-flex items-center justify-center gap-2 h-12 w-12 sm:w-auto sm:pl-4 sm:pr-5 rounded-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-lg transition-colors"
        >
          <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          <span className="sr-only sm:not-sr-only">Ask SchoolLaunch</span>
          {streaming && <span className="w-2 h-2 rounded-full bg-white animate-pulse" aria-label="answering" />}
        </button>
      )}

      {open && (
        <aside
          id={panelId}
          aria-labelledby={titleId}
          className="fixed inset-0 sm:inset-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-[420px] z-[60] flex flex-col bg-slate-50 sm:border-l border-slate-200 shadow-2xl animate-fade-in"
        >
          <header className="flex items-start gap-3 px-4 py-3 bg-white border-b border-slate-200">
            <div className="flex-1 min-w-0">
              <h2 id={titleId} className="text-sm font-semibold text-slate-800">Ask SchoolLaunch</h2>
              <p className="text-xs text-slate-500">Asking from {tab.label}</p>
            </div>
            <Link
              href="/dashboard/ask"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800 underline-offset-2 hover:underline py-1"
            >
              Open full page
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Ask SchoolLaunch"
              aria-expanded
              aria-controls={panelId}
              className="w-8 h-8 -mr-1 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 sl-scroll">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Ask about your plan from here. {pathwayConfig.pathway === 'wa_charter' && 'You can also ask for a change, and you’ll see its effect before anything is saved.'}
                </p>
                {suggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q, tab.key)}
                    disabled={streaming || cooldown}
                    className="block w-full text-left text-sm text-slate-600 bg-white hover:bg-teal-50 hover:text-teal-700 border border-slate-200 hover:border-teal-300 rounded-xl px-4 py-3 transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : (
              <ChatThread tabKey={tab.key} compact />
            )}
          </div>

          <div className="px-4 pt-2 pb-4 bg-white border-t border-slate-200 space-y-2">
            <ChatStatus />
            <ChatComposer tabKey={tab.key} inputRef={inputRef} placeholder={`Ask about ${tab.label}…`} />
          </div>
        </aside>
      )}
    </>
  )
}
