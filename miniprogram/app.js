const { CLOUD_ENV_ID } = require('./config')

App({
  globalData: {
    currentSession: null,
    lastResult: null,
    tabBarSelected: 0
  },

  onLaunch() {
    if (wx.cloud) {
      // 不传 env 时微信会用小程序绑定的默认环境，比填一个可能过期的 ID 更不容易出错
      wx.cloud.init(CLOUD_ENV_ID ? { env: CLOUD_ENV_ID, traceUser: false } : { traceUser: false })
    }
    if (!wx.getStorageSync('calmList')) {
      wx.setStorageSync('calmList', [])
    }
  }
})
