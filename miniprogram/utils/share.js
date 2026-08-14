const SHARE_TITLE = '冷静购｜拆解你的购物需求'
const SHARE_PATH = '/pages/index/index'

function enableShareMenu() {
  wx.showShareMenu({
    withShareTicket: true,
    menus: ['shareAppMessage', 'shareTimeline']
  })
}

function shareAppMessage() {
  return {
    title: SHARE_TITLE,
    path: SHARE_PATH
  }
}

function shareTimeline() {
  return {
    title: SHARE_TITLE
  }
}

module.exports = {
  enableShareMenu,
  shareAppMessage,
  shareTimeline
}
