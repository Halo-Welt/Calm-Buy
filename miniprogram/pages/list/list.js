const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')
const { syncTabBar } = require('../../utils/tabbar')

function formatDate(timestamp) {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}.${day}`
}

Page({
  data: {
    items: []
  },

  onShow() {
    syncTabBar(this, 1)
    enableShareMenu()
    const items = (wx.getStorageSync('calmList') || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.createdAt),
      statusLabel: item.status === 'abandoned' ? '已放弃' : item.status === 'still-want' ? '冷静后仍想要' : '冷静中'
    }))
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

  remove(event) {
    const { id } = event.currentTarget.dataset
    const items = (wx.getStorageSync('calmList') || []).filter((item) => item.id !== id)
    wx.setStorageSync('calmList', items)
    this.onShow()
  },

  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
