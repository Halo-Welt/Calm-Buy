const { VERDICT_ART } = require('../../utils/resultAdapter')

Page({
  data: {
    result: null,
    saved: false
  },

  onLoad() {
    const storedResult = getApp().globalData.lastResult || wx.getStorageSync('lastResult')
    if (!storedResult) {
      wx.switchTab({ url: '/pages/index/index' })
      return
    }

    const result = {
      ...storedResult,
      verdictArt: storedResult.verdictArt || VERDICT_ART[storedResult.verdict] || VERDICT_ART.wait,
      rootNeed: storedResult.rootNeed || storedResult.needSentence,
      evidenceQuotes: storedResult.evidenceQuotes || [`我想买：${storedResult.productText}`, storedResult.needSentence],
      needDecomposition: storedResult.needDecomposition || {
        functional: storedResult.needSentence,
        emotional: '',
        social: '',
        constraints: [],
        successCriterion: ''
      },
      minimumExperiment: storedResult.minimumExperiment || null,
      candidateProducts: storedResult.candidateProducts || [],
      searchSources: storedResult.searchSources || [],
      reviewSummary: storedResult.reviewSummary || {
        source_note: '历史基础判断；未联网核验'
      }
    }
    const calmList = wx.getStorageSync('calmList') || []
    this.setData({
      result,
      saved: calmList.some((item) => item.id === result.id)
    })
  },

  copySummary() {
    const { result } = this.data
    const reasons = result.reasons.map((reason) => `- ${reason}`).join('\n')
    const evidence = result.evidenceQuotes.map((quote) => `- “${quote}”`).join('\n')
    const market = result.marketSnapshot || {}
    const candidates = result.candidateProducts.length
      ? ['值得看的候选：', ...result.candidateProducts.map((item) => `- ${item.title}：${item.why}`)].join('\n')
      : ''
    const text = [
      `Calm Buy 判决：${result.verdictLabel}`,
      `想买：${result.productText}`,
      `真正需求：${result.rootNeed || result.needSentence}`,
      `置信度：${result.confidenceLabel}`,
      '你的原话：',
      evidence,
      '依据：',
      reasons,
      market.priceRange ? `参考价格：${market.priceRange}` : '',
      market.reputation ? `市场口碑：${market.reputation}` : '',
      result.minimumExperiment
        ? `最低成本验证：${result.minimumExperiment.title}——${result.minimumExperiment.action}`
        : '',
      candidates,
      `证据状态：${result.reviewSummary.source_note}`,
      `下一步：${result.nextStep}`
    ].filter(Boolean).join('\n')

    wx.setClipboardData({ data: text })
  },

  copySource(event) {
    const url = event.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
    })
  },

  saveToList() {
    if (this.data.saved) return

    const calmList = wx.getStorageSync('calmList') || []
    wx.setStorageSync('calmList', [
      {
        ...this.data.result,
        status: 'cooling'
      },
      ...calmList
    ])
    this.setData({ saved: true })
    wx.showToast({ title: '已放进冷静记录', icon: 'success' })
  },

  restart() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  openList() {
    wx.switchTab({ url: '/pages/list/list' })
  }
})
