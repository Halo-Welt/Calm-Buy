const { collectSignals, findActiveCooldown, findReviewDue, recordInput } = require('../../utils/impulse')
const { analyticsConsent, setAnalyticsConsent } = require('../../utils/analytics')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')
const { syncTabBar } = require('../../utils/tabbar')

const IMPULSE_KEY = 'calm_buy_current_impulse_v1'
const IDLE_TIMER = '--:--:--'
const IDLE_CAPTION = '暂无待冷静的东西'
const PROMPT_CASES = [
  'VR眼镜，想用来床上看电影',
  '限量联名球鞋，就怕错过没了',
  '新出的iPhone',
  '同事推荐我买的降噪耳机',
  '直播间秒杀的美容仪'
]
const TYPE_MS = 70
const HOLD_MS = 1800
const DELETE_MS = 36
const GAP_MS = 420

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

const PAPER_RGB = [255, 253, 248]
const COLD_RGB = [22, 72, 216]
const COLOR_STOPS = [
  [1, [255, 186, 56]],
  [55, [255, 96, 42]],
  [100, [255, 58, 48]],
  [140, [196, 16, 92]]
]

function mixRgb(from, to, t) {
  return from.map((value, index) => Math.round(value + (to[index] - value) * t))
}

function rgbCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

function colorAt(temp) {
  const value = Math.max(0, Number(temp) || 0)
  if (value <= 0) return COLD_RGB
  if (value <= COLOR_STOPS[0][0]) return COLOR_STOPS[0][1]
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]
  if (value >= last[0]) return last[1]
  for (let i = 1; i < COLOR_STOPS.length; i += 1) {
    if (value <= COLOR_STOPS[i][0]) {
      const [min, from] = COLOR_STOPS[i - 1]
      const [max, to] = COLOR_STOPS[i]
      return mixRgb(from, to, (value - min) / (max - min))
    }
  }
  return last[1]
}

function temperaturePalette(temp) {
  const rgb = colorAt(temp)
  const overheat = temp > 100
  return {
    thermoColor: rgbCss(rgb),
    cardColor: rgbCss(mixRgb(rgb, PAPER_RGB, overheat ? 0.78 : 0.86))
  }
}

Page({
  data: {
    productText: '',
    timerText: IDLE_TIMER,
    timerCaption: IDLE_CAPTION,
    hasCooldown: false,
    temperature: 0,
    meterWidth: 0,
    temperatureLevel: 'calm',
    temperatureHint: '没发现冲动信号',
    thermoColor: 'rgb(22, 72, 216)',
    cardColor: 'rgb(222, 228, 244)',
    overheat: false,
    factors: [],
    showConsent: false,
    placeholderText: ''
  },

  onShow() {
    syncTabBar(this, 0)
    enableShareMenu()
    // 遮罩盖不住原生 tabBar，用户可以带着弹窗切页，回来时不该看到残留
    if (this.data.showConsent) this.setData({ showConsent: false })
    this.clearTimers()
    this.loadCooldown()
    this.tickCountdown()
    this.refreshTemperature()
    this._countdownTimer = setInterval(() => this.tickCountdown(), 1000)
    this.startTypewriter()
  },

  onHide() {
    this.clearTimers()
  },

  onUnload() {
    this.clearTimers()
  },

  clearTimers() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    if (this._impulseTimer) {
      clearTimeout(this._impulseTimer)
      this._impulseTimer = null
    }
    this.stopTypewriter()
  },

  startTypewriter() {
    this.stopTypewriter()
    this._typeCaseIndex = 0
    this._typeCharIndex = 0
    this._typePhase = 'typing'
    this.tickTypewriter()
  },

  stopTypewriter() {
    if (this._typewriterTimer) {
      clearTimeout(this._typewriterTimer)
      this._typewriterTimer = null
    }
  },

  setPlaceholder(example) {
    if (this.data.productText) return
    const placeholderText = example
    if (placeholderText === this.data.placeholderText) return
    this.setData({ placeholderText })
  },

  tickTypewriter() {
    const text = PROMPT_CASES[this._typeCaseIndex]
    let delay = TYPE_MS

    if (this._typePhase === 'typing') {
      this._typeCharIndex += 1
      this.setPlaceholder(text.slice(0, this._typeCharIndex))
      if (this._typeCharIndex >= text.length) {
        this._typePhase = 'holding'
        delay = HOLD_MS
      }
    } else if (this._typePhase === 'holding') {
      this._typePhase = 'deleting'
      delay = DELETE_MS
    } else {
      this._typeCharIndex -= 1
      this.setPlaceholder(text.slice(0, Math.max(this._typeCharIndex, 0)))
      if (this._typeCharIndex <= 0) {
        this._typePhase = 'typing'
        this._typeCaseIndex = (this._typeCaseIndex + 1) % PROMPT_CASES.length
        delay = GAP_MS
      }
    }

    this._typewriterTimer = setTimeout(() => this.tickTypewriter(), delay)
  },

  /** 读一次 calmList 就够了：每秒去翻本机存储会把逻辑线程拖住，点击会跟着失灵 */
  loadCooldown() {
    this._cooldown = findActiveCooldown()
    this._reviewDue = findReviewDue()
  },

  tickCountdown() {
    if (this._cooldown && this._cooldown.endAt <= Date.now()) {
      this.loadCooldown()
    }

    const active = this._cooldown
    const due = this._reviewDue
    const timerText = active ? formatCountdown(active.endAt - Date.now()) : due ? '可复盘' : IDLE_TIMER
    const timerCaption = active ? active.productText : due ? due.productText : IDLE_CAPTION

    if (timerText === this.data.timerText && timerCaption === this.data.timerCaption) return
    this.setData({ timerText, timerCaption, hasCooldown: Boolean(active) })
  },

  refreshTemperature() {
    const { temperature, factors, level, hint } = collectSignals(this.data.productText)
    if (temperature === this.data.temperature && hint === this.data.temperatureHint) return
    this.setData({
      temperature,
      meterWidth: Math.min(100, temperature),
      temperatureLevel: level,
      temperatureHint: hint,
      overheat: temperature > 100,
      ...temperaturePalette(temperature),
      factors
    })
  },

  onInput(event) {
    this.setData({ productText: event.detail.value })
    // 重复输入这条信号要等用户把名字打完才有意义，顺便避免每次按键都重算
    if (this._impulseTimer) clearTimeout(this._impulseTimer)
    this._impulseTimer = setTimeout(() => this.refreshTemperature(), 300)
  },

  explainTemperature() {
    const { factors, temperature } = this.data
    wx.showModal({
      title: `冲动温度 ${temperature}°`,
      content: factors.length
        ? `${temperature > 100 ? '已经超过 100°，温度计溢出来了。\n\n' : ''}${factors.map((item) => `+${item.points}　${item.label}`).join('\n')}\n\n它只反映本机行为信号，不是心理诊断或财务评价。`
        : '没有发现冲动信号：不是深夜，这件东西你是第一次查，最近也没有连着想买别的。\n\n温度只看这些本机记录，不是心理诊断或财务评价。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  openCooldowns() {
    wx.switchTab({ url: '/pages/list/list' })
  },

  start() {
    const productText = this.data.productText.trim()
    if (!productText) {
      wx.showToast({ title: '先说说你想买什么', icon: 'none' })
      return
    }

    if (wx.getStorageSync('calm_buy_ai_consent_v1')) {
      this.askAnalyticsConsent(() => this.runAnalysis(productText))
      return
    }

    // 自定义弹窗不像原生 modal 会自动收起键盘
    wx.hideKeyboard()
    this.setData({ showConsent: true })
  },

  acceptConsent() {
    this.setData({ showConsent: false })
    wx.setStorageSync('calm_buy_ai_consent_v1', true)
    this.askAnalyticsConsent(() => this.runAnalysis(this.data.productText.trim()))
  },

  declineConsent() {
    this.setData({ showConsent: false })
  },

  /** 挡住遮罩上的滚动穿透 */
  noop() {},

  askAnalyticsConsent(done) {
    if (analyticsConsent() !== '') {
      done()
      return
    }
    wx.showModal({
      title: '是否参与匿名改进？',
      content: '仅上传结论枚举、耗时和随机分析编号；不上传商品名、预算或对话原文。你可以在“我的”中删除。',
      confirmText: '同意参与',
      cancelText: '暂不参与',
      success: ({ confirm }) => {
        setAnalyticsConsent(confirm)
        done()
      },
      fail: done
    })
  },

  runAnalysis(productText) {
    // chat 页读不到 currentProduct 会直接弹回首页，所以这一步失败必须让用户看见
    try {
      wx.setStorageSync('currentProduct', productText)
    } catch (error) {
      wx.showModal({
        title: '无法保存这次输入',
        content: error.message || '本机存储写入失败',
        showCancel: false
      })
      return
    }

    // 冲动信号是附加功能，记不上也不该挡住跳转
    try {
      const impulse = collectSignals(productText)
      wx.setStorageSync(IMPULSE_KEY, {
        temperature: impulse.temperature,
        signals: impulse.factors.map((item) => item.label)
      })
      // 本次查询要在快照之后才计入历史，否则会把自己算成一次重复
      recordInput(productText)
    } catch (error) {
      console.error('[Calm Buy] 记录冲动信号失败', error)
    }

    wx.navigateTo({
      url: '/pages/chat/chat',
      fail: (error) => {
        wx.showModal({
          title: '打开对话失败',
          content: error.errMsg || '未知原因',
          showCancel: false
        })
      }
    })
  },

  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
