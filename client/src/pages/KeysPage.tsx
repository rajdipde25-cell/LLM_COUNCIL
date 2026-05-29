import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { 
  Key, 
  Eye, 
  EyeOff, 
  Copy, 
  Check, 
  RefreshCw, 
  Trash2, 
  Activity, 
  Plus, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  HelpCircle, 
  ShieldCheck, 
  Cpu, 
  Globe, 
  Code, 
  AlertCircle 
} from 'lucide-react'
import type { ApiKey, Platform } from '../../../shared/types'

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'google', label: 'Google AI Studio' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'sambanova', label: 'SambaNova' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)' },
  { value: 'ollama', label: 'Ollama Cloud' },
  { value: 'kilo', label: 'Kilo Gateway (anon ok)' },
  { value: 'pollinations', label: 'Pollinations (anon ok)' },
  { value: 'llm7', label: 'LLM7 (anon ok)' },
]

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

const statusConfig: Record<string, { dot: string; label: string; text: string; bg: string; icon: any }> = {
  healthy: {
    dot: 'bg-emerald-500 shadow-[0_0_8px_oklch(0.72_0.25_140/0.5)]',
    label: 'Healthy',
    text: 'text-emerald-500 dark:text-emerald-400',
    bg: 'bg-emerald-500/10 dark:bg-emerald-500/15',
    icon: CheckCircle2,
  },
  rate_limited: {
    dot: 'bg-amber-500 shadow-[0_0_8px_oklch(0.79_0.15_85/0.5)]',
    label: 'Rate Limited',
    text: 'text-amber-500 dark:text-amber-400',
    bg: 'bg-amber-500/10 dark:bg-amber-500/15',
    icon: AlertTriangle,
  },
  invalid: {
    dot: 'bg-rose-500 shadow-[0_0_8px_oklch(0.6_0.2_25/0.5)]',
    label: 'Invalid',
    text: 'text-rose-500 dark:text-rose-400',
    bg: 'bg-rose-500/10 dark:bg-rose-500/15',
    icon: XCircle,
  },
  error: {
    dot: 'bg-rose-500 shadow-[0_0_8px_oklch(0.6_0.2_25/0.5)]',
    label: 'Error',
    text: 'text-rose-500 dark:text-rose-400',
    bg: 'bg-rose-500/10 dark:bg-rose-500/15',
    icon: XCircle,
  },
  unknown: {
    dot: 'bg-muted-foreground/45',
    label: 'Unchecked',
    text: 'text-muted-foreground',
    bg: 'bg-muted',
    icon: HelpCircle,
  },
}

const PLATFORM_HINTS: Record<string, string> = {
  google: 'Get your API key from Google AI Studio. The free tier has generous rate limits.',
  groq: 'Generate an API key in the Groq Console. Groq offers ultra-fast Llama 3/4 inference.',
  cerebras: 'Get your key from Cerebras Cloud. Cerebras boasts wafer-scale speed and large models.',
  sambanova: 'Get an API key from SambaNova Cloud. Runs DeepSeek V3 and Llama models at high speeds.',
  nvidia: 'Requires an NVIDIA NIM API key. Disabled by default in the router configuration.',
  mistral: 'Generate a key in the Mistral Console. Access Mistral Large, Medium, and Codestral.',
  openrouter: 'Get a free-tier API key on openrouter.ai to access over 19 free-tier models.',
  github: 'Use a classic GitHub Personal Access Token (PAT) with read permissions.',
  cohere: 'Generate a trial/production key from the Cohere Dashboard.',
  cloudflare: 'Requires your Cloudflare Account ID and a Workers AI API Token.',
  zhipu: 'Get your bigmodel.cn or Z.ai key from the Zhipu Developer Platform.',
  ollama: 'Connects to your local or cloud Ollama endpoint.',
  kilo: 'Kilo Gateway key. Accepts anonymous access.',
  pollinations: 'Pollinations AI key. Accepts anonymous access.',
  llm7: 'LLM7 key. Accepts anonymous access.',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

function UnifiedKeySection() {
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data, isError, refetch } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
    retry: false,
  })

  const regenerate = useMutation({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unified-key'] }),
  })

  const apiKey = data?.apiKey ?? ''
  const isLocked = isError || !apiKey
  const masked = apiKey ? apiKey.slice(0, 13) + '•'.repeat(32) : '…'
  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:${__SERVER_PORT__}/v1`
    : `${window.location.origin}/v1`

  function copy() {
    if (isLocked) return
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (isLocked) {
    return (
      <section className="rounded-xl border bg-card p-5 shadow-sm relative overflow-hidden group">
        <div className="absolute right-0 top-0 w-36 h-36 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex-1 space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Key size={16} className="text-rose-500" />
              Your Unified API Key (Unavailable)
            </h2>
            <p className="text-xs text-muted-foreground max-w-xl">
              Failed to retrieve the Unified API key. Check that the server is running and connected.
            </p>

            <div className="flex items-center gap-2 mt-3 max-w-xl">
              <div className="flex-1 font-mono text-xs bg-muted/30 border border-dashed px-3 py-2.5 rounded-lg text-muted-foreground flex items-center gap-2 select-none">
                <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
                Key is unavailable
              </div>
              <Button onClick={() => refetch()} className="h-10 bg-primary font-bold px-5 shrink-0">
                Retry
              </Button>
            </div>
          </div>

          <div className="w-full lg:w-auto shrink-0 lg:border-l lg:pl-6 space-y-3">
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Proxy Base URL</span>
              <div className="flex items-center gap-2 bg-muted/30 border px-3 py-1.5 rounded-lg text-xs font-mono select-all text-foreground/90">
                <Globe size={13} className="text-muted-foreground" />
                {baseUrl}
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Chat Endpoint</span>
              <div className="flex items-center gap-2 bg-muted/30 border px-3 py-1.5 rounded-lg text-xs font-mono select-all text-foreground/90">
                <Code size={13} className="text-muted-foreground" />
                /v1/chat/completions
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm relative overflow-hidden group">
      <div className="absolute right-0 top-0 w-36 h-36 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors pointer-events-none" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex-1 space-y-1">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Key size={16} className="text-primary" />
            Your Unified API Key
          </h2>
          <p className="text-xs text-muted-foreground max-w-xl">
            This token authenticates requests from your application code directly to the proxy. Set it as the <code className="font-mono bg-muted px-1 py-0.5 rounded">api_key</code> in your OpenAI client config.
          </p>

          <div className="flex items-center gap-2 mt-3 max-w-xl">
            <code className="flex-1 font-mono text-xs bg-muted/60 border px-3 py-2.5 rounded-lg select-all truncate tabular-nums">
              {showKey ? apiKey : masked}
            </code>
            <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)} className="h-9 font-semibold">
              {showKey ? <EyeOff size={14} className="mr-1" /> : <Eye size={14} className="mr-1" />}
              {showKey ? 'Hide' : 'Show'}
            </Button>
            <Button variant="outline" size="sm" onClick={copy} className="h-9 font-semibold shrink-0">
              {copied ? <Check size={14} className="text-emerald-500 mr-1" /> : <Copy size={14} className="mr-1" />}
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>

        <div className="w-full lg:w-auto shrink-0 lg:border-l lg:pl-6 space-y-3">
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Proxy Base URL</span>
            <div className="flex items-center gap-2 bg-muted/30 border px-3 py-1.5 rounded-lg text-xs font-mono select-all text-foreground/90">
              <Globe size={13} className="text-muted-foreground" />
              {baseUrl}
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Chat Endpoint</span>
            <div className="flex items-center gap-2 bg-muted/30 border px-3 py-1.5 rounded-lg text-xs font-mono select-all text-foreground/90">
              <Code size={13} className="text-muted-foreground" />
              /v1/chat/completions
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
            className="text-xs text-muted-foreground hover:text-foreground h-8 font-semibold w-full lg:w-auto"
          >
            <RefreshCw size={12} className={`mr-1 ${regenerate.isPending ? 'animate-spin' : ''}`} />
            Regenerate key
          </Button>
        </div>
      </div>
    </section>
  )
}

function KeysStats({
  totalKeys,
  healthyKeys,
  activeProviders,
}: {
  totalKeys: number
  healthyKeys: number
  activeProviders: number
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="rounded-xl border bg-card p-5 shadow-sm relative overflow-hidden group">
        <div className="absolute right-3 top-3 opacity-10 group-hover:scale-110 transition-transform text-primary">
          <Key size={48} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono">Total API Keys</span>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-foreground">{totalKeys}</span>
          <span className="text-sm text-muted-foreground">credentials configured</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Each provider key increases overall request quota.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-sm relative overflow-hidden group">
        <div className="absolute right-3 top-3 opacity-10 group-hover:scale-110 transition-transform text-primary">
          <ShieldCheck size={48} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono">Healthy Connections</span>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-foreground">{healthyKeys}</span>
          <span className="text-sm text-muted-foreground">/ {totalKeys} keys active</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {totalKeys - healthyKeys} keys are unchecked, rate-limited, or invalid.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-sm relative overflow-hidden group">
        <div className="absolute right-3 top-3 opacity-10 group-hover:scale-110 transition-transform text-primary">
          <Cpu size={48} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono">Active Providers</span>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-foreground">{activeProviders}</span>
          <span className="text-sm text-muted-foreground">platforms integrated</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Routing distributes traffic dynamically across these platforms.
        </p>
      </div>
    </div>
  )
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const needsAccountId = platform === 'cloudflare'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !apiKey) return
    if (needsAccountId && !accountId) return
    const key = needsAccountId ? `${accountId}:${apiKey}` : apiKey
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = PLATFORMS.map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  })).filter(p => p.keys.length > 0)

  const healthyKeysCount = keys.filter(k => {
    const h = healthKeyMap.get(k.id)
    return h ? h.status === 'healthy' : k.status === 'healthy'
  }).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Keys"
        description="Provider credentials and the unified API key your apps connect with."
        actions={
          keys.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending} className="font-semibold flex items-center gap-1.5">
              <Activity size={14} className={checkAll.isPending ? 'animate-spin' : ''} />
              {checkAll.isPending ? 'Checking keys…' : 'Check health of all keys'}
            </Button>
          )
        }
      />

      <div className="space-y-8">
        <UnifiedKeySection />

        <KeysStats 
          totalKeys={keys.length}
          healthyKeys={healthyKeysCount}
          activeProviders={grouped.length}
        />

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Plus size={16} className="text-primary" />
            Add a Provider Credential
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground/80">Platform</Label>
                <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                  <SelectTrigger className="w-full h-9 bg-card">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground/80">Label (optional)</Label>
                <Input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="e.g. Personal account, dev, prod..."
                  className="h-9 bg-card"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground/80">
                  {needsAccountId ? 'Workers AI API Token' : 'API Key'}
                </Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={needsAccountId ? 'Enter Cloudflare API token...' : 'Enter your credential key...'}
                  className="font-mono text-xs h-9 bg-card"
                />
                {platform && PLATFORM_HINTS[platform] && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
                    <AlertCircle size={10} className="shrink-0" />
                    {PLATFORM_HINTS[platform]}
                  </p>
                )}
              </div>

              {needsAccountId ? (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/80">Account ID</Label>
                  <Input
                    value={accountId}
                    onChange={e => setAccountId(e.target.value)}
                    placeholder="Enter Cloudflare Account ID..."
                    className="w-full font-mono text-xs h-9 bg-card"
                  />
                </div>
              ) : (
                <div className="flex items-end justify-end">
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t mt-4">
              <Button 
                type="submit" 
                size="sm" 
                disabled={!platform || !apiKey || (needsAccountId && !accountId) || addKey.isPending}
                className="font-bold h-9 px-5"
              >
                {addKey.isPending ? (
                  <>Adding...</>
                ) : (
                  <>
                    <Plus size={14} className="mr-1" />
                    Add key
                  </>
                )}
              </Button>
            </div>
          </form>
          {addKey.isError && (
            <p className="text-destructive text-xs mt-3 flex items-center gap-1.5 font-semibold">
              <XCircle size={12} />
              {(addKey.error as Error).message}
            </p>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Cpu size={16} className="text-primary" />
            Configured Platform Credentials
          </h2>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-2">
                <div className="size-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                <p className="text-sm text-muted-foreground">Loading credentials...</p>
              </div>
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center bg-card flex flex-col items-center justify-center">
              <Key size={32} className="text-muted-foreground mb-3" />
              <h3 className="font-semibold text-base mb-1">No API keys added</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-4">
                Configure your first API key using the form above to start routing requests.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {grouped.map(group => {
                const brandColor = platformColors[group.value] ?? '#94a3b8';
                return (
                  <div key={group.value} className="rounded-xl border bg-card shadow-sm overflow-hidden transition-all hover:border-foreground/15">
                    <div className="h-1" style={{ backgroundColor: brandColor }} />
                    
                    <div className="flex items-center justify-between p-4 border-b bg-muted/10">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ backgroundColor: brandColor }} />
                        <h3 className="font-semibold text-sm text-foreground">{group.label}</h3>
                      </div>
                      <Badge variant="secondary" className="font-semibold text-[10px] px-2 h-5 rounded-full">
                        {group.keys.length} {group.keys.length === 1 ? 'key' : 'keys'}
                      </Badge>
                    </div>

                    <div className="divide-y">
                      {group.keys.map(k => {
                        const h = healthKeyMap.get(k.id)
                        const status = h?.status ?? k.status
                        const lastChecked = h?.lastCheckedAt
                        const statusInf = statusConfig[status] ?? statusConfig.unknown
                        const StatusIcon = statusInf.icon

                        return (
                          <div key={k.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 hover:bg-muted/10 transition-colors">
                            <div className="flex items-center gap-3 min-w-0">
                              <div 
                                className={`size-2.5 rounded-full flex-shrink-0 relative ${statusInf.dot}`}
                                title={`Status: ${statusInf.label}`}
                              />
                              
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <code className="text-xs font-mono font-medium text-foreground select-all bg-muted/40 px-2 py-0.5 rounded border">
                                    {k.maskedKey}
                                  </code>
                                  {k.label && (
                                    <span className="text-xs text-muted-foreground truncate font-medium">
                                      ({k.label})
                                    </span>
                                  )}
                                </div>
                                
                                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                                  <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full text-[10px] ${statusInf.bg} ${statusInf.text}`}>
                                    <StatusIcon size={10} />
                                    {statusInf.label}
                                  </span>
                                  {lastChecked && (
                                    <span className="text-[10px] text-muted-foreground">
                                      Checked {new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <Button 
                                variant="outline" 
                                size="xs" 
                                onClick={() => checkKey.mutate(k.id)} 
                                disabled={checkKey.isPending}
                                className="h-7 text-[11px] font-semibold flex items-center gap-1"
                              >
                                <Activity size={10} className={checkKey.isPending ? 'animate-spin' : ''} />
                                Check
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="xs" 
                                onClick={() => deleteKey.mutate(k.id)} 
                                disabled={deleteKey.isPending}
                                className="h-7 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/5 font-semibold flex items-center gap-1"
                              >
                                <Trash2 size={10} />
                                Remove
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
