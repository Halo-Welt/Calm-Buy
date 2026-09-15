/**
 * 冲动温度只统计本机能观察到的行为证据，不去猜商品属性——按下「开始冷静」之前，
 * 我们对这件商品一无所知，任何从输入框内容推算出来的温度都是编的。
 *
 * 每一条信号都带一句 label，用户点开就能看到这一分是从哪来的。
 * 冷静倒计时读的是同一批本地记录，所以一并放在这里。
 */

const INPUT_LOG_KEY = 'calm_buy_input_log_v1'
const LOG_MAX = 60
const LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REPEAT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

const LEVELS = [
  { min: 101, level: 'overheat' },
  { min: 70, level: 'hot' },
  { min: 40, level: 'warm' },
  { min: 1, level: 'mild' }
]
const CALM_HINT = '没发现冲动信号'

// 字符类里的 / 和 [ 一律显式转义：不转义虽然合法，但压缩器扫描正则字面量时容易误判
const NOISE = /[\s.，,。、！!？?~～_\-\/\\（）()【】\[\]"'“”‘’]/g

function normalize(text) {
  return String(text || '').toLowerCase().replace(NOISE, '')
}

/** 同一件东西的判定要保守：说错「这是你第 3 次」比漏报更伤 */
function isSameThing(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))
}

function readLog(now) {
  const raw = wx.getStorageSync(INPUT_LOG_KEY)
  if (!Array.isArray(raw)) return []
  const earliest = now - LOG_TTL_MS
  return raw.filter((item) => item && typeof item.key === 'string' && Number(item.at) > earliest)
}

/** 只在用户真的按下「开始冷静」时记一笔，光敲字不算 */
function recordInput(productText) {
  const key = normalize(productText)
  if (!key) return
  const now = Date.now()
  const log = [{ key, text: String(productText).trim().slice(0, 120), at: now }, ...readLog(now)]
  wx.setStorageSync(INPUT_LOG_KEY, log.slice(0, LOG_MAX))
}

function readCoolings(now) {
  const list = wx.getStorageSync('calmList')
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => item && item.status === 'cooling')
    .map((item) => {
      const hours = Number(item.cooldownHours)
      const createdAt = Number(item.createdAt)
      if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(createdAt)) return null
      return {
        productText: item.productText || '未命名',
        createdAt,
        endAt: createdAt + hours * 3600 * 1000
      }
    })
    .filter((item) => item && item.endAt > now)
}

/** 首页倒计时对着最近加进冷静记录、且还没冷却完的那一件 */
function findActiveCooldown(now = Date.now()) {
  const coolings = readCoolings(now)
  if (!coolings.length) return null
  return coolings.reduce((latest, item) => (item.createdAt > latest.createdAt ? item : latest))
}

function findReviewDue(now = Date.now()) {
  const list = wx.getStorageSync('calmList')
  if (!Array.isArray(list)) return null
  return list
    .filter((item) => item && !item.review48h)
    .map((item) => ({
      ...item,
      endAt: Number(item.createdAt) + (Number(item.cooldownHours) || 48) * 3600 * 1000
    }))
    .filter((item) => Number.isFinite(item.endAt) && item.endAt <= now)
    .sort((a, b) => b.endAt - a.endAt)[0] || null
}

function collectSignals(productText, now = Date.now()) {
  const factors = []
  const hour = new Date(now).getHours()
  const log = readLog(now)
  const key = normalize(productText)

  if (hour >= 23 || hour < 5) {
    factors.push({ points: 25, label: `现在是 ${hour} 点，深夜最容易买了后悔` })
  }

  const repeatSince = now - REPEAT_WINDOW_MS
  const repeats = key
    ? log.filter((item) => item.at > repeatSince && isSameThing(item.key, key)).length
    : 0
  if (repeats > 0) {
    factors.push({
      points: Math.min(30, repeats * 15),
      label: `两周内你已经查过它 ${repeats} 次，这是第 ${repeats + 1} 次`
    })
  }

  const recentSince = now - RECENT_WINDOW_MS
  const others = new Set(
    log
      .filter((item) => item.at > recentSince && !isSameThing(item.key, key))
      .map((item) => item.key)
  ).size
  if (others > 0) {
    factors.push({
      points: Math.min(30, others * 10),
      label: `24 小时内你还想买另外 ${others} 样东西`
    })
  }

  const cooling = readCoolings(now).length
  if (cooling > 0) {
    factors.push({
      points: Math.min(20, cooling * 8),
      label: `还有 ${cooling} 件东西的冷静期没走完`
    })
  }

  if (factors.length >= 3) {
    factors.push({
      points: 18,
      label: '好几条冲动信号叠在一起了'
    })
  }

  factors.sort((a, b) => b.points - a.points)
  const temperature = factors.reduce((sum, item) => sum + item.points, 0)

  return {
    temperature,
    factors,
    level: (LEVELS.find((item) => temperature >= item.min) || { level: 'calm' }).level,
    hint: factors.length ? factors[0].label : CALM_HINT
  }
}

module.exports = {
  collectSignals,
  findActiveCooldown,
  findReviewDue,
  recordInput
}
