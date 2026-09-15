const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')
const { syncTabBar } = require('../../utils/tabbar')
const {
  analyticsConsent,
  removeAnonymousData,
  setAnalyticsConsent
} = require('../../utils/analytics')

Page({
  data: {
    analyticsEnabled: false
  },

  onShow() {
    syncTabBar(this, 2)
    enableShareMenu()
    this.setData({ analyticsEnabled: analyticsConsent() === true })
  },

  toggleAnalytics(event) {
    const enabled = Boolean(event.detail.value)
    setAnalyticsConsent(enabled)
    this.setData({ analyticsEnabled: enabled })
  },

  deleteAnalytics() {
    wx.showModal({
      title: '删除匿名改进数据？',
      content: '将使用本机删除凭证移除已上传的匿名事件，并关闭匿名改进。',
      confirmText: '删除',
      confirmColor: '#ff543c',
      success: async ({ confirm }) => {
        if (!confirm) return
        try {
          await removeAnonymousData()
          this.setData({ analyticsEnabled: false })
          wx.showToast({ title: '匿名数据已删除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请稍后重试', icon: 'none' })
        }
      }
    })
  },

  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
