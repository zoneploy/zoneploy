import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, Copy, Check, Loader } from 'lucide-react'
import { containersApi } from '@/api/containers'
import { cn } from '@/lib/utils'

// JSON tree colapsable

function JsonNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)

  if (value === null) return <span className="text-text-disabled">null</span>
  if (typeof value === 'boolean') return <span className="text-amber-400">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-blue-400">{value}</span>
  if (typeof value === 'string') return <span className="text-emerald-400">"{value}"</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-secondary">[]</span>
    return (
      <span>
        <button onClick={() => setOpen(v => !v)} className="inline-flex items-center text-text-secondary hover:text-text-primary">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="text-text-secondary ml-0.5">[{value.length}]</span>
        </button>
        {open && (
          <div className="ml-4 border-l border-grey-100/40 pl-3 mt-0.5 space-y-0.5">
            {value.map((item, i) => (
              <div key={i} className="flex gap-1.5">
                <span className="text-text-disabled shrink-0">{i}:</span>
                <JsonNode value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-text-secondary">{'{}'}</span>
    return (
      <span>
        <button onClick={() => setOpen(v => !v)} className="inline-flex items-center text-text-secondary hover:text-text-primary">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="text-text-secondary ml-0.5">{'{'}…{'}'}</span>
        </button>
        {open && (
          <div className="ml-4 border-l border-grey-100/40 pl-3 mt-0.5 space-y-0.5">
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-1.5 flex-wrap">
                <span className="text-primary/80 shrink-0">{k}:</span>
                <JsonNode value={v} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  return <span className="text-text-secondary">{String(value)}</span>
}

// Tab

export function InspectTab({ orgId, containerId }: { orgId: string; containerId: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['inspect', orgId, containerId],
    queryFn: () => containersApi.inspect(orgId, containerId),
    staleTime: 10_000,
  })

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader size={20} className="animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {t('containers.inspectError')}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-grey-100 bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-grey-100">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">docker inspect</p>
        <button
          onClick={copyJson}
          className={cn(
            'flex items-center gap-1.5 text-xs transition-colors',
            copied ? 'text-success' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <div className="p-4 font-mono text-xs leading-relaxed overflow-x-auto max-h-[60vh] overflow-y-auto">
        <JsonNode value={data} depth={0} />
      </div>
    </div>
  )
}
