// 生成确定性的窗景种子数据（固定 id、固定 UTC 时间戳），用于真机流程验证。
export function buildSeedScenes() {
  const scenes = []

  function push(o) {
    scenes.push({ segment: '区间', note: '', signText: '', ...o })
  }

  const slotHour = { 清晨: 7, 上午: 10, 中午: 13, 下午: 16, 傍晚: 18, 夜晚: 21 }
  // 2026-09：07/14 周一、09/16 周三、11/18 周五、13/20 周日（两周同构）
  const days = [7, 9, 11, 13, 14, 16, 18, 20]
  const weekdayOf = (day) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(2026, 8, day).getDay()]
  const weatherFor = (slot) =>
    ({ 清晨: '多云', 上午: '晴', 中午: '晴', 下午: '晴', 傍晚: '小雨', 夜晚: '阴' }[slot])
  const treeFor = (slot) =>
    ({ 清晨: '适中', 上午: '茂密', 中午: '茂密', 下午: '茂密', 傍晚: '稀疏', 夜晚: '稀疏' }[slot])
  const pedFor = (slot) =>
    ({ 清晨: '稀少', 上午: '零星', 中午: '密集', 下午: '零星', 傍晚: '密集', 夜晚: '稀少' }[slot])

  let n = 0
  for (const route of ['1路', '2路']) {
    for (const slot of ['清晨', '上午', '中午', '下午', '傍晚', '夜晚']) {
      for (const day of days) {
        n++
        const ts = `2026-09-${String(day).padStart(2, '0')}T${String(slotHour[slot]).padStart(2, '0')}:00:00.000Z`
        const is1 = route === '1路'
        // 座位方向在两条线路间系统性不同：1 路白天（上午/中午/下午）靠右，2 路仅夜晚靠右
        const rightFor1 = slot === '上午' || slot === '中午' || slot === '下午'
        const seat = is1 ? (rightFor1 ? '右' : '左') : slot === '夜晚' ? '右' : '左'
        push({
          id: `seed-${n}`,
          routeName: route,
          seatDirection: seat,
          timestamp: ts,
          weather: weatherFor(slot),
          treeDensity: treeFor(slot),
          pedestrianStatus: pedFor(slot),
          signText: slot === '上午' || slot === '中午' ? `招牌${n}` : '',
          segment: `${route}-${slot}`,
          note: `${route} ${weekdayOf(day)} ${slot}的记录`,
        })
      }
    }
  }

  // 单独的 3路 单条记录，用于“单条组 / 空组”场景（周二、清晨、雾）
  scenes.push({
    id: 'seed-solo',
    routeName: '3路',
    segment: '3路-独段',
    seatDirection: '右',
    timestamp: '2026-09-15T08:30:00.000Z',
    weather: '雾',
    signText: '孤招牌',
    treeDensity: '稀疏',
    pedestrianStatus: '稀少',
    note: '唯一的 3 路记录',
  })

  return scenes
}
