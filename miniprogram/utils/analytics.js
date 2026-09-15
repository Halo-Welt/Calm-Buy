const { deleteAnonymousData, recordAnonymousEvent } = require('./api')

const CONSENT_KEY = 'calm_buy_analytics_consent_v1'
const DELETE_TOKEN_KEY = 'calm_buy_analytics_delete_token_v1'

function randomToken(prefix) {
  const bytes = []
  for (let i = 0; i < 24; i += 1) {
    bytes.push(Math.floor(Math.random() * 256))
  }
  return `${prefix}_${bytes.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function analyticsConsent() {
  return wx.getStorageSync(CONSENT_KEY)
}

function setAnalyticsConsent(value) {
  wx.setStorageSync(CONSENT_KEY, Boolean(value))
}

function deletionToken() {
  let token = wx.getStorageSync(DELETE_TOKEN_KEY)
  if (!token) {
    token = randomToken('delete')
    wx.setStorageSync(DELETE_TOKEN_KEY, token)
  }
  return token
}

function track(name, analysisId, properties = {}) {
  if (analyticsConsent() !== true || !analysisId) return Promise.resolve()
  return recordAnonymousEvent({
    name,
    analysisId,
    deleteToken: deletionToken(),
    properties
  }).catch((error) => {
    console.error('[Calm Buy] 匿名统计失败', error)
  })
}

async function removeAnonymousData() {
  const token = wx.getStorageSync(DELETE_TOKEN_KEY)
  if (token) await deleteAnonymousData(token)
  wx.removeStorageSync(DELETE_TOKEN_KEY)
  setAnalyticsConsent(false)
}

module.exports = {
  analyticsConsent,
  removeAnonymousData,
  setAnalyticsConsent,
  track
}
