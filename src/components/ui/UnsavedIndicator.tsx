/** "Unsaved changes" marker shown beside an editor's Save button while it holds unsaved edits. */
export function UnsavedIndicator({ dirty, className = '' }: { dirty: boolean; className?: string }) {
  if (!dirty) return null
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 ${className}`}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
      Unsaved changes
    </span>
  )
}
