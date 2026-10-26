'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import { buildSchoolContextString } from '@/lib/buildSchoolContext'
import { describeChange, splitProposal, type PlanChange, type PlanSnapshot } from '@/lib/chatEdits'
import type { CardOutcome } from '@/components/chat/ChangePreviewCard'
import {
  aiErrorMessage, readServerError, splitStreamError,
  EMPTY_RESPONSE_MESSAGE, NETWORK_ERROR_MESSAGE, streamFailureMessage,
} from '@/lib/aiErrors'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** On an error message: the question to send again from Retry. */
  retry?: string
  /** On an assistant message: plan changes the chat proposed, shown as a preview card. */
  changes?: PlanChange[]
  /** Where that card ended up (applied, sent, …), so it resumes there wherever it is shown. */
  outcome?: CardOutcome
}

export interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  /** A short pause after each send, so a double click can't send twice. */
  cooldown: boolean
  /** Ask a question. `tabKey` is the dashboard tab the panel is open on (Phase 6e). */
  send: (text: string, tabKey?: string | null) => void
  /** Retry a failed question: drop it and everything after it, then ask again. */
  retry: (index: number, tabKey?: string | null) => void
  setOutcome: (index: number, outcome: CardOutcome) => void
}

const ChatContext = createContext<ChatState | null>(null)

export function useChat(): ChatState {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}

/**
 * An assistant message as sent back to the model: a proposal it made is noted in words, so it
 * knows what the founder was shown.
 */
function historyContent(m: ChatMessage, snapshot: PlanSnapshot): string {
  if (!m.changes?.length) return m.content
  const shown = m.changes.flatMap((c) => describeChange(c, snapshot)).map((l) => `${l.label}: ${l.before} → ${l.after}`)
  return `${m.content}\n\n(Shown to the founder as a preview card, which the Owner can apply: ${shown.join('; ') || 'proposed change'}.)`
}

/**
 * One Ask SchoolLaunch conversation for the dashboard (Phase 6e): the full-page Ask tab and the
 * panel on every other tab read and write the same messages, so a conversation carries across
 * tabs. Lives in the dashboard layout, inside ScenarioProvider; resets on a full page load.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { schoolData, pathwayConfig, multiYear, fpfScorecard: scorecard } = useScenario()
  const isWaCharter = pathwayConfig.pathway === 'wa_charter'
  const { schoolId, schoolName, profile, positions, allPositions, projections, gradeExpansionPlan } = schoolData

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [cooldown, setCooldown] = useState(false)
  // A new conversation per school, so a card proposed for one school never previews or applies
  // against another (the switcher reloads the page today; this holds if that changes).
  const [chatSchoolId, setChatSchoolId] = useState(schoolId)
  if (chatSchoolId !== schoolId) {
    setChatSchoolId(schoolId)
    setMessages([])
  }

  const sendWithHistory = useCallback(
    async (text: string, history: ChatMessage[], tabKey?: string | null) => {
      if (!text.trim() || streaming || cooldown) return

      const question = text.trim()
      const updatedMessages = [...history, { role: 'user' as const, content: question }]
      setMessages(updatedMessages)
      setStreaming(true)
      setCooldown(true)
      setTimeout(() => setCooldown(false), 2000)

      // Every failure ends in a visible error with Retry, never a blank or missing answer.
      const fail = (content: string) =>
        setMessages((prev) => [...prev, { role: 'system', content, retry: question }])

      const schoolContext = buildSchoolContextString(schoolName, profile, positions, projections, gradeExpansionPlan, multiYear, isWaCharter ? scorecard : undefined, pathwayConfig.pathway)

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schoolId,
            messages: updatedMessages
              .filter((m) => m.role !== 'system')
              .slice(-20)
              .map((m) => ({ role: m.role, content: historyContent(m, { profile, allPositions, projections, gradeExpansionPlan }) })),
            schoolContext,
            pathway: pathwayConfig.pathway,
            schoolType: pathwayConfig.pathway === 'generic_private' ? 'private' : pathwayConfig.pathway === 'generic_micro' ? 'micro' : 'charter',
            currentTab: tabKey ?? null,
          }),
        })

        if (!res.ok || !res.body) {
          fail(aiErrorMessage(res.status, await readServerError(res)))
          setStreaming(false)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let assistantText = ''

        setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          assistantText += decoder.decode(value, { stream: true })
          const shown = splitProposal(splitStreamError(assistantText).text).text
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: shown }
            return updated
          })
        }

        const { text: rawAnswer, error: streamError } = splitStreamError(assistantText)
        const { text: answer, changes } = splitProposal(rawAnswer)
        if (changes) {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: answer, changes }
            return updated
          })
        }
        if (!answer.trim() && !changes) {
          // Drop the empty bubble; the error stands in for it.
          setMessages((prev) => prev.slice(0, -1))
          fail(streamError ? streamFailureMessage(streamError) : EMPTY_RESPONSE_MESSAGE)
        } else if (streamError) {
          fail(streamFailureMessage(streamError))
        }
      } catch {
        // A partial answer stays on screen; the error below it offers Retry.
        setMessages((prev) => (prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1].content ? prev.slice(0, -1) : prev))
        fail(NETWORK_ERROR_MESSAGE)
      }

      setStreaming(false)
    },
    [streaming, cooldown, schoolId, schoolName, profile, positions, allPositions, projections, gradeExpansionPlan, multiYear, scorecard, isWaCharter, pathwayConfig.pathway],
  )

  const send = useCallback(
    (text: string, tabKey?: string | null) => { sendWithHistory(text, messages, tabKey) },
    [sendWithHistory, messages],
  )

  const retry = useCallback(
    (index: number, tabKey?: string | null) => {
      const question = messages[index]?.retry
      if (!question) return
      let cut = index
      while (cut > 0 && messages[cut].role !== 'user') cut--
      sendWithHistory(question, messages.slice(0, cut), tabKey)
    },
    [sendWithHistory, messages],
  )

  const setOutcome = useCallback((index: number, outcome: CardOutcome) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, outcome } : m)))
  }, [])

  return (
    <ChatContext.Provider value={{ messages, streaming, cooldown, send, retry, setOutcome }}>
      {children}
    </ChatContext.Provider>
  )
}
