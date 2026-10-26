'use client'

import { ScenarioProvider } from '@/lib/ScenarioContext'
import { ChatProvider } from '@/contexts/ChatContext'
import ChatPanel from '@/components/chat/ChatPanel'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // One Ask SchoolLaunch conversation for every tab: the Ask page and the panel (Phase 6e).
  return (
    <ScenarioProvider>
      <ChatProvider>
        {children}
        <ChatPanel />
      </ChatProvider>
    </ScenarioProvider>
  )
}
