import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { 
  Brain, 
  Zap, 
  Clock, 
  Coins, 
  GripVertical, 
  Sparkles, 
  SlidersHorizontal, 
  ArrowRight, 
  ShieldAlert, 
  RotateCcw, 
  Check, 
  AlertCircle
} from 'lucide-react'

interface FallbackEntry {
  modelDbId: number
  priority: number
  effectivePriority: number
  penalty: number
  rateLimitHits: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  intelligenceRank: number
  speedRank: number
  sizeLabel: string
  rpmLimit: number | null
  rpdLimit: number | null
  monthlyTokenBudget: string
  keyCount: number
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface TokenUsageData {
  totalBudget: number
  totalUsed: number
  models: { displayName: string; platform: string; budget: number }[]
}

const platformColors: Record<string, string> = {
  google:      '#4285f4',
  groq:        '#f55036',
  cerebras:    '#8b5cf6',
  sambanova:   '#14b8a6',
  nvidia:      '#76b900',
  mistral:     '#f59e0b',
  openrouter:  '#ec4899',
  github:      '#24292e',
  cohere:      '#d946ef',
  cloudflare:  '#f38020',
  zhipu:       '#06b6d4',
  ollama:      '#000000',
  kilo:        '#7c3aed',
  pollinations: '#a855f7',
  llm7:        '#0ea5e9',
}

const platformBadgeColors: Record<string, string> = {
  google:      'bg-blue-500/10 text-blue-500 border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400',
  groq:        'bg-orange-500/10 text-orange-500 border-orange-500/20 dark:bg-orange-500/15 dark:text-orange-400',
  cerebras:    'bg-violet-500/10 text-violet-500 border-violet-500/20 dark:bg-violet-500/15 dark:text-violet-400',
  sambanova:   'bg-teal-500/10 text-teal-500 border-teal-500/20 dark:bg-teal-500/15 dark:text-teal-400',
  nvidia:      'bg-emerald-600/10 text-emerald-600 border-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-400',
  mistral:     'bg-amber-500/10 text-amber-500 border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400',
  openrouter:  'bg-pink-500/10 text-pink-500 border-pink-500/20 dark:bg-pink-500/15 dark:text-pink-400',
  github:      'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300',
  cohere:      'bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20 dark:bg-fuchsia-500/15 dark:text-fuchsia-400',
  cloudflare:  'bg-orange-600/10 text-orange-600 border-orange-600/20 dark:bg-orange-600/15 dark:text-orange-400',
  zhipu:       'bg-cyan-500/10 text-cyan-500 border-cyan-500/20 dark:bg-cyan-500/15 dark:text-cyan-400',
  ollama:      'bg-neutral-500/10 text-neutral-600 border-neutral-500/20 dark:bg-neutral-500/15 dark:text-neutral-400',
}

function TokenUsageBar({ data }: { data: TokenUsageData }) {
  const { totalBudget, totalUsed, models } = data
  const remaining = Math.max(0, totalBudget - totalUsed)
  const remainingPct = totalBudget > 0 ? Math.round((remaining / totalBudget) * 100) : 0

  const modelsWithWidth = models.map(m => ({
    ...m,
    remainingTokens: totalBudget > 0 ? (m.budget / totalBudget) * remaining : 0,
    widthPct: totalBudget > 0 ? (m.budget / totalBudget) * (remaining / totalBudget) * 100 : 0,
  }))
  const usedPct = totalBudget > 0 ? (totalUsed / totalBudget) * 100 : 0

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Coins size={16} className="text-primary" />
          Monthly Token Budget Allocation
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground font-bold">{formatTokens(remaining)}</span> remaining
          <span className="mx-1.5 text-muted-foreground/45">·</span>
          <span className="font-medium text-foreground">{remainingPct}%</span> of {formatTokens(totalBudget)}
        </span>
      </div>

      <div className="flex h-3 rounded-full overflow-hidden bg-muted/65 relative">
        {modelsWithWidth.map((m, i) => (
          <div
            key={i}
            title={`${m.displayName} (${m.platform}) — ${formatTokens(m.remainingTokens)} remaining`}
            style={{
              width: `${m.widthPct}%`,
              backgroundColor: platformColors[m.platform] ?? '#94a3b8',
            }}
            className="h-full transition-all duration-300 hover:brightness-110"
          />
        ))}
        {totalUsed > 0 && (
          <div
            title={`Used — ${formatTokens(totalUsed)}`}
            className="bg-muted-foreground/35"
            style={{ width: `${usedPct}%` }}
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-xs tabular-nums">
        {modelsWithWidth.map((m, i) => (
          <div key={i} className="flex items-center gap-2 min-w-0 p-1.5 rounded-lg hover:bg-muted/30 transition-colors">
            <span
              className="size-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: platformColors[m.platform] ?? '#94a3b8' }}
            />
            <span className="truncate font-medium text-foreground/90">{m.displayName}</span>
            <span className="flex-1 border-b border-dashed border-muted/50 mx-1" />
            <span className="font-mono text-muted-foreground font-medium">{formatTokens(m.remainingTokens)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function FallbackStats({
  totalModels,
  activeModels,
  remainingBudget,
  primaryModel,
}: {
  totalModels: number
  activeModels: number
  remainingBudget: number
  primaryModel: string
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Active Chain Stat */}
      <div className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md relative overflow-hidden group">
        <div className="absolute right-3 top-3 opacity-10 group-hover:scale-110 transition-transform text-primary">
          <Zap size={48} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Fallback Chain</span>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-foreground">{activeModels}</span>
          <span className="text-sm text-muted-foreground">/ {totalModels} models active</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {totalModels - activeModels} models currently disabled or without keys.
        </p>
      </div>

      {/* Remaining Budget Stat */}
      <div className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md relative overflow-hidden group">
        <div className="absolute right-3 top-3 opacity-10 group-hover:scale-110 transition-transform text-primary">
          <Coins size={48} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available Token Cap</span>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-foreground">{formatTokens(remainingBudget)}</span>
          <span className="text-sm text-muted-foreground">remaining tokens</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Resets at UTC midnight for most free tiers.
        </p>
      </div>

      {/* Primary Model Stat */}
      <div className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md relative overflow-hidden group">
        <div className="absolute right-3 top-3 opacity-10 group-hover:scale-110 transition-transform text-primary">
          <Sparkles size={48} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary Model (Rank #1)</span>
        <div className="mt-2 flex flex-col justify-between min-h-[36px]">
          <span className="text-lg font-bold tracking-tight text-foreground truncate max-w-full" title={primaryModel}>
            {primaryModel}
          </span>
          <span className="text-xs text-muted-foreground mt-1 block">Handles incoming requests first.</span>
        </div>
      </div>
    </div>
  )
}

function FallbackJourney({ activeEntries }: { activeEntries: FallbackEntry[] }) {
  if (activeEntries.length === 0) return null

  const journeyModels = activeEntries.slice(0, 3)
  const remainingCount = Math.max(0, activeEntries.length - 3)

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold mb-4 text-foreground flex items-center gap-2">
        <SlidersHorizontal size={16} className="text-primary" />
        Fallback Escalation Path
      </h2>
      <div className="flex flex-col md:flex-row items-center gap-4 md:gap-2 lg:gap-4 overflow-x-auto py-2">
        {journeyModels.map((model, idx) => {
          const isFirst = idx === 0
          const isSecond = idx === 1
          const isThird = idx === 2

          let rankBadge = "bg-muted text-muted-foreground border-transparent"
          let cardBorder = "border-border"
          if (isFirst) {
            rankBadge = "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20"
            cardBorder = "border-amber-500/30 dark:border-amber-500/20 shadow-amber-500/[0.02] shadow-sm bg-gradient-to-br from-card to-amber-500/[0.01]"
          } else if (isSecond) {
            rankBadge = "bg-slate-400/15 text-slate-600 dark:text-slate-300 border border-slate-400/20"
            cardBorder = "border-slate-400/30 dark:border-slate-400/20"
          } else if (isThird) {
            rankBadge = "bg-amber-700/15 text-amber-700 dark:text-amber-500 border border-amber-700/20"
            cardBorder = "border-amber-700/30 dark:border-amber-700/20"
          }

          return (
            <div key={model.modelDbId} className="flex flex-col md:flex-row items-center gap-4 md:gap-2 lg:gap-4 w-full md:w-auto">
              <div className={`flex items-center gap-3 p-3 rounded-lg border bg-card/60 min-w-[180px] max-w-[240px] w-full ${cardBorder} transition-all duration-200 hover:scale-[1.02]`}>
                <div className={`size-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${rankBadge}`}>
                  {idx + 1}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate text-foreground" title={model.displayName}>
                    {model.displayName}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: platformColors[model.platform] ?? '#94a3b8' }} />
                    {model.platform}
                  </div>
                </div>
              </div>
              
              {idx < journeyModels.length - 1 && (
                <div className="flex items-center text-muted-foreground/40 shrink-0 rotate-90 md:rotate-0">
                  <ArrowRight size={18} />
                </div>
              )}
            </div>
          )
        })}

        {remainingCount > 0 && (
          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-2 shrink-0">
            <div className="flex items-center text-muted-foreground/40 shrink-0 rotate-90 md:rotate-0">
              <ArrowRight size={18} />
            </div>
            <div className="flex items-center justify-center p-3 rounded-lg border border-dashed bg-muted/30 text-muted-foreground text-xs font-medium min-w-[140px]">
              + {remainingCount} backup {remainingCount === 1 ? 'model' : 'models'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SortableModelRow({
  entry,
  index,
  onToggle,
  isLocked,
}: {
  entry: FallbackEntry
  index: number
  onToggle: (modelDbId: number, enabled: boolean) => void
  isLocked: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.modelDbId,
    disabled: isLocked,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isEnabled = entry.enabled
  const isFirst = index === 0
  const isSecond = index === 1
  const isThird = index === 2

  let rankLabel = `#${index + 1}`
  let rankColorClass = "bg-muted text-muted-foreground border-transparent"
  
  if (isEnabled) {
    if (isFirst) {
      rankLabel = "🥇 Primary"
      rankColorClass = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
    } else if (isSecond) {
      rankLabel = "🥈 Secondary"
      rankColorClass = "bg-slate-400/10 text-slate-600 dark:text-slate-300 border-slate-400/20"
    } else if (isThird) {
      rankLabel = "🥉 Backup"
      rankColorClass = "bg-amber-700/10 text-amber-700 dark:text-amber-500 border-amber-700/20"
    }
  }

  const platformColor = platformColors[entry.platform] ?? '#94a3b8'
  const platformColorClass = platformBadgeColors[entry.platform] ?? 'bg-muted text-muted-foreground border-transparent'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/row relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border bg-card shadow-sm transition-all duration-200 
        ${isDragging ? 'shadow-md z-30 opacity-70 border-primary scale-[1.01]' : 'hover:shadow-md hover:border-foreground/15'} 
        ${isEnabled ? 'border-border' : 'border-border/60 bg-muted/20 opacity-55'}`}
    >
      {isEnabled && (
        <div 
          className="absolute left-0 top-3 bottom-3 w-1 rounded-r-md transition-all duration-200 group-hover/row:bottom-1 group-hover/row:top-1" 
          style={{ backgroundColor: platformColor }}
        />
      )}

      <div className="flex items-center gap-3.5 min-w-0 pl-1.5 flex-1">
        <button
          {...(!isLocked ? attributes : {})}
          {...(!isLocked ? listeners : {})}
          disabled={isLocked}
          className={`${isLocked ? 'cursor-not-allowed opacity-30 text-muted-foreground/20' : 'cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-foreground/80 hover:bg-muted/50'} p-1.5 rounded transition-all shrink-0`}
          aria-label="Drag to reorder"
        >
          <GripVertical size={16} />
        </button>

        <Badge variant="outline" className={`h-6 font-semibold px-2 border shrink-0 text-xs ${rankColorClass}`}>
          {rankLabel}
        </Badge>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base tracking-tight text-foreground">{entry.displayName}</span>
            <Badge variant="outline" className={`font-mono text-[10px] uppercase px-1.5 h-4.5 border ${platformColorClass}`}>
              {entry.platform}
            </Badge>
            {!isEnabled && (
              <Badge variant="outline" className="bg-muted-foreground/10 text-muted-foreground border-transparent font-mono text-[10px] px-1.5 h-4.5">
                Inactive
              </Badge>
            )}
            {isEnabled && entry.penalty > 0 && (
              <Badge variant="destructive" className="font-mono text-[10px] px-1.5 h-4.5 flex items-center gap-1">
                <ShieldAlert size={10} />
                −{entry.penalty} penalty
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 text-xs text-muted-foreground tabular-nums">
            <div className="flex items-center gap-1.5" title="Intelligence Rank">
              <Brain size={13} className="text-muted-foreground/60" />
              <span>Intel #{entry.intelligenceRank}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Speed Rank">
              <Zap size={13} className="text-muted-foreground/60" />
              <span>Speed #{entry.speedRank}</span>
            </div>
            {(entry.rpmLimit || entry.rpdLimit) && (
              <div className="flex items-center gap-1.5" title="Rate Limits">
                <Clock size={13} className="text-muted-foreground/60" />
                <span>
                  {entry.rpmLimit ? `${entry.rpmLimit} rpm` : ''}
                  {entry.rpmLimit && entry.rpdLimit ? ' · ' : ''}
                  {entry.rpdLimit ? `${entry.rpdLimit} rpd` : ''}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5" title="Monthly Token Allowance">
              <Coins size={13} className="text-muted-foreground/60" />
              <span>{entry.monthlyTokenBudget} tok/mo</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-none pt-3 sm:pt-0 shrink-0">
        <span className="sm:hidden text-xs text-muted-foreground">Enable Model</span>
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => onToggle(entry.modelDbId, checked)}
          disabled={isLocked}
        />
      </div>
    </div>
  )
}

export default function FallbackPage() {
  const queryClient = useQueryClient()
  const [localEntries, setLocalEntries] = useState<FallbackEntry[] | null>(null)

  const { data: entries = [], isLoading } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const { data: tokenUsage } = useQuery<TokenUsageData>({
    queryKey: ['fallback', 'token-usage'],
    queryFn: () => apiFetch('/api/fallback/token-usage'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: { modelDbId: number; priority: number; enabled: boolean }[]) =>
      apiFetch('/api/fallback', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
    },
  })

  const sortMutation = useMutation({
    mutationFn: (preset: string) =>
      apiFetch(`/api/fallback/sort/${preset}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
    },
  })

  const { data: keyData, refetch } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
    retry: false,
  })

  useEffect(() => {
    const handleUnlocked = () => {
      refetch()
    }
    window.addEventListener('freellmapi_unlocked', handleUnlocked)
    return () => {
      window.removeEventListener('freellmapi_unlocked', handleUnlocked)
    }
  }, [refetch])

  const isLocked = !keyData?.apiKey

  const allEntries = localEntries ?? entries
  const displayEntries = allEntries.filter(e => e.keyCount > 0)
  const activeEntries = displayEntries.filter(e => e.enabled)
  const unconfiguredPlatforms = [...new Set(allEntries.filter(e => e.keyCount === 0).map(e => e.platform))]

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = displayEntries.findIndex(e => e.modelDbId === active.id)
    const newIndex = displayEntries.findIndex(e => e.modelDbId === over.id)
    const reorderedVisible = arrayMove(displayEntries, oldIndex, newIndex)
    const unconfigured = allEntries.filter(e => e.keyCount === 0)
    const merged = [
      ...reorderedVisible.map((e, i) => ({ ...e, priority: i + 1 })),
      ...unconfigured.map((e, i) => ({ ...e, priority: reorderedVisible.length + i + 1 })),
    ]
    setLocalEntries(merged)
  }

  function handleToggle(modelDbId: number, enabled: boolean) {
    const updated = allEntries.map(e =>
      e.modelDbId === modelDbId ? { ...e, enabled } : e
    )
    setLocalEntries(updated)
  }

  function handleSave() {
    if (!localEntries) return
    saveMutation.mutate(
      allEntries.map(e => ({
        modelDbId: e.modelDbId,
        priority: e.priority,
        enabled: e.enabled,
      }))
    )
  }

  const hasChanges = localEntries !== null

  return (
    <div className="pb-24">
      <PageHeader
        title="Fallback chain"
        description="Drag to reorder. Requests try models top-to-bottom until one succeeds."
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="outline" size="sm" onClick={() => sortMutation.mutate('intelligence')} disabled={isLocked || sortMutation.isPending} className="flex items-center gap-1.5 hover:bg-muted font-semibold">
              <Brain size={14} />
              Sort by intelligence
            </Button>
            <Button variant="outline" size="sm" onClick={() => sortMutation.mutate('speed')} disabled={isLocked || sortMutation.isPending} className="flex items-center gap-1.5 hover:bg-muted font-semibold">
              <Zap size={14} />
              Sort by speed
            </Button>
            <Button variant="outline" size="sm" onClick={() => sortMutation.mutate('budget')} disabled={isLocked || sortMutation.isPending} className="flex items-center gap-1.5 hover:bg-muted font-semibold">
              <Coins size={14} />
              Sort by budget
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Fallback Stats Grid */}
        <FallbackStats 
          totalModels={displayEntries.length}
          activeModels={activeEntries.length}
          remainingBudget={tokenUsage ? Math.max(0, tokenUsage.totalBudget - tokenUsage.totalUsed) : 0}
          primaryModel={activeEntries[0]?.displayName ?? 'None'}
        />

        {/* Fallback Escalation Path flowchart */}
        {!isLoading && activeEntries.length > 0 && (
          <FallbackJourney activeEntries={activeEntries} />
        )}

        {tokenUsage && tokenUsage.totalBudget > 0 && (
          <TokenUsageBar data={tokenUsage} />
        )}

        {isLocked && (
          <div className="flex items-center justify-between gap-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-xl px-4 py-3 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <AlertCircle size={14} />
              Fallback prioritizations are in read-only demo mode. Unlock on the Keys page to reorder or toggle models.
            </span>
            <Button 
              variant="outline" 
              size="xs" 
              onClick={() => window.location.href = '/keys'} 
              className="text-rose-500 border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 h-7"
            >
              Go to Keys Page
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-2">
              <div className="size-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">Loading fallback configurations...</p>
            </div>
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center bg-card flex flex-col items-center justify-center">
            <AlertCircle size={32} className="text-muted-foreground mb-3" />
            <h3 className="font-semibold text-base mb-1">No models available</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Add API keys on the keys configurations page first to populate the fallback chain list.
            </p>
            <Button size="sm" onClick={() => window.location.href = '/keys'}>
              Go to Keys Page
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={displayEntries.map(e => e.modelDbId)}
                  strategy={verticalListSortingStrategy}
                >
                  {displayEntries.map((entry, index) => (
                    <SortableModelRow
                      key={entry.modelDbId}
                      entry={entry}
                      index={index}
                      onToggle={handleToggle}
                      isLocked={isLocked}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            {/* Unconfigured / Inactive Platforms Warning */}
            {unconfiguredPlatforms.length > 0 && (
              <div className="rounded-xl border border-dashed p-4 bg-muted/10 text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} className="text-muted-foreground/60 shrink-0" />
                  <span>
                    Some platforms are hidden from the fallback chain because they don't have configured API keys:
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unconfiguredPlatforms.map(p => (
                    <Badge key={p} variant="outline" className="text-[10px] uppercase font-mono px-1.5 py-0">
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Bottom Action Bar for Unsaved Changes */}
      {hasChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-background/95 dark:bg-card/95 backdrop-blur-md px-5 py-3 rounded-full border shadow-xl border-primary/20 dark:border-primary/30 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center gap-2 text-sm text-foreground font-semibold pr-2">
            <div className="size-2 rounded-full bg-primary animate-pulse" />
            Unsaved changes in priority order
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocalEntries(null)}
              className="rounded-full h-8 px-4 text-xs font-semibold hover:bg-muted"
            >
              <RotateCcw size={12} className="mr-1" />
              Discard
            </Button>
            <Button 
              size="sm" 
              onClick={handleSave} 
              disabled={saveMutation.isPending}
              className="rounded-full h-8 px-4 text-xs font-bold"
            >
              {saveMutation.isPending ? (
                <>Saving...</>
              ) : (
                <>
                  <Check size={12} className="mr-1" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
