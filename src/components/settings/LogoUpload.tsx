'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import SchoolLogo from '@/components/SchoolLogo'

const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const ACCEPTED = '.png,.jpg,.jpeg,.svg'

export default function LogoUpload({
  schoolId,
  schoolName,
  logoUrl,
  canEdit,
  onUpdate,
}: {
  schoolId: string
  schoolName: string
  logoUrl: string | null
  canEdit: boolean
  onUpdate: (url: string | null) => void
}) {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(file: File) {
    setError(null)

    if (file.size > MAX_SIZE) {
      setError('File must be under 2MB.')
      return
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    if (!['png', 'jpg', 'jpeg', 'svg'].includes(ext)) {
      setError('Accepted formats: PNG, JPG, SVG.')
      return
    }

    setUploading(true)

    const path = `${schoolId}/logo.${ext}`

    // Upload first so a failed upload never leaves the school without its current logo.
    const { error: uploadErr } = await supabase.storage
      .from('school-logos')
      .upload(path, file, { upsert: true })

    if (uploadErr) {
      setError('Upload failed. Please try again.')
      setUploading(false)
      return
    }

    const { data: urlData } = supabase.storage
      .from('school-logos')
      .getPublicUrl(path)

    // Add cache-bust to force refresh
    const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`

    const { error: profileErr } = await supabase
      .from('school_profiles')
      .update({ logo_url: publicUrl })
      .eq('school_id', schoolId)

    if (profileErr) {
      setError('Logo uploaded but could not be saved to your school profile. Please try again.')
      setUploading(false)
      return
    }

    // Only now that the profile points at the new file, remove logos saved under other extensions.
    const { data: existing } = await supabase.storage.from('school-logos').list(schoolId)
    const stale = (existing || []).map((f) => `${schoolId}/${f.name}`).filter((p) => p !== path)
    if (stale.length > 0) {
      await supabase.storage.from('school-logos').remove(stale)
    }

    onUpdate(publicUrl)
    setUploading(false)
  }

  async function handleRemove() {
    setError(null)
    setUploading(true)

    // Clear the profile reference first so it never points at a deleted file.
    const { error: profileErr } = await supabase
      .from('school_profiles')
      .update({ logo_url: null })
      .eq('school_id', schoolId)

    if (profileErr) {
      setError('Could not remove the logo. Please try again.')
      setUploading(false)
      return
    }

    const { data: existing } = await supabase.storage.from('school-logos').list(schoolId)
    if (existing && existing.length > 0) {
      const toDelete = existing.map((f) => `${schoolId}/${f.name}`)
      await supabase.storage.from('school-logos').remove(toDelete)
    }

    onUpdate(null)
    setUploading(false)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-4 mb-4">
      <div
        className={canEdit ? 'cursor-pointer group relative' : 'relative'}
        onClick={canEdit ? () => fileRef.current?.click() : undefined}
      >
        <SchoolLogo name={schoolName} logoUrl={logoUrl} size={64} />
        {canEdit && (
          <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
            <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleFileSelect}
        className="hidden"
      />
      <div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs text-teal-600 hover:text-teal-700 font-medium disabled:opacity-50"
            >
              {logoUrl ? 'Change logo' : 'Upload logo'}
            </button>
            {logoUrl && (
              <>
                <span className="text-slate-300">|</span>
                <button
                  onClick={handleRemove}
                  disabled={uploading}
                  className="text-xs text-red-700 hover:text-red-800 font-medium disabled:opacity-50"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        )}
        {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
        {canEdit && <p className="text-[10px] text-slate-400 mt-0.5">PNG, JPG, or SVG. Max 2MB.</p>}
      </div>
    </div>
  )
}
