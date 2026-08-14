const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')
const { syncTabBar } = require('../../utils/tabbar')

Page({
  onShow() {
    syncTabBar(this, 2)
    enableShareMenu()
  },

  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
