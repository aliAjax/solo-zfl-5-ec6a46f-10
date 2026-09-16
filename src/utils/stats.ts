import type {
  WindowScene,
  SeatDirection,
  Weather,
  TreeDensity,
  PedestrianStatus,
} from '@/types'

/** 固定特征顺序：同分按此顺序排列，结果展示也按此顺序。 */
export const FEATURE_KEYS = [
  'seatDirection',
  'timeOfDay',
  'weekday',
  'weather',
  'treeDensity',
  'pedestrianStatus',
  'hasSign',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  seatDirection: '座位方向',
  timeOfDay: '时段',
  weekday: '星期',
  weather: '天气',
  treeDensity: '树木密度',
  pedestrianStatus: '行人状态',
  hasSign: '有无招牌',
}

/** 时段固定取值（与 getTimeOfDay 分段一致，按一天中的先后排列）。 */
export const TIME_SLOTS = [
  '清晨',
  '上午',
  '中午',
  '下午',
  '傍晚',
  '夜晚',
  '深夜',
] as const

export type TimeSlot = (typeof TIME_SLOTS)[number]

/** 星期固定取值，周一为首。 */
export const WEEKDAYS = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
] as const

export type Weekday = (typeof WEEKDAYS)[number]

export const SIGN_VALUES = ['无招牌', '有招牌'] as const

const SEAT_VALUES: SeatDirection[] = ['左', '右']
const WEATHER_VALUES: Weather[] = ['晴', '多云', '阴', '小雨', '大雨', '雪', '雾']
const TREE_VALUES: TreeDensity[] = ['稀疏', '适中', '茂密']
const PEDESTRIAN_VALUES: PedestrianStatus[] = ['稀少', '零星', '密集']

/** 每个特征的标准取值顺序；实际数据中出现的其他取值会按字典序追加。 */
const CANONICAL: Record<FeatureKey, string[]> = {
  seatDirection: SEAT_VALUES,
  timeOfDay: [...TIME_SLOTS],
  weekday: [...WEEKDAYS],
  weather: WEATHER_VALUES,
  treeDensity: TREE_VALUES,
  pedestrianStatus: PEDESTRIAN_VALUES,
  hasSign: [...SIGN_VALUES],
}

export interface GroupFilter {
  /** 线路白名单；为空表示不限线路。 */
  routes: string[]
  /** 时段白名单；为空表示不限时段。 */
  timeSlots: string[]
  /** 起始日期（含，YYYY-MM-DD）；空字符串表示不限。 */
  dateFrom: string
  /** 结束日期（含，YYYY-MM-DD）；空字符串表示不限。 */
  dateTo: string
}

export const EMPTY_FILTER: GroupFilter = {
  routes: [],
  timeSlots: [],
  dateFrom: '',
  dateTo: '',
}

/** 由时间戳取时段（与时间线页展示口径保持一致）。 */
export function getTimeSlot(iso: string): TimeSlot {
  const h = new Date(iso).getHours()
  if (h < 6) return '深夜'
  if (h < 9) return '清晨'
  if (h < 12) return '上午'
  if (h < 14) return '中午'
  if (h < 17) return '下午'
  if (h < 19) return '傍晚'
  return '夜晚'
}

function getWeekday(iso: string): Weekday {
  return WEEKDAYS[(new Date(iso).getDay() + 6) % 7]
}

export function getFeatureValue(scene: WindowScene, key: FeatureKey): string {
  switch (key) {
    case 'seatDirection':
      return scene.seatDirection
    case 'timeOfDay':
      return getTimeSlot(scene.timestamp)
    case 'weekday':
      return getWeekday(scene.timestamp)
    case 'weather':
      return scene.weather
    case 'treeDensity':
      return scene.treeDensity
    case 'pedestrianStatus':
      return scene.pedestrianStatus
    case 'hasSign':
      return scene.signText.trim() ? '有招牌' : '无招牌'
  }
}

/** 日期字符串按本地时区解析成当天 00:00 的时间戳；非法/空值返回 null。 */
function parseLocalDate(value: string): number | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null
  }
  return d.getTime()
}

function dayStart(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 按线路、时段、起止日期的组合筛选记录。 */
export function filterScenes(scenes: WindowScene[], filter: GroupFilter): WindowScene[] {
  const from = parseLocalDate(filter.dateFrom)
  const to = parseLocalDate(filter.dateTo)
  const routeSet = new Set(filter.routes)
  const slotSet = new Set(filter.timeSlots)
  return scenes.filter((s) => {
    if (routeSet.size > 0 && !routeSet.has(s.routeName)) return false
    if (slotSet.size > 0 && !slotSet.has(getTimeSlot(s.timestamp))) return false
    if (from !== null || to !== null) {
      const day = dayStart(s.timestamp)
      if (from !== null && day < from) return false
      if (to !== null && day > to) return false
    }
    return true
  })
}

/** 两组的交集条数（按记录 id）。 */
export function overlapCount(groupA: WindowScene[], groupB: WindowScene[]): number {
  const idsA = new Set(groupA.map((s) => s.id))
  return groupB.reduce((n, s) => (idsA.has(s.id) ? n + 1 : n), 0)
}

export function isSameGroup(groupA: WindowScene[], groupB: WindowScene[]): boolean {
  if (groupA.length !== groupB.length) return false
  const idsA = new Set(groupA.map((s) => s.id))
  if (idsA.size !== groupA.length) return false
  return groupB.every((s) => idsA.has(s.id))
}

export interface CategoryStat {
  value: string
  countA: number
  countB: number
}

export type Verdict =
  | 'significant'
  | 'not-significant'
  | 'insufficient'
  | 'constant'

export interface FeatureResult {
  key: FeatureKey
  label: string
  /** 合并后实际参与检验的取值（保留列顺序）。 */
  categories: CategoryStat[]
  chi2: number | null
  df: number
  pValue: number | null
  /** 期望次数不足 5 的格子数。 */
  lowExpectedCells: number
  /** 期望格子总数（合并后的 2×k 格子数）。 */
  totalCells: number
  verdict: Verdict
}

export interface CompareStats {
  countA: number
  countB: number
  overlap: number
  sameGroup: boolean
  features: FeatureResult[]
}

/**
 * 对两组记录在七个特征上逐项做卡方独立性检验。
 *
 * 规则：
 * - 显著水平 0.05；
 * - 先剔除两组合计为 0 的取值列；
 * - 只剩一个取值或两组各合计为 0 时无法检验，记为“取值全同”；
 * - 期望次数不足 5 的格子过半（严格多于一半）时不判显著，只写样本不够；
 * - 结果按卡方值从大到小排，无法计算卡方的排在最后，同分按固定特征顺序。
 */
export function compareGroups(
  groupA: WindowScene[],
  groupB: WindowScene[],
): CompareStats {
  const overlap = overlapCount(groupA, groupB)
  const sameGroup = isSameGroup(groupA, groupB)

  const features = FEATURE_KEYS.map((key): FeatureResult => {
    const label = FEATURE_LABELS[key]

    const countsA = new Map<string, number>()
    const countsB = new Map<string, number>()
    for (const s of groupA) {
      const v = getFeatureValue(s, key)
      countsA.set(v, (countsA.get(v) ?? 0) + 1)
    }
    for (const s of groupB) {
      const v = getFeatureValue(s, key)
      countsB.set(v, (countsB.get(v) ?? 0) + 1)
    }

    // 合并取值：标准取值在前，数据中出现的其他取值按字典序追加；
    // 剔除两组合计为 0 的列。
    const seen = new Set(CANONICAL[key])
    const extras = new Set<string>()
    for (const v of [...countsA.keys(), ...countsB.keys()]) {
      if (!seen.has(v)) extras.add(v)
    }
    const orderedValues = [
      ...CANONICAL[key],
      ...[...extras].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    ]
    const categories: CategoryStat[] = []
    for (const v of orderedValues) {
      const countA = countsA.get(v) ?? 0
      const countB = countsB.get(v) ?? 0
      if (countA + countB > 0) {
        categories.push({ value: v, countA, countB })
      }
    }

    const nA = groupA.length
    const nB = groupB.length
    const total = nA + nB

    let verdict: Verdict
    let chi2: number | null = null
    let df = 0
    let pValue: number | null = null
    let lowExpectedCells = 0
    let totalCells = 0

    if (categories.length < 2 || nA === 0 || nB === 0) {
      verdict = 'constant'
    } else {
      const k = categories.length
      totalCells = 2 * k
      const colTotals = categories.map((c) => c.countA + c.countB)
      // 期望次数 E_rc = 行合计 * 列合计 / 总合计；行合计即 nA、nB。
      const expected = categories.map((_, j) => ({
        ea: (nA * colTotals[j]) / total,
        eb: (nB * colTotals[j]) / total,
      }))
      for (const { ea, eb } of expected) {
        if (ea < 5) lowExpectedCells++
        if (eb < 5) lowExpectedCells++
      }

      let sum = 0
      for (let j = 0; j < k; j++) {
        const { ea, eb } = expected[j]
        const ca = categories[j].countA
        const cb = categories[j].countB
        if (ea > 0) sum += ((ca - ea) ** 2) / ea
        if (eb > 0) sum += ((cb - eb) ** 2) / eb
      }
      // 浮点抖动归零，避免 -0 与极小尾数影响排序一致性。
      chi2 = Math.abs(sum) < 1e-12 ? 0 : round(sum, 10)
      df = k - 1
      pValue = chiSquareSurvival(chi2, df)

      if (lowExpectedCells * 2 > totalCells) {
        verdict = 'insufficient'
      } else {
        verdict = pValue < 0.05 ? 'significant' : 'not-significant'
      }
    }

    return {
      key,
      label,
      categories,
      chi2,
      df,
      pValue,
      lowExpectedCells,
      totalCells,
      verdict,
    }
  })

  features.sort((x, y) => {
    if (x.chi2 === null && y.chi2 === null) {
      return FEATURE_KEYS.indexOf(x.key) - FEATURE_KEYS.indexOf(y.key)
    }
    if (x.chi2 === null) return 1
    if (y.chi2 === null) return -1
    if (y.chi2 !== x.chi2) return y.chi2 - x.chi2
    return FEATURE_KEYS.indexOf(x.key) - FEATURE_KEYS.indexOf(y.key)
  })

  return {
    countA: groupA.length,
    countB: groupB.length,
    overlap,
    sameGroup,
    features,
  }
}

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** 百分比：n/total * 100，保留一位小数（四舍五入）；空组返回 '—'。 */
export function formatPercent(n: number, total: number): string {
  if (total <= 0) return '—'
  const pct = Math.round((n / total) * 1000) / 10
  return `${pct.toFixed(1)}%`
}

export function formatChi2(value: number | null): string {
  if (value === null) return '—'
  return value.toFixed(2)
}

export function formatPValue(p: number | null): string {
  if (p === null) return '—'
  if (p < 0.0001) return '<0.0001'
  return round(p, 4).toFixed(4)
}

// ---- 卡方分布上侧概率 P(χ²_df > x) = 1 - P(df/2, x/2) ----
// 用正则化不完全伽马函数 P(a, x) 计算（Numerical Recipes 的级数/连分式）。

function logGamma(xx: number): number {
  const cof = [
    // eslint-disable-next-line no-loss-of-precision
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ]
  const x = xx
  let y = xx
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) {
    y += 1
    ser += cof[j] / y
  }
  // eslint-disable-next-line no-loss-of-precision
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/** 正则化下不完全伽马函数 P(a, x)。 */
function gammp(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN
  if (x === 0) return 0
  if (x < a + 1) {
    // 级数展开
    let ap = a
    let sum = 1 / a
    let delta = 1 / a
    for (let n = 0; n < 200; n++) {
      ap += 1
      delta *= x / ap
      sum += delta
      if (Math.abs(delta) < Math.abs(sum) * 1e-12) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
  }
  // 连分式，返回 Q(a,x)，再用 1-Q
  let b = x + 1 - a
  let c = 1e300
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
}

/** 卡方分布上侧概率（p 值）。 */
export function chiSquareSurvival(chi2: number, df: number): number {
  if (chi2 <= 0) return 1
  const p = 1 - gammp(df / 2, chi2 / 2)
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}
