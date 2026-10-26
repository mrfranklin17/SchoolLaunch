'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useChat } from '@/contexts/ChatContext'
import { ChangePreviewCard } from '@/components/chat/ChangePreviewCard'

/**
 * The messages of the shared Ask SchoolLaunch conversation: bubbles, errors with Retry, and
 * preview cards that resume from their stored outcome. Used by the Ask tab and the chat panel;
 * `compact` fits the panel's narrow column.
 */
export function ChatThread({ tabKey, compact = false }: { tabKey?: string | null; compact?: boolean }) {
  const { messages, streaming, cooldown, retry, setOutcome } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  return (
    <>
      {messages.map((msg, i) => (
        <div key={i} className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
          {!(msg.changes && !msg.content) && (
            <div
              className={`${compact ? 'max-w-[90%]' : 'max-w-[75%]'} px-4 py-3 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-teal-600 text-white rounded-2xl rounded-br-sm'
                  : msg.role === 'system'
                    ? 'bg-red-50 text-red-700 border border-red-200 rounded-2xl'
                    : 'bg-white text-slate-700 border border-slate-200 rounded-2xl rounded-bl-sm'
              }`}
            >
              {msg.role === 'system' ? (
                <div role="alert">
                  {msg.content}
                  {msg.retry && i === messages.length - 1 && (
                    <button
                      type="button"
                      onClick={() => retry(i, tabKey)}
                      disabled={streaming || cooldown}
                      className="mt-2 block text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-900 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}
                </div>
              ) : msg.content ? (
                <>
                  {msg.content}
                  {streaming && msg.role === 'assistant' && i === messages.length - 1 && (
                    <span className="streaming-cursor" aria-hidden="true">|</span>
                  )}
                </>
              ) : streaming && i === messages.length - 1 ? (
                <span className="inline-flex gap-1 items-center text-slate-400">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              ) : null}
            </div>
          )}
          {msg.changes && (
            <ChangePreviewCard
              changes={msg.changes}
              outcome={msg.outcome}
              onOutcome={(o) => setOutcome(i, o)}
              fullWidth={compact}
            />
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </>
  )
}

/** "Generating…" while an answer streams in. */
export function ChatStatus() {
  const { streaming } = useChat()
  if (!streaming) return null
  return (
    <div role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
      </svg>
      <span>Generating&hellip;</span>
    </div>
  )
}

/** The question box and Send button; asks from `tabKey` when the panel is open on a tab. */
export function ChatComposer({
  tabKey,
  placeholder,
  inputRef,
  className = '',
  tourTarget = false,
}: {
  tabKey?: string | null
  /** Mark it for the Ask tab's guided tour. */
  tourTarget?: boolean
  placeholder: string
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}) {
  const { streaming, cooldown, send } = useChat()
  const [input, setInput] = useState('')
  const blocked = streaming || cooldown || !input.trim()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (blocked) return
    send(input, tabKey)
    setInput('')
  }

  return (
    <form data-tour={tourTarget ? 'chat-input' : undefined} onSubmit={handleSubmit} className={`flex gap-3 ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        aria-label="Your question"
        disabled={streaming}
        className="flex-1 min-w-0 border border-slate-200 rounded-full bg-slate-50 px-4 h-11 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:opacity-50"
      />
      <button
        type="submit"
        aria-label="Send question"
        disabled={blocked}
        className={`w-11 h-11 shrink-0 rounded-full text-white flex items-center justify-center transition-colors ${
          blocked ? 'bg-slate-300' : 'bg-teal-600 hover:bg-teal-700'
        }`}
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
      </button>
    </form>
  )
}
