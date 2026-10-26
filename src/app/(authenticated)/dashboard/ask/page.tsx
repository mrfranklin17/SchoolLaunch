'use client'

import { useScenario } from '@/lib/ScenarioContext'
import { useChat } from '@/contexts/ChatContext'
import { ChatComposer, ChatStatus, ChatThread } from '@/components/chat/ChatThread'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { AskSkeleton } from '../_skeletons'

const WA_SUGGESTED_QUESTIONS = [
  'What enrollment do I need to break even in Year 1?',
  'Can I afford a full-time principal at this enrollment level?',
  'How does our personnel ratio compare to healthy WA charters?',
  'What happens to our reserve days if we lose 15 students?',
  'Are there braiding opportunities with our grants?',
  'What are the biggest risks in our financial model?',
]

const GENERIC_SUGGESTED_QUESTIONS = [
  'What enrollment do I need to break even in Year 1?',
  'Can I afford a full-time principal at this enrollment level?',
  'How does our personnel ratio compare to healthy schools?',
  'What happens if enrollment is 20% below target?',
  'What are the biggest risks in our financial model?',
  'How should I set tuition to be competitive?',
]

export default function AskPage() {
  const { schoolData, pathwayConfig } = useScenario()
  const isWaCharter = pathwayConfig.pathway === 'wa_charter'
  const { schoolName, loading } = schoolData
  useDocumentTitle('Ask SchoolLaunch', schoolName)
  // The same conversation as the panel on the other tabs (Phase 6e).
  const { messages, streaming, cooldown, send } = useChat()

  if (loading) {
    return <AskSkeleton />
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] animate-fade-in">
      <PageHeader
        title="Ask SchoolLaunch"
        subtitle="Ask questions about your financial model in plain English"
      />
      <div className="mb-2 empty:mb-0"><ChatStatus /></div>
      {/* Messages */}
      <div data-tour="chat-area" className="flex-1 overflow-y-auto bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-4 sl-scroll">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12">
            <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center mb-6">
              <svg
                className="w-7 h-7 text-teal-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
                />
              </svg>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl w-full px-4">
              {(isWaCharter ? WA_SUGGESTED_QUESTIONS : GENERIC_SUGGESTED_QUESTIONS).map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={streaming || cooldown}
                  className="text-left text-sm text-slate-600 bg-slate-50 hover:bg-teal-50 hover:text-teal-700 border border-slate-200 hover:border-teal-300 rounded-xl px-4 py-3 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ChatThread />
        )}
      </div>

      <ChatComposer tourTarget placeholder="Ask about your budget, staffing, cash flow, or WA charter finance..." />
    </div>
  )
}
