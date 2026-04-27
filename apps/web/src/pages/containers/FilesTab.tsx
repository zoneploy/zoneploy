import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Folder, FileText, Link, ChevronRight, RefreshCw, Loader, AlertTriangle } from 'lucide-react'
import { containersApi, type FileEntry } from '@/api/containers'
import { cn } from '@/lib/utils'

// Helpers

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function joinPath(...parts: string[]): string {
  return ('/' + parts.join('/').replace(/\/+/g, '/')).replace(/\/$/, '') || '/'
}

// Breadcrumb

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const segments = path.split('/').filter(Boolean)
  return (
    <div className="flex items-center gap-1 text-sm flex-wrap">
      <button
        onClick={() => onNavigate('/')}
        className="text-primary hover:text-primary/80 font-mono transition-colors"
      >
        /
      </button>
      {segments.map((seg, i) => {
        const segPath = '/' + segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1
        return (
          <span key={segPath} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-text-disabled" />
            {isLast ? (
              <span className="text-text-primary font-mono">{seg}</span>
            ) : (
              <button
                onClick={() => onNavigate(segPath)}
                className="text-primary hover:text-primary/80 font-mono transition-colors"
              >
                {seg}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

// File row

function FileRow({
  entry,
  currentPath,
  onNavigate,
}: {
  entry: FileEntry
  currentPath: string
  onNavigate: (path: string) => void
}) {
  const isDir = entry.type === 'dir'
  const filePath = joinPath(currentPath, entry.name)

  const Icon = isDir ? Folder : entry.type === 'link' ? Link : FileText

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-grey-100/30 border-b border-grey-100 last:border-0 transition-colors">
      <Icon
        size={15}
        className={cn(
          'shrink-0',
          isDir ? 'text-primary/70' : 'text-text-secondary',
        )}
      />

      <div className="flex-1 min-w-0">
        {isDir ? (
          <button
            onClick={() => onNavigate(filePath)}
            className="text-sm text-text-primary hover:text-primary transition-colors font-mono truncate block"
          >
            {entry.name}
          </button>
        ) : (
          <span className="text-sm text-text-primary font-mono truncate block">{entry.name}</span>
        )}
        <span className="text-xs text-text-disabled font-mono">{entry.permissions}</span>
      </div>

      <span className="text-xs text-text-secondary font-mono shrink-0 w-16 text-right">
        {isDir ? '—' : formatSize(entry.size)}
      </span>
    </div>
  )
}

// Tab

export function FilesTab({
  orgId,
  containerId,
  isRunning,
}: {
  orgId: string
  containerId: string
  isRunning: boolean
}) {
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState('/')

  const { data: entries, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['files', orgId, containerId, currentPath],
    queryFn: () => containersApi.listFiles(orgId, containerId, currentPath),
    enabled: isRunning,
    staleTime: 10_000,
    retry: false,
  })

  if (!isRunning) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
        <AlertTriangle size={15} className="shrink-0" />
        {t('containers.filesNotRunning')}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-grey-100 bg-background overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-grey-100">
        <Breadcrumb path={currentPath} onNavigate={setCurrentPath} />
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content. */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader size={20} className="animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle size={14} className="shrink-0" />
          {t('containers.filesError')}
        </div>
      ) : !entries?.length ? (
        <div className="py-10 text-center text-sm text-text-secondary">
          {t('containers.filesEmpty')}
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          {entries.map(entry => (
            <FileRow
              key={entry.name}
              entry={entry}
              currentPath={currentPath}
              onNavigate={setCurrentPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}
