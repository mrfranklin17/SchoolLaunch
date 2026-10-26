'use client'

import { Suspense } from 'react'
import Sidebar from '@/components/Sidebar'
import { TourProvider } from '@/components/tour/TourContext'
import TourRunner from '@/components/tour/TourRunner'
import HelpButton from '@/components/tour/HelpButton'
import TourBanner from '@/components/tour/TourBanner'
import { SchoolSessionProvider } from '@/contexts/SchoolSessionContext'
import { ChangeRequestsProvider } from '@/contexts/ChangeRequestsContext'
import ChangeRequestNotice from '@/components/ChangeRequestNotice'
import { ToastProvider } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // One session lookup (user, roles, current school, pathway) for the whole authenticated app.
  return (
    <SchoolSessionProvider>
      <ChangeRequestsProvider>
        <AuthenticatedShell>{children}</AuthenticatedShell>
      </ChangeRequestsProvider>
    </SchoolSessionProvider>
  )
}

function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const { role } = usePermissions()
  const isViewer = role === 'school_viewer'

  return (
    <TourProvider>
      <div
        className="min-h-screen"
        style={{ background: 'var(--bg-page)' }}
        data-viewer={isViewer ? 'true' : undefined}
      >
        <Sidebar />
        <main className="md:ml-60 p-4 md:p-8 pt-16 md:pt-8">
          <TourBanner />
          <ChangeRequestNotice />
          {children}
        </main>
        <HelpButton />
        <Suspense fallback={null}>
          <TourRunner />
        </Suspense>
        <ToastProvider />
      </div>
    </TourProvider>
  )
}
