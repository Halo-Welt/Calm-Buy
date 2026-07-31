const { collectSignals, findActiveCooldown, recordInput } = require('../../utils/impulse')

const IMPULSE_KEY = 'calm_buy_current_impulse_v1'
const IDLE_TIMER = '--:--:--'
const IDLE_CAPTION = '暂无待冷静的东西'

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
    factors: []
  },

  onShow() {
    this.clearTimers()
    this.loadCooldown()
    this.tickCountdown()
    this.refreshTemperature()
    this._countdownTimer = setInterval(() => this.tickCountdown(), 1000)
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
  },

  /** 读一次 calmList 就够了：每秒去翻本机存储会把逻辑线程拖住，点击会跟着失灵 */
  loadCooldown() {
    this._cooldown = findActiveCooldown()
  },

  tickCountdown() {
    if (this._cooldown && this._cooldown.endAt <= Date.now()) {
      this.loadCooldown()
    }

    const active = this._cooldown
    const timerText = active ? formatCountdown(active.endAt - Date.now()) : IDLE_TIMER
    const timerCaption = active ? active.productText : IDLE_CAPTION

    if (timerText === this.data.timerText && timerCaption === this.data.timerCaption) return
    this.setData({ timerText, timerCaption, hasCooldown: Boolean(active) })
  },

  refreshTemperature() {
    const { temperature, factors, level, hint } = collectSignals(this.data.productText)
    if (temperature === this.data.temperature && hint === this.data.temperatureHint) return
    this.setData({
      temperature,
      meterWidth: temperature,
      temperatureLevel: level,
      temperatureHint: hint,
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
        ? factors.map((item) => `+${item.points}　${item.label}`).join('\n')
        : '没有发现冲动信号：不是深夜，这件东西你是第一次查，最近也没有连着想买别的。\n\n温度只看这些本机记录，不看你打了多少字。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  start() {
    const productText = this.data.productText.trim()
    if (!productText) {
      wx.showToast({ title: '先说说你想买什么', icon: 'none' })
      return
    }

    const beginAnalysis = () => {
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
    }

    if (wx.getStorageSync('calm_buy_ai_consent_v1')) {
      beginAnalysis()
      return
    }

    wx.showModal({
      title: '开始智能分析',
      content: '你的回答会发送至服务端和 DeepSeek 用于本次分析；冷静记录仍只保存在本机。',
      // 真机限制 confirmText / cancelText 最多 4 个汉字，超了整个弹窗都不显示
      confirmText: '同意继续',
      cancelText: '暂不使用',
      success(result) {
        if (!result.confirm) return
        wx.setStorageSync('calm_buy_ai_consent_v1', true)
        beginAnalysis()
      },
      // 这道闸门一旦静默失败，用户会卡在首页且毫无线索
      fail: (error) => {
        wx.showToast({ title: `授权框异常：${error.errMsg}`, icon: 'none', duration: 4000 })
      }
    })
  }
})
