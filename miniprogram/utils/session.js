const DRAFT_KEY = 'calm_buy_draft_v1'

function createId(prefix = 'session') {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

function saveDraft(session) {
  wx.setStorageSync(DRAFT_KEY, {
    ...session,
    updatedAt: Date.now()
  })
}

function loadDraft(productText) {
  const draft = wx.getStorageSync(DRAFT_KEY)
  if (!draft || draft.productText !== productText || draft.completed) return null
  return draft
}

function clearDraft() {
  wx.removeStorageSync(DRAFT_KEY)
}

module.exports = {
  DRAFT_KEY,
  clearDraft,
  createId,
  loadDraft,
  saveDraft
}
