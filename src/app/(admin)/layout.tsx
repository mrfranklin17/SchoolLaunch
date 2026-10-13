'use client'

import { Suspense } from 'react'
import Sidebar from '@/components/Sidebar'
import { TourProvider } from '@/components/tour/TourContext'
import TourRunner from '@/components/tour/TourRunner'
import HelpButton from '@/components/tour/HelpButton'
import TourBanner from '@/components/tour/TourBanner'
import { SchoolSessionProvider } from '@/contexts/SchoolSessionContext'
import { ToastProvider } from '@/components/ui/Toast'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SchoolSessionProvider>
      <TourProvider>
        <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>
          <Sidebar />
          <main className="md:ml-60 p-4 md:p-8 pt-16 md:pt-8">
            <TourBanner />
            {children}
          </main>
          <HelpButton />
          <Suspense fallback={null}>
            <TourRunner />
          </Suspense>
          <ToastProvider />
        </div>
      </TourProvider>
    </SchoolSessionProvider>
  )
}
