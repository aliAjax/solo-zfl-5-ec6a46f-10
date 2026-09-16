import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Scale,
  Bus,
  Clock,
  Calendar,
  X,
  ArrowRight,
  GitMerge,
  AlertTriangle,
  Layers,
  ChevronDown,
} from 'lucide-react'
import { useSceneStore } from '@/store/useSceneStore'
import {
  formatTimestamp,
  getTimeOfDay,
  getWeatherIcon,
  getTreeIcon,
  getPedestrianIcon,
} from '@/utils/sceneHelpers'
import {
  compareGroups,
  filterScenes,
  getFeatureValue,
  formatPercent,
  formatChi2,
  formatPValue,
  TIME_SLOTS,
  FEATURE_LABELS,
  EMPTY_FILTER,
  type GroupFilter,
  type FeatureKey,
  type FeatureResult,
} from '@/utils/stats'
import type { WindowScene } from '@/types'

type Accent = 'sky' | 'rose'

const ACCENT_STYLES: Record<
  Accent,
  {
    name: string
    chipOn: string
    chipOff: string
    hoverRing: string
    text: string
  }
> = {
  sky: {
    name: '甲组',
    chipOn: 'bg-sky-400/20 border-sky-400 text-sky-300',
    chipOff: 'bg-teal-900 border-teal-800 text-mist-400 hover:border-sky-700',
    hoverRing: 'hover:ring-sky-400/30',
    text: 'text-sky-300',
  },
  rose: {
    name: '乙组',
    chipOn: 'bg-rose-400/20 border-rose-400 text-rose-300',
    chipOff: 'bg-teal-900 border-teal-800 text-mist-400 hover:border-rose-700',
    hoverRing: 'hover:ring-rose-400/30',
    text: 'text-rose-300',
  },
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

interface FilterPanelProps {
  accent: Accent
  filter: GroupFilter
  onChange: (next: GroupFilter) => void
  routeNames: string[]
}

function FilterPanel({ accent, filter, onChange, routeNames }: FilterPanelProps) {
  const a = ACCENT_STYLES[accent]
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${on ? a.chipOn : a.chipOff}`

  return (
    <div
      data-testid={`filter-${accent}`}
      className="rounded-2xl border border-teal-800 bg-teal-900/50 p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className={`font-serif text-base font-semibold ${a.text}`}>{a.name}</span>
        <span className="text-[11px] text-mist-500">线路 / 时段 / 日期组合筛选</span>
      </div>

      <div className="space-y-3">
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs text-mist-400">
            <Bus className="w-3 h-3" />线路
            <span className="text-mist-500">（不选 = 不限）</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {routeNames.length === 0 && (
              <span className="text-xs text-mist-500">暂无线路</span>
            )}
            {routeNames.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onChange({ ...filter, routes: toggle(filter.routes, r) })}
                className={chip(filter.routes.includes(r))}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs text-mist-400">
            <Clock className="w-3 h-3" />时段
            <span className="text-mist-500">（不选 = 不限）</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TIME_SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() =>
                  onChange({ ...filter, timeSlots: toggle(filter.timeSlots, s) })
                }
                className={chip(filter.timeSlots.includes(s))}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs text-mist-400">
            <Calendar className="w-3 h-3" />起止日期（含当日）
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              data-testid={`date-from-${accent}`}
              value={filter.dateFrom}
              onChange={(e) => onChange({ ...filter, dateFrom: e.target.value })}
              className="w-full min-w-0 flex-1 rounded-lg border border-teal-800 bg-teal-950/70 px-2 py-1.5 text-xs text-mist-100 [color-scheme:dark] focus:border-dusk-400 focus:outline-none"
            />
            <span className="shrink-0 text-mist-500">至</span>
            <input
              type="date"
              data-testid={`date-to-${accent}`}
              value={filter.dateTo}
              onChange={(e) => onChange({ ...filter, dateTo: e.target.value })}
              className="w-full min-w-0 flex-1 rounded-lg border border-teal-800 bg-teal-950/70 px-2 py-1.5 text-xs text-mist-100 [color-scheme:dark] focus:border-dusk-400 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function describeFilter(filter: GroupFilter): string {
  const parts: string[] = []
  parts.push(filter.routes.length ? filter.routes.join('、') : '全部线路')
  parts.push(filter.timeSlots.length ? filter.timeSlots.join('、') : '全部时段')
  if (filter.dateFrom || filter.dateTo) {
    parts.push(`${filter.dateFrom || '最早'} ~ ${filter.dateTo || '最新'}`)
  }
  return parts.join(' · ')
}

const VERDICT_UI: Record<
  FeatureResult['verdict'],
  { text: string; className: string }
> = {
  significant: {
    text: '差异显著（p<0.05）',
    className: 'bg-dusk-400/20 text-dusk-300 border border-dusk-400/50',
  },
  'not-significant': {
    text: '差异不显著',
    className: 'bg-teal-800/60 text-mist-300 border border-teal-700',
  },
  insufficient: {
    text: '样本不够',
    className: 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50',
  },
  constant: {
    text: '取值全同，无法检验',
    className: 'bg-teal-800/40 text-mist-400 border border-teal-800',
  },
}

function FeatureCard({
  result,
  onOpen,
}: {
  result: FeatureResult
  onOpen: (key: FeatureKey) => void
}) {
  const v = VERDICT_UI[result.verdict]
  const totalA = result.categories.reduce((n, c) => n + c.countA, 0)
  const totalB = result.categories.reduce((n, c) => n + c.countB, 0)

  return (
    <button
      type="button"
      data-testid={`feature-${result.key}`}
      onClick={() => onOpen(result.key)}
      className="w-full rounded-2xl border border-teal-800 bg-teal-900/50 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-dusk-400/40 hover:shadow-lg hover:shadow-dusk-400/10"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-serif text-sm font-semibold text-mist-100">
            {result.label}
          </span>
          {result.chi2 !== null && (
            <span className="text-[11px] text-mist-500">
              χ²={formatChi2(result.chi2)} · df={result.df} · p={formatPValue(result.pValue)}
            </span>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${v.className}`}>
          {v.text}
        </span>
      </div>

      <div className="mb-1 grid grid-cols-[4.5rem_1fr_1fr] items-center gap-2 text-[10px] text-mist-500">
        <span>取值</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />甲组 · 条数/占比
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />乙组 · 条数/占比
        </span>
      </div>
      <div className="space-y-1.5">
        {result.categories.map((c) => {
          const pctA = totalA > 0 ? (c.countA / totalA) * 100 : 0
          const pctB = totalB > 0 ? (c.countB / totalB) * 100 : 0
          return (
            <div
              key={c.value}
              className="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-2 text-[11px]"
            >
              <span className="truncate text-mist-300">{c.value}</span>
              <span className="relative h-3.5 overflow-hidden rounded bg-teal-950/70">
                <span
                  className="absolute inset-y-0 left-0 rounded bg-sky-400/70"
                  style={{ width: `${pctA}%` }}
                />
                <span className="absolute inset-y-0 right-1 flex items-center text-mist-400">
                  {c.countA} · {formatPercent(c.countA, totalA)}
                </span>
              </span>
              <span className="relative h-3.5 overflow-hidden rounded bg-teal-950/70">
                <span
                  className="absolute inset-y-0 left-0 rounded bg-rose-400/70"
                  style={{ width: `${pctB}%` }}
                />
                <span className="absolute inset-y-0 right-1 flex items-center text-mist-400">
                  {c.countB} · {formatPercent(c.countB, totalB)}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      {result.verdict === 'insufficient' && (
        <p className="mt-3 flex items-start gap-1 text-[11px] leading-relaxed text-yellow-300/80">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          期望次数不足 5 的格子 {result.lowExpectedCells}/{result.totalCells}，
          已过半，不判显著，只写样本不够。
        </p>
      )}

      <p className="mt-3 flex items-center gap-1 text-[11px] text-dusk-400/80">
        <ChevronDown className="h-3 w-3" />点击查看两组贡献记录
      </p>
    </button>
  )
}

function MiniScene({
  scene,
  overlap,
  accent,
  featureKey,
  onOpenTimeline,
}: {
  scene: WindowScene
  overlap: boolean
  accent: Accent
  featureKey: FeatureKey
  onOpenTimeline: (scene: WindowScene) => void
}) {
  const a = ACCENT_STYLES[accent]
  return (
    <button
      type="button"
      data-testid="contrib-record"
      onClick={() => onOpenTimeline(scene)}
      className={`w-full rounded-lg border border-teal-800 bg-teal-950/50 p-2.5 text-left transition-colors hover:ring-1 ${a.hoverRing}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {getWeatherIcon(scene.weather)}
          <span className="truncate text-xs font-medium text-mist-100">
            {scene.routeName} · {scene.segment}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${a.chipOn}`}>
          {getFeatureValue(scene, featureKey)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-mist-500">
        <span>{formatTimestamp(scene.timestamp)}</span>
        <span>{getTimeOfDay(scene.timestamp)}</span>
        <span>{scene.seatDirection}侧</span>
        {getTreeIcon(scene.treeDensity)}
        {getPedestrianIcon(scene.pedestrianStatus)}
        {overlap && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5 text-yellow-300">
            <GitMerge className="h-2.5 w-2.5" />重叠
          </span>
        )}
      </div>
    </button>
  )
}

/** 时间线顺序：时间新→旧，时间相同按 id 固定次序，保证同一输入结果一致。 */
function timelineSort(list: WindowScene[]): WindowScene[] {
  return [...list].sort((x, y) => {
    const d = new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime()
    return d !== 0 ? d : x.id.localeCompare(y.id)
  })
}

const FILTER_STORAGE_KEY = 'compare_filters_v1'

function loadStoredFilters(): { a: GroupFilter; b: GroupFilter } {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { a?: GroupFilter; b?: GroupFilter }
      return {
        a: { ...EMPTY_FILTER, ...parsed.a },
        b: { ...EMPTY_FILTER, ...parsed.b },
      }
    }
  } catch {
    // ignore malformed storage
  }
  return { a: EMPTY_FILTER, b: EMPTY_FILTER }
}

export default function ComparePage() {
  const navigate = useNavigate()
  const scenes = useSceneStore((s) => s.scenes)
  const loadAll = useSceneStore((s) => s.loadAll)

  // 筛选条件随会话保留：跳到记录/时间线增删后回来，分组恢复并按最新数据重算。
  const [stored] = useState(loadStoredFilters)
  const [filterA, setFilterA] = useState<GroupFilter>(stored.a)
  const [filterB, setFilterB] = useState<GroupFilter>(stored.b)
  const [openFeature, setOpenFeature] = useState<FeatureKey | null>(null)

  useEffect(() => {
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ a: filterA, b: filterB }))
  }, [filterA, filterB])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 其他页签增删记录时也自动重算。
  useEffect(() => {
    const onStorage = () => loadAll()
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [loadAll])

  const routeNames = useMemo(
    () => [...new Set(scenes.map((s) => s.routeName))].sort((a, b) => a.localeCompare(b)),
    [scenes],
  )

  const groupA = useMemo(() => filterScenes(scenes, filterA), [scenes, filterA])
  const groupB = useMemo(() => filterScenes(scenes, filterB), [scenes, filterB])
  const stats = useMemo(() => compareGroups(groupA, groupB), [groupA, groupB])

  const overlapIds = useMemo(() => {
    const ids = new Set<string>()
    const idsA = new Set(groupA.map((s) => s.id))
    for (const s of groupB) if (idsA.has(s.id)) ids.add(s.id)
    return ids
  }, [groupA, groupB])

  const openResult = openFeature
    ? stats.features.find((f) => f.key === openFeature) ?? null
    : null

  const openScenesA = useMemo(
    () => (openFeature ? timelineSort(groupA) : []),
    [groupA, openFeature],
  )

  const openScenesB = useMemo(
    () => (openFeature ? timelineSort(groupB) : []),
    [groupB, openFeature],
  )

  const goTimeline = (scene: WindowScene) => {
    navigate('/timeline', { state: { focusSceneId: scene.id } })
  }

  const bothEmpty = stats.countA === 0 && stats.countB === 0

  return (
    <div className="min-h-screen bg-teal-950 font-serif text-mist-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2">
          <Scale className="h-7 w-7 text-dusk-400" />
          <h1 className="text-3xl font-bold tracking-wide text-dusk-400">对比台</h1>
        </div>
        <p className="mb-6 -mt-3 text-sm text-mist-400">
          并排比较两组窗景素材在七个特征上的分布差异。分组可按线路、时段或起止日期组合，两组可重叠。
        </p>

        {scenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-mist-400">
            <div className="mb-4 text-6xl opacity-30">🪟</div>
            <p className="text-lg">还没有窗景记录</p>
            <p className="mt-1 text-sm">先去「记录」页采样，再回到对比台分组比较</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <FilterPanel
                accent="sky"
                filter={filterA}
                onChange={setFilterA}
                routeNames={routeNames}
              />
              <FilterPanel
                accent="rose"
                filter={filterB}
                onChange={setFilterB}
                routeNames={routeNames}
              />
            </div>

            <div
              data-testid="group-summary"
              className="mt-4 rounded-2xl border border-teal-800 bg-teal-900/50 p-4"
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
                  <span className="text-mist-300">甲组</span>
                  <strong className="text-sky-300">{stats.countA}</strong> 条
                  <span className="text-xs text-mist-500">
                    （占全部 {formatPercent(stats.countA, scenes.length)}）
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="text-mist-300">乙组</span>
                  <strong className="text-rose-300">{stats.countB}</strong> 条
                  <span className="text-xs text-mist-500">
                    （占全部 {formatPercent(stats.countB, scenes.length)}）
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <GitMerge className="h-4 w-4 text-yellow-300" />
                  <span className="text-mist-300">重叠</span>
                  <strong className="text-yellow-300">{stats.overlap}</strong> 条
                  <span className="text-xs text-mist-500">
                    （占甲组 {formatPercent(stats.overlap, stats.countA)} /
                    乙组 {formatPercent(stats.overlap, stats.countB)}）
                  </span>
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-mist-500 md:grid-cols-2">
                <span>甲组：{describeFilter(filterA)}</span>
                <span>乙组：{describeFilter(filterB)}</span>
              </div>
            </div>

            {bothEmpty ? (
              <div className="mt-6 rounded-2xl border border-teal-800 bg-teal-900/40 p-10 text-center">
                <Layers className="mx-auto mb-3 h-8 w-8 text-mist-500" />
                <p className="text-mist-300">甲组、乙组均为空组（0 条）</p>
                <p className="mt-1 text-sm text-mist-500">
                  结论：没有可比较的记录。放宽筛选条件后再看。
                </p>
              </div>
            ) : stats.countA === 0 || stats.countB === 0 ? (
              <div className="mt-6 rounded-2xl border border-yellow-800/50 bg-yellow-900/10 p-10 text-center">
                <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-yellow-300/70" />
                <p className="text-mist-200">
                  {stats.countA === 0 ? '甲组为空组（0 条）' : '乙组为空组（0 条）'}
                </p>
                <p className="mt-1 text-sm text-mist-400">
                  结论：空组与其他组无法做卡方检验。请为
                  {stats.countA === 0 ? '甲组' : '乙组'}
                  选择包含记录的筛选条件。
                </p>
              </div>
            ) : (
              <>
                {stats.sameGroup && (
                  <div className="mt-4 flex items-start gap-2 rounded-2xl border border-teal-700 bg-teal-800/40 p-4 text-sm text-mist-300">
                    <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
                    <span>
                      结论：两组完全相同（各 {stats.countA} 条，重叠 {stats.overlap} 条）。
                      所有特征两组取值分布一致，卡方值均为 0，均不显著——这是同一组素材与自身比较的预期结果。
                    </span>
                  </div>
                )}
                {(stats.countA === 1 || stats.countB === 1) && (
                  <div className="mt-4 flex items-start gap-2 rounded-2xl border border-yellow-800/50 bg-yellow-900/10 p-4 text-sm text-mist-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300/80" />
                    <span>
                      {stats.countA === 1 ? '甲组' : ''}
                      {stats.countA === 1 && stats.countB === 1 ? '与乙组均' : ''}
                      {stats.countB === 1 && stats.countA !== 1 ? '乙组' : ''}
                      仅 1 条记录（单条组）。单条组的比例只有 0% 或 100%，抽样波动极大；
                      即使个别特征未被判为样本不够，检验结论也不可靠，请勿据此判断两组差异。
                    </span>
                  </div>
                )}

                <div className="mt-6 grid gap-3">
                  {stats.features.map((f) => (
                    <FeatureCard key={f.key} result={f} onOpen={setOpenFeature} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {openResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setOpenFeature(null)}
        >
          <div
            data-testid="contrib-modal"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-teal-700 bg-teal-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-teal-800 p-5">
              <div>
                <h2 className="font-serif text-lg font-bold text-dusk-400">
                  {FEATURE_LABELS[openResult.key]} · 两组贡献记录
                </h2>
                <p className="mt-0.5 text-xs text-mist-400">
                  点击任一记录可回到时间线定位查看
                </p>
              </div>
              <button
                onClick={() => setOpenFeature(null)}
                className="text-mist-400 transition-colors hover:text-mist-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid flex-1 gap-4 overflow-auto p-5 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
                  <span className="font-semibold text-sky-300">甲组</span>
                  <span className="text-xs text-mist-500">{openScenesA.length} 条</span>
                </div>
                <div className="space-y-1.5">
                  {openScenesA.length === 0 && (
                    <p className="text-xs text-mist-500">无记录</p>
                  )}
                  {openScenesA.map((s) => (
                    <MiniScene
                      key={s.id}
                      scene={s}
                      overlap={overlapIds.has(s.id)}
                      accent="sky"
                      featureKey={openResult.key}
                      onOpenTimeline={goTimeline}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="font-semibold text-rose-300">乙组</span>
                  <span className="text-xs text-mist-500">{openScenesB.length} 条</span>
                </div>
                <div className="space-y-1.5">
                  {openScenesB.length === 0 && (
                    <p className="text-xs text-mist-500">无记录</p>
                  )}
                  {openScenesB.map((s) => (
                    <MiniScene
                      key={s.id}
                      scene={s}
                      overlap={overlapIds.has(s.id)}
                      accent="rose"
                      featureKey={openResult.key}
                      onOpenTimeline={goTimeline}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-teal-800 p-4">
              <p className="text-xs text-mist-500">
                {openResult.verdict === 'significant' && '该特征在两组间差异显著。'}
                {openResult.verdict === 'not-significant' &&
                  '该特征在两组间差异不显著。'}
                {openResult.verdict === 'insufficient' &&
                  `期望次数不足 5 的格子 ${openResult.lowExpectedCells}/${openResult.totalCells}，过半，样本不够，不判显著。`}
                {openResult.verdict === 'constant' &&
                  '两组在该特征上取值完全相同，无法检验。'}
              </p>
              <button
                onClick={() => setOpenFeature(null)}
                className="flex items-center gap-1 rounded-lg bg-teal-800 px-3 py-1.5 text-xs text-mist-200 transition-colors hover:bg-teal-700"
              >
                返回对比台 <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
