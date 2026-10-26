'use client'

import { Toaster as SonnerToaster, toast as sonnerToast, type ExternalToast } from 'sonner'

/**
 * Mount this once in the root layout (or in any client subtree wrapping
 * pages that need toasts). Position bottom-right, system theme, brand
 * styling consistent with our card surface.
 */
export function ToastProvider() {
  return (
    <SonnerToaster
      position="bottom-right"
      // Above the dashboard's Ask SchoolLaunch button (ChatPanel).
      offset={{ bottom: 88, right: 24 }}
      mobileOffset={{ bottom: 80, right: 16, left: 16 }}
      theme="light"
      richColors
      expand={false}
      visibleToasts={3}
      closeButton
      duration={4000}
      toastOptions={{
        className: 'sl-toast',
        style: {
          fontFamily: 'var(--font-body-var)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-2)',
        },
      }}
    />
  )
}

/**
 * Re-export sonner's toast() with a thin facade so consumers import from
 * '@/components/ui/Toast' rather than 'sonner' directly. This keeps the
 * Sonner dependency replaceable from a single seam if we ever swap it.
 */
export const toast = {
  success: (message: string, options?: ExternalToast) => sonnerToast.success(message, options),
  error: (message: string, options?: ExternalToast) => sonnerToast.error(message, options),
  info: (message: string, options?: ExternalToast) => sonnerToast.info(message, options),
  warning: (message: string, options?: ExternalToast) => sonnerToast.warning(message, options),
  message: (message: string, options?: ExternalToast) => sonnerToast(message, options),
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
}
