import { chromium } from 'playwright'
import { buildSeedScenes } from './seed.mjs'

const BASE = 'http://localhost:4173'
const shots = '/tmp/shots'
import fs from 'fs'
fs.mkdirSync(shots, { recursive: true })

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; failures.push(name); console.log('  ✗ FAIL:', name, extra) }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message))

async function seed() {
  await page.goto(BASE)
  await page.evaluate((data) => {
    localStorage.setItem('bus_window_scenes', JSON.stringify(data))
  }, buildSeedScenes())
}

async function text(testid) {
  return (await page.locator(`[data-testid="${testid}"]`).innerText()).replace(/\s+/g, ' ').trim()
}

// ---- 场景 0：无数据时对比台空态 ----
console.log('场景 0：空数据空态')
await page.goto(BASE)
await page.evaluate(() => localStorage.removeItem('bus_window_scenes'))
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
check('空态文案', (await page.locator('body').innerText()).includes('还没有窗景记录'))
check('无特征卡', await page.locator('[data-testid^="feature-"]').count() === 0)
await page.screenshot({ path: `${shots}/00-empty.png` })

// 注入种子
await seed()

// ---- 场景 1：原有页面照常可用（记录/时间线/灵感/导航） ----
console.log('场景 1：原有页面回归')
await page.goto(BASE)
await page.waitForLoadState('networkidle')
check('记录页标题', (await page.getByRole('heading', { name: '窗景记录' }).innerText()).includes('窗景记录'))
await page.fill('input[required] >> nth=0', '99路')
await page.fill('input[required] >> nth=1', '测试区间')
await page.click('button[type="submit"]')
await page.waitForTimeout(1600)
check('记录已保存', await page.evaluate(() => JSON.parse(localStorage.getItem('bus_window_scenes')).length === 98))

await page.goto(BASE + '/timeline')
await page.waitForLoadState('networkidle')
// 时间线需选中一条路线后展示该路线记录
await page.click('button:has-text("1路")')
await page.waitForTimeout(200)
await page.locator('.group').first().click()
check('时间线详情弹窗出现', await page.getByText('删除此窗景').count() >= 1)
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.waitForTimeout(200)

await page.goto(BASE + '/inspire')
await page.waitForLoadState('networkidle')
await page.click('button:has-text("采一段窗景")', { force: true })
await page.waitForTimeout(500)
check('灵感页采集到卡片', (await page.locator('body').innerText()).includes('路'))
check('导航含对比台', await page.locator('a[href="/compare"]').count() === 2) // 侧栏+移动底栏
await page.screenshot({ path: `${shots}/01-inspire.png` })

// ---- 场景 2：默认两组相同（不限筛选 => 两组同一全集） ----
console.log('场景 2：两组相同')
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
// 先清掉上轮 sessionStorage 的筛选
await page.evaluate(() => sessionStorage.removeItem('compare_filters_v1'))
await page.reload()
await page.waitForLoadState('networkidle')
let summary = await text('group-summary')
check('两组各 98 条（97种子+1新增）', /甲组\s*98\s*条/.test(summary) && /乙组\s*98\s*条/.test(summary), summary)
check('重叠 98 条', /重叠\s*98\s*条/.test(summary), summary)
check('重叠占比 100%/100%', summary.includes('100.0%'), summary)
check('两组相同横幅', (await page.locator('body').innerText()).includes('两组完全相同'))
// 所有可检验特征卡方 0、不显著；无显著
const sigCount = await page.locator('[data-testid^="feature-"]').locator(':text("差异显著")').count()
check('相同组无显著项', sigCount === 0)
await page.screenshot({ path: `${shots}/02-same-group.png` })

// ---- 场景 3：1路 vs 2路（可重叠=0） ----
console.log('场景 3：1路 vs 2路')
await page.locator('[data-testid="filter-sky"]').locator('button:has-text("1路")').click()
await page.locator('[data-testid="filter-rose"]').locator('button:has-text("2路")').click()
await page.waitForTimeout(200)
summary = await text('group-summary')
check('各 48 条', /甲组\s*48\s*条/.test(summary) && /乙组\s*48\s*条/.test(summary), summary)
check('重叠 0 条', /重叠\s*0\s*条/.test(summary), summary)
check('重叠占比显示—', summary.includes('—') || summary.includes('0.0%'))
// 特征卡按卡方降序
const cards = page.locator('[data-testid^="feature-"]')
const nCards = await cards.count()
check('七个特征卡', nCards === 7, String(nCards))
const chiVals = []
for (let i = 0; i < nCards; i++) {
  const t = (await cards.nth(i).innerText()).replace(/\s+/g, ' ')
  const m = /χ²=([\d.]+)/.exec(t)
  chiVals.push(m ? parseFloat(m[1]) : null)
}
const numeric = chiVals.filter((v) => v !== null)
let sorted = true
for (let i = 1; i < numeric.length; i++) if (numeric[i] > numeric[i - 1] + 1e-9) sorted = false
check('卡方降序', sorted, JSON.stringify(chiVals))
check('第一张卡是座位方向', (await cards.first().getAttribute('data-testid')) === 'feature-seatDirection')
const seatCardText = (await page.locator('[data-testid="feature-seatDirection"]').innerText()).replace(/\s+/g, ' ')
check('座位方向 χ²=12.00 且显著', /χ²=12\.00/.test(seatCardText) && seatCardText.includes('差异显著（p<0.05）'), seatCardText)
check('有显著特征（多变量构造差异）', (await page.locator(':text("差异显著（p<0.05）")').count()) >= 1)
check('无“样本不够”（每格期望充足）', (await page.locator(':text("样本不够")').count()) === 0)
check('无“取值全同”（多取值分布相同）', (await page.locator(':text("取值全同，无法检验")').count()) === 0)
check('六特征分布相同 χ²=0.00', (await page.locator(':text("χ²=0.00")').count()) === 6)
await page.screenshot({ path: `${shots}/03-route-vs.png` })

// ---- 场景 4：下钻贡献记录 + 回时间线 ----
console.log('场景 4：下钻与回时间线')
await page.locator('[data-testid="feature-seatDirection"]').click()
await page.waitForSelector('[data-testid="contrib-modal"]')
const modalText = await page.locator('[data-testid="contrib-modal"]').innerText()
check('弹窗标题含座位方向', modalText.includes('座位方向'))
check('弹窗提示回时间线', modalText.includes('回到时间线'))
// 甲组 24 条（1路），乙组 24 条
check('甲组贡献条数 48', /甲组\s*48\s*条/.test(modalText.replace(/\s+/g, ' ')))
check('乙组贡献条数 48', /乙组\s*48\s*条/.test(modalText.replace(/\s+/g, ' ')))
check('记录显示特征取值（左/右侧标签）', modalText.includes('左') || modalText.includes('右'))
await page.screenshot({ path: `${shots}/04-contrib.png` })
// 点甲组第一条贡献记录 → 回时间线并自动打开详情（弹窗首个按钮是关闭键，故精确定位记录）
await page.locator('[data-testid="contrib-modal"]').locator('[data-testid="contrib-record"]').first().click()
await page.waitForURL('**/timeline')
await page.waitForTimeout(500)
check('回到时间线且详情自动打开', (await page.locator('body').innerText()).includes('删除此窗景'))
const detailModal = page.locator('.fixed.inset-0.z-50').last()
const detailText = (await detailModal.innerText().catch(() => ''))
check('详情属于 1 路', detailText.includes('1路'))
await page.screenshot({ path: `${shots}/05-timeline-focus.png` })

// ---- 场景 5：返回对比台，筛选已恢复，再测增删后自动重算 ----
console.log('场景 5：增删记录后自动重算')
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
summary = await text('group-summary')
check('返回后筛选恢复（各 48 条）', /甲组\s*48\s*条/.test(summary) && /乙组\s*48\s*条/.test(summary), summary)
// 模拟“删一条甲组记录”：直接在时间线删除 1 路的一条
// 通过 storage 删除一条 1 路记录并派发 storage 事件不便，直接用页面操作：
// 到时间线删一条，然后回对比台看甲组变 23
await page.goto(BASE + '/timeline')
await page.click('button:has-text("1路")')
await page.waitForTimeout(200)
await page.locator('.group').first().click()
await page.waitForSelector('text=删除此窗景')
await page.click('button:has-text("删除此窗景")')
await page.waitForTimeout(400)
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
summary = await text('group-summary')
check('删除后甲组 47 条、乙组仍 48', /甲组\s*47\s*条/.test(summary) && /乙组\s*48\s*条/.test(summary), summary)
// 新增一条 2 路记录 → 乙组 25
await page.goto(BASE)
await page.fill('input[required] >> nth=0', '2路')
await page.fill('input[required] >> nth=1', '新增区间')
await page.click('button[type="submit"]')
await page.waitForTimeout(1600)
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
summary = await text('group-summary')
check('新增后甲组 47、乙组 49', /甲组\s*47\s*条/.test(summary) && /乙组\s*49\s*条/.test(summary), summary)

// ---- 场景 6：空组 ----
console.log('场景 6：空组')
await page.evaluate(() => sessionStorage.removeItem('compare_filters_v1'))
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
// 甲组选 1路，乙组选一个不存在的组合：3路 + 夜晚（3路只有清晨记录）
await page.locator('[data-testid="filter-sky"]').locator('button:has-text("1路")').click()
await page.locator('[data-testid="filter-rose"]').locator('button:has-text("3路")').click()
await page.locator('[data-testid="filter-rose"]').locator('button:has-text("夜晚")').click()
await page.waitForTimeout(200)
let body = await page.locator('body').innerText()
check('乙组空组提示', body.includes('乙组为空组') && body.includes('无法做卡方检验'))
check('空组时不渲染特征卡', (await page.locator('[data-testid^="feature-"]').count()) === 0)
// 甲组 47（之前删过一条）
summary = await text('group-summary')
check('空组显示 0 条', /乙组\s*0\s*条/.test(summary), summary)
await page.screenshot({ path: `${shots}/06-empty-group.png` })

// ---- 场景 7：单条组（3路清晨 只有 1 条） ----
console.log('场景 7：单条组')
// 乙组只选 3路（取消夜晚）
await page.locator('[data-testid="filter-rose"]').locator('button:has-text("夜晚")').click()
await page.waitForTimeout(200)
body = await page.locator('body').innerText()
check('单条组提示', body.includes('仅 1 条记录（单条组）'))
check('单条组不出现显著结论', !body.includes('差异显著（p<0.05）'))
await page.screenshot({ path: `${shots}/07-single.png` })

// ---- 场景 8：取值全同（1路上午 vs 2路上午：天气/树木/行人/星期组内全同） ----
console.log('场景 8：取值全同 + 日期分组')
await page.evaluate(() => sessionStorage.removeItem('compare_filters_v1'))
await seed() // 恢复完整 49 条种子
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
// 甲组：1路 + 上午；乙组：2路 + 上午（各 4 条，日期同为周一三五日）
await page.locator('[data-testid="filter-sky"]').locator('button:has-text("1路")').click()
await page.locator('[data-testid="filter-sky"]').locator('button:has-text("上午")').click()
await page.locator('[data-testid="filter-rose"]').locator('button:has-text("2路")').click()
await page.locator('[data-testid="filter-rose"]').locator('button:has-text("上午")').click()
await page.waitForTimeout(200)
summary = await text('group-summary')
check('切片各 8 条', /甲组\s*8\s*条/.test(summary) && /乙组\s*8\s*条/.test(summary), summary)
body = await page.locator('body').innerText()
// 上午在构造中：天气恒晴、树木恒茂密、行人恒零星 → 三项取值全同
const weatherCard = await page.locator('[data-testid="feature-weather"]').innerText()
const treeCard = await page.locator('[data-testid="feature-treeDensity"]').innerText()
const pedCard = await page.locator('[data-testid="feature-pedestrianStatus"]').innerText()
check('天气取值全同', weatherCard.includes('取值全同，无法检验'))
check('树木取值全同', treeCard.includes('取值全同，无法检验'))
check('行人取值全同', pedCard.includes('取值全同，无法检验'))
// 星期两组都含周一/三/五/日各1条 → 分布相同、卡方0（小样本仅判样本不够，不会显著）
const weekdayCard = await page.locator('[data-testid="feature-weekday"]').innerText()
check('星期不判显著（样本不够）', !weekdayCard.includes('差异显著（p<0.05）'))
check('无任何显著项（n=4 小样本）', !body.includes('差异显著（p<0.05）'))
await page.screenshot({ path: `${shots}/08-constant.png` })

// ---- 场景 8b：日期起止分组 ----
await page.evaluate(() => sessionStorage.removeItem('compare_filters_v1'))
await page.goto(BASE + '/compare')
await page.waitForLoadState('networkidle')
await page.fill('[data-testid="date-from-sky"]', '2026-09-07')
await page.fill('[data-testid="date-to-sky"]', '2026-09-07')
await page.fill('[data-testid="date-from-rose"]', '2026-09-09')
await page.fill('[data-testid="date-to-rose"]', '2026-09-09')
await page.waitForTimeout(200)
summary = await text('group-summary')
check('单日分组各 12 条', /甲组\s*12\s*条/.test(summary) && /乙组\s*12\s*条/.test(summary), summary)
check('单日重叠 0', /重叠\s*0\s*条/.test(summary))
// A 全在周一、B 全在周三 → 星期完全关联：2×2 表 [[12,0],[0,12]]，χ²=24，显著
const weekdayCard2 = (await page.locator('[data-testid="feature-weekday"]').innerText()).replace(/\s+/g, ' ')
check('单日星期完全关联 χ²=24 显著', /χ²=24\.00/.test(weekdayCard2) && weekdayCard2.includes('差异显著（p<0.05）'), weekdayCard2)

// ---- 场景 9：确定性（同输入两次渲染顺序/文案一致） ----
console.log('场景 9：确定性')
const order1 = await page.locator('[data-testid^="feature-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')).join(','))
await page.reload()
await page.waitForLoadState('networkidle')
const order2 = await page.locator('[data-testid^="feature-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')).join(','))
check('刷新后特征顺序一致', order1 === order2, `\n${order1}\n${order2}`)

// ---- 控制台无报错 ----
check('控制台无错误', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
if (fail) process.exit(1)
