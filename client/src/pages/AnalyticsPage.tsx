import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// TypeScript Interfaces for API Responses
interface SummaryData {
  totalRequests: number
  successRate: number
  totalInputTokens: number
  totalOutputTokens: number
  avgLatencyMs: number
  estimatedCostSavings: number
}

interface PlatformRow {
  platform: string
  requests: number
  successRate: number
  avgLatencyMs: number
  totalInputTokens: number
  totalOutputTokens: number
}

interface TimelineRow {
  timestamp: string
  requests: number
  successCount: number
  failureCount: number
}

interface ModelRow {
  platform: string
  modelId: string
  displayName: string
  requests: number
  successRate: number
  avgLatencyMs: number
  totalInputTokens: number
  totalOutputTokens: number
}

interface ErrorRow {
  id: string
  platform: string
  modelId: string
  error: string
  latencyMs: number
  createdAt: string
}

interface SuccessRow {
  id: string
  platform: string
  modelId: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  createdAt: string
}

interface ErrorCategoryDist {
  category: string
  count: number
}

interface ErrorPlatformDist {
  platform: string
  count: number
}

interface ErrorDistributionResponse {
  byCategory: ErrorCategoryDist[]
  byPlatform: ErrorPlatformDist[]
  detailed: unknown[]
}

function formatTokens(n: number | string | undefined | null): string {
  if (!n) return '0'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return String(n)
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return String(num)
}

function formatNumber(n: number | undefined | null): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatMs(ms: number | undefined | null): string {
  if (!ms) return '0ms'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms.toFixed(0)}ms`
}

function formatPercent(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—'
  return `${(n * 100).toFixed(1)}%`
}

const RANGE_OPTIONS = [
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
]

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#818cf8', '#7c3aed', '#6d28d9', '#5b21b6']

interface CustomTooltipPayload {
  name: string
  value: string | number
  color?: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: CustomTooltipPayload[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <p className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {entry.name.includes('Tokens') ? formatTokens(entry.value) : typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
          </span>
        </p>
      ))}
    </div>
  )
}

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  trend?: { up: boolean; label: string }
  color: string
}

function StatCard({ title, value, subtitle, icon, trend, color }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 dark:border-zinc-700/60 dark:bg-zinc-900/80">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 blur-2xl transition-opacity duration-500 group-hover:opacity-20" style={{ backgroundColor: color }} />
      <div className="relative z-10 flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</p>
          <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
          {subtitle && <p className="text-xs text-zinc-400 dark:text-zinc-500">{subtitle}</p>}
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg text-lg" style={{ backgroundColor: color + '15', color }}>{icon}</span>
      </div>
      {trend && (
        <div className="relative z-10 mt-3 flex items-center gap-1 text-xs">
          <span className={trend.up ? 'text-emerald-500' : 'text-red-500'}>{trend.up ? '↑' : '↓'}</span>
          <span className={trend.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{trend.label}</span>
          <span className="text-zinc-400 dark:text-zinc-500">&middot; vs previous period</span>
        </div>
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<string>('7d')

  const { data: summary, isLoading: loadingSummary } = useQuery<SummaryData>({
    queryKey: ['analytics-summary', range],
    queryFn: () => apiFetch<SummaryData>(`/api/analytics/summary?range=${range}`),
    refetchInterval: 30_000,
  })

  const { data: byPlatform } = useQuery<PlatformRow[]>({
    queryKey: ['analytics-by-platform', range],
    queryFn: () => apiFetch<PlatformRow[]>(`/api/analytics/by-platform?range=${range}`),
    refetchInterval: 30_000,
  })

  const { data: timeline } = useQuery<TimelineRow[]>({
    queryKey: ['analytics-timeline', range],
    queryFn: () => apiFetch<TimelineRow[]>(`/api/analytics/timeline?range=${range}`),
    refetchInterval: 30_000,
  })

  const { data: byModel } = useQuery<ModelRow[]>({
    queryKey: ['analytics-by-model', range],
    queryFn: () => apiFetch<ModelRow[]>(`/api/analytics/by-model?range=${range}`),
    refetchInterval: 30_000,
  })

  const { data: errors } = useQuery<ErrorRow[]>({
    queryKey: ['analytics-errors', range],
    queryFn: () => apiFetch<ErrorRow[]>(`/api/analytics/errors?range=${range}`),
    refetchInterval: 30_000,
  })

  const { data: successes } = useQuery<SuccessRow[]>({
    queryKey: ['analytics-successes', range],
    queryFn: () => apiFetch<SuccessRow[]>(`/api/analytics/successes?range=${range}`),
    refetchInterval: 30_000,
  })

  const { data: errorDist } = useQuery<ErrorDistributionResponse>({
    queryKey: ['analytics-error-dist', range],
    queryFn: () => apiFetch<ErrorDistributionResponse>(`/api/analytics/error-distribution?range=${range}`),
    refetchInterval: 30_000,
  })

  // Map Summary Data
  const totalRequests = summary?.totalRequests ?? 0
  const successRate = (summary?.successRate ?? 0) / 100 // Convert e.g. 95.5 to 0.955
  const totalTokens = (summary?.totalInputTokens ?? 0) + (summary?.totalOutputTokens ?? 0)
  const avgLatency = summary?.avgLatencyMs ?? 0
  const inputTokens = summary?.totalInputTokens ?? 0
  const outputTokens = summary?.totalOutputTokens ?? 0
  const estimatedSavings = summary?.estimatedCostSavings ?? 0

  // Map Timeline Data
  const timelineData = (timeline ?? []).map((pt) => ({
    label: pt.timestamp,
    success: pt.successCount,
    failures: pt.failureCount,
    requests: pt.requests,
  }))

  const totalFailures = timelineData.reduce((sum, pt) => sum + (pt.failures ?? 0), 0)
  const errorRate = totalRequests > 0 ? ((totalFailures / totalRequests) * 100).toFixed(1) : '0.0'

  // Map Platform Data
  const platformData = (byPlatform ?? []).map((p) => ({
    platform: p.platform,
    requests: p.requests,
    successRate: p.successRate / 100, // Convert percentage to fraction
    avgLatency: p.avgLatencyMs,
    totalInputTokens: p.totalInputTokens,
    totalOutputTokens: p.totalOutputTokens,
  }))

  // Map Model Data
  const modelData = (byModel ?? []).map((m) => ({
    platform: m.platform,
    model: m.displayName || m.modelId,
    requests: m.requests,
    successRate: m.successRate / 100,
    avgLatency: m.avgLatencyMs,
    totalTokens: m.totalInputTokens + m.totalOutputTokens,
  }))

  // Map Error Event List
  const errorData = (errors ?? []).map((err) => ({
    timestamp: err.createdAt,
    platform: err.platform,
    model: err.modelId,
    statusCode: err.error?.match(/\b[45]\d\d\b/)?.[0] ?? 'ERR',
    error: err.error,
  }))

  // Map Successful completions List
  const successData = (successes ?? []).map((s) => ({
    id: s.id,
    timestamp: s.createdAt,
    platform: s.platform,
    model: s.modelId,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    totalTokens: s.inputTokens + s.outputTokens,
    latency: s.latencyMs,
  }))

  // Map Error Distributions
  const errorDistData = errorDist?.byCategory ?? []
  const errorDistByPlatform = errorDist?.byPlatform ?? []

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Analytics Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Real-time usage metrics and performance insights
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/80">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`relative rounded-md px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${range === opt.value ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-400' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loadingSummary ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard title="Total Requests" value={formatNumber(totalRequests)} icon="↗" color="#6366f1" trend={totalRequests > 0 ? { up: true, label: `${formatNumber(totalRequests)}` } : undefined} />
          <StatCard title="Success Rate" value={formatPercent(successRate)} icon="✓" color="#22c55e" subtitle={`${errorRate}% error rate`} trend={successRate > 0.95 ? { up: true, label: 'Healthy' } : { up: false, label: 'Needs attention' }} />
          <StatCard title="Total Tokens" value={formatTokens(totalTokens)} icon="◇" color="#a78bfa" subtitle={`${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out`} />
          <StatCard title="Avg Latency" value={formatMs(avgLatency)} icon="◎" color="#f59e0b" trend={avgLatency < 1000 ? { up: true, label: 'Fast' } : { up: false, label: 'Slower' }} />
          <StatCard title="Est. Savings" value={`$${(estimatedSavings).toFixed(2)}`} icon="$" color="#10b981" subtitle="vs paid API pricing" />
        </div>
      )}

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="col-span-1 lg:col-span-2 rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Request Volume Over Time</h3>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Successful vs failed requests</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="failureGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" className="dark:opacity-20" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#a1a1aa" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="success" name="Success" stroke="#22c55e" fill="url(#successGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#22c55e' }} />
                <Area type="monotone" dataKey="failures" name="Failures" stroke="#ef4444" fill="url(#failureGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#ef4444' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Requests by Provider</h3>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Total volume per platform</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={platformData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} className="dark:opacity-20" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                <YAxis dataKey="platform" type="category" tick={{ fontSize: 11 }} stroke="#a1a1aa" width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="requests" name="Requests" radius={[0, 4, 4, 0]}>
                  {platformData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* New Upgraded Analytics Dashboard Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Token Usage Stacked Bar Chart */}
        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Token Volume by Provider</h3>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Input vs output token processing</p>
          <div className="h-64">
            {platformData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platformData} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" className="dark:opacity-20" />
                  <XAxis dataKey="platform" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" tickFormatter={formatTokens} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="totalInputTokens" name="Input Tokens" stackId="a" fill="#818cf8" fillOpacity={0.85} />
                  <Bar dataKey="totalOutputTokens" name="Output Tokens" stackId="a" fill="#c4b5fd" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
                No token data available
              </div>
            )}
          </div>
        </div>

        {/* Error distribution by provider */}
        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Errors by Provider</h3>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Failed requests grouped by platform</p>
          <div className="h-64">
            {errorDistByPlatform.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={errorDistByPlatform} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" className="dark:opacity-20" />
                  <XAxis dataKey="platform" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name="Errors" radius={[4, 4, 0, 0]} fill="#f87171" fillOpacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
                <span className="text-2xl text-emerald-500 mb-1">✓</span>
                <p>No errors recorded across providers</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Latency, Category distribution, and Snapshot Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Avg Latency by Provider</h3>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Response time in milliseconds</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...platformData].sort((a, b) => (b.avgLatency ?? 0) - (a.avgLatency ?? 0))} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} className="dark:opacity-20" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#a1a1aa" tickFormatter={(v) => `${v}ms`} />
                <YAxis dataKey="platform" type="category" tick={{ fontSize: 11 }} stroke="#a1a1aa" width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="avgLatency" name="Latency" radius={[0, 4, 4, 0]} fill="#f59e0b" fillOpacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {platformData.length > 0 && (() => {
            const sorted = [...platformData].sort((a, b) => (a.avgLatency ?? 0) - (b.avgLatency ?? 0))
            const fastest = sorted[0]
            const slowest = sorted[sorted.length - 1]
            return fastest && slowest ? (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                ⚡ Fastest: {fastest.platform} ({fastest.avgLatency.toFixed(0)}ms)  ·  Slowest: {slowest.platform} ({slowest.avgLatency.toFixed(0)}ms)
              </div>
            ) : null
          })()}
        </div>

        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Error Distribution</h3>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Breakdown by error type</p>
          <div className="flex h-56 flex-col items-center justify-center">
            {errorDistData.length > 0 ? (
              <div className="flex w-full items-center gap-4">
                <div className="h-40 w-40 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={errorDistData} cx="50%" cy="50%" innerRadius={35} outerRadius={65} paddingAngle={2} dataKey="count" nameKey="category">
                        {errorDistData.map((_, i) => (
                          <Cell key={i} fill={['#ef4444', '#f97316', '#eab308', '#a855f7', '#06b6d4'][i % 5]} fillOpacity={0.85} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5">
                  {errorDistData.slice(0, 5).map((entry, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ['#ef4444', '#f97316', '#eab308', '#a855f7', '#06b6d4'][i % 5] }} />
                        <span className="text-zinc-600 dark:text-zinc-400">{entry.category}</span>
                      </div>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{entry.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center text-sm text-zinc-400 dark:text-zinc-500">
                <span className="text-2xl text-emerald-500">✓</span>
                <p className="mt-1">No errors recorded</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Performance Snapshot</h3>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Key health indicators</p>
          <div className="space-y-5">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">Success Rate</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{formatPercent(successRate)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(successRate * 100, 100)}%`, backgroundColor: successRate > 0.95 ? '#22c55e' : successRate > 0.85 ? '#eab308' : '#ef4444' }} />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">Provider Availability</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{platformData.filter(p => p.successRate > 0.8).length}/{platformData.length} online</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: platformData.length > 0 ? (platformData.filter(p => p.successRate > 0.8).length / platformData.length) * 100 + '%' : '0%' }} />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">Token Efficiency (in:out)</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{outputTokens > 0 ? `1:${(inputTokens / Math.max(outputTokens, 1)).toFixed(1)}` : '—'}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: inputTokens + outputTokens > 0 ? (outputTokens / (inputTokens + outputTokens)) * 100 + '%' : '0%' }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Avg Tokens/Req</p>
                <p className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{totalRequests > 0 ? formatTokens(Math.round(totalTokens / totalRequests)) : '—'}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Active Providers</p>
                <p className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{platformData.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Model table */}
      <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Per-Model Breakdown</h3>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{modelData.length} models</span>
        </div>
        <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Detailed metrics by platform and model</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Platform</TableHead>
                <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Model</TableHead>
                <TableHead className="text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">Requests</TableHead>
                <TableHead className="text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">Success Rate</TableHead>
                <TableHead className="text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">Avg Latency</TableHead>
                <TableHead className="text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modelData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
                    No model data available for this period
                  </TableCell>
                </TableRow>
              ) : (
                modelData.slice(0, 50).map((row, i) => (
                  <TableRow key={i} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <TableCell className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{row.platform}</TableCell>
                    <TableCell className="text-sm text-zinc-600 dark:text-zinc-400">
                      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{row.model}</code>
                    </TableCell>
                    <TableCell className="text-right text-sm text-zinc-800 dark:text-zinc-200">{formatNumber(row.requests)}</TableCell>
                    <TableCell className="text-right text-sm">
                      <span className={row.successRate > 0.95 ? 'text-emerald-600 dark:text-emerald-400' : row.successRate > 0.8 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
                        {formatPercent(row.successRate)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm text-zinc-600 dark:text-zinc-400">{formatMs(row.avgLatency)}</TableCell>
                    <TableCell className="text-right text-sm text-zinc-600 dark:text-zinc-400">{formatTokens(row.totalTokens)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Side-by-side Successes & Errors */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Successes Table */}
        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Last 5 Successful Requests</h3>
            {successData.length > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Active</span>
            )}
          </div>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Most recent successful completions</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Time</TableHead>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Platform</TableHead>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Model</TableHead>
                  <TableHead className="text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">Latency</TableHead>
                  <TableHead className="text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {successData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
                      No successful requests recorded yet
                    </TableCell>
                  </TableRow>
                ) : (
                  successData.map((row, i) => (
                    <TableRow key={i} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <TableCell className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
                        {row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : '—'}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{row.platform}</TableCell>
                      <TableCell className="text-sm text-zinc-600 dark:text-zinc-400">
                        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {row.model}
                        </code>
                      </TableCell>
                      <TableCell className="text-right text-sm text-zinc-600 dark:text-zinc-400">{formatMs(row.latency)}</TableCell>
                      <TableCell className="text-right text-sm text-zinc-600 dark:text-zinc-400">{formatTokens(row.totalTokens)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Errors Table */}
        <div className="rounded-xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent Errors</h3>
            {errorData.length > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">{errorData.length} entries</span>
            )}
          </div>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">Last 50 error events</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Time</TableHead>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Platform</TableHead>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Model</TableHead>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Status</TableHead>
                  <TableHead className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errorData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
                      <span className="text-2xl">🎉</span>
                      <p className="mt-1">No errors in this period</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  errorData.slice(0, 5).map((err, i) => (
                    <TableRow key={i} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <TableCell className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{err.timestamp ? new Date(err.timestamp).toLocaleTimeString() : '—'}</TableCell>
                      <TableCell className="text-sm text-zinc-800 dark:text-zinc-200">{err.platform ?? '—'}</TableCell>
                      <TableCell className="text-sm text-zinc-600 dark:text-zinc-400">{err.model ?? '—'}</TableCell>
                      <TableCell><span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">{err.statusCode ?? 'ERR'}</span></TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-zinc-600 dark:text-zinc-400" title={err.error}>{err.error ?? '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  )
}
