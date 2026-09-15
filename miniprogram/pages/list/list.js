const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')
const { syncTabBar } = require('../../utils/tabbar')
const { track } = require('../../utils/analytics')
const { dueReviewStage } = require('../../utils/review')

function formatDate(timestamp) {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}.${day}`
}

function choose(items) {
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: items,
      success: ({ tapIndex }) => resolve(tapIndex),
      fail: reject
    })
  })
}

Page({
  data: {
    items: []
  },

  onShow() {
    syncTabBar(this, 1)
    enableShareMenu()
    const items = (wx.getStorageSync('calmList') || []).map((item) => {
      const reviewStage = dueReviewStage(item)
      return {
        ...item,
        reviewStage,
        reviewLabel: reviewStage === '48h' ? '开始48小时复盘' : reviewStage ? `开始${reviewStage}复盘` : '',
        dateLabel: formatDate(item.createdAt),
        statusLabel: item.status === 'abandoned'
          ? '已放弃'
          : item.status === 'still-want'
            ? '冷静后仍想要'
            : reviewStage
              ? '可以复盘了'
              : item.review48h ? '已复盘' : '冷静中'
      }
    })
    this.setData({ items })
  },

  openResult(event) {
    const { id } = event.currentTarget.dataset
    const item = (wx.getStorageSync('calmList') || []).find((entry) => entry.id === id)
    if (!item) {
      wx.showToast({ title: '这条记录找不到了', icon: 'none' })
      return
    }

    getApp().globalData.lastResult = item
    wx.navigateTo({
      url: `/pages/result/result?id=${encodeURIComponent(id)}`,
      fail: (error) => {
        wx.showToast({ title: error.errMsg || '打不开结论页', icon: 'none' })
      }
    })
  },

  updateStatus(event) {
    const { id, status } = event.currentTarget.dataset
    const items = (wx.getStorageSync('calmList') || []).map((item) => (
      item.id === id ? { ...item, status } : item
    ))
    wx.setStorageSync('calmList', items)
    this.onShow()
  },

  async startReview(event) {
    const { id, stage } = event.currentTarget.dataset
    const list = wx.getStorageSync('calmList') || []
    const item = list.find((entry) => entry.id === id)
    if (!item || !stage) return

    try {
      let review
      if (stage === '48h') {
        const stillAgree = ['仍然认可', '部分认可', '不再认可'][await choose(['仍然认可当时建议', '只认可一部分', '不再认可'])]
        const desireChange = ['变弱', '没变化', '变强'][await choose(['购买欲变弱了', '购买欲没变化', '购买欲变强了'])]
        const actionTaken = ['未购买', '先验证', '已购买'][await choose(['还没有买', '做了验证或体验', '已经购买'])]
        const regretExpectation = ['不太会后悔', '说不准', '可能后悔'][await choose(['预计不会后悔', '现在还说不准', '预计可能后悔'])]
        review = { stillAgree, desireChange, actionTaken, regretExpectation, reviewedAt: Date.now() }
      } else {
        const outcome = ['买了且不后悔', '买了但后悔', '没买且认可', '没买仍纠结'][
          await choose(['买了，目前不后悔', '买了，已经后悔', '没买，认可这个决定', '没买，但还在纠结'])
        ]
        review = { outcome, reviewedAt: Date.now() }
      }

      const key = stage === '48h' ? 'review48h' : stage === '7d' ? 'review7d' : 'review30d'
      wx.setStorageSync('calmList', list.map((entry) => (
        entry.id === id ? { ...entry, [key]: review } : entry
      )))
      track('review_completed', item.analysisId || id, {
        reviewStage: stage,
        stillAgree: review.stillAgree || '',
        desireChange: review.desireChange || '',
        actionTaken: review.actionTaken || '',
        regretExpectation: review.regretExpectation || review.outcome || ''
      })
      wx.showToast({ title: '复盘已记录', icon: 'success' })
      this.onShow()
    } catch {
      // 用户取消任一题时不保存半份问卷
    }
  },

  remove(event) {
    const { id } = event.currentTarget.dataset
    const items = (wx.getStorageSync('calmList') || []).filter((item) => item.id !== id)
    wx.setStorageSync('calmList', items)
    this.onShow()
  },

  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
