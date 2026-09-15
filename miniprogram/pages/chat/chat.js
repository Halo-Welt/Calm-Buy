const { analyzeStep } = require('../../utils/api')
const { track } = require('../../utils/analytics')
const { buildClientFallback } = require('../../utils/fallback')
const { adaptResult } = require('../../utils/resultAdapter')
const { clearDraft, createId, loadDraft, saveDraft } = require('../../utils/session')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')

const SELF_SUPPLEMENT_OPTION = '我想自己补充'
const TRIVIAL_PRODUCT_RE = /泡面|方便面|饮料|矿泉水|袜子|纸巾|牙膏|牙刷|口香糖|辣条|零食|火腿肠|垃圾袋/

function loadingCopy({ productText, questionCount, confirmation }) {
  if (confirmation === true) return '正在查行情、写建议…'
  if ((questionCount || 0) === 0 && !TRIVIAL_PRODUCT_RE.test(productText || '')) {
    const short = String(productText || '这件商品').trim().slice(0, 16)
    return `正在搜索「${short}」…`
  }
  return '正在想下一问…'
}

function formatMessageBlocks(content, role = 'assistant') {
  const text = String(content || '').trim()
  if (!text) return []
  if (role === 'user') return [{ text, kind: 'body' }]

  const paragraphs = text.split(/\n+/).map((part) => part.trim()).filter(Boolean)
  if (paragraphs.length >= 2) {
    return paragraphs.map((part, index) => ({
      text: part,
      kind: index === paragraphs.length - 1 && /[？?]/.test(part) ? 'question' : 'finding'
    }))
  }

  const split = text.match(/^([\s\S]*?[。！!])\s*([^。！!\n]{2,}[？?])$/)
  if (split && split[1].trim().length >= 6) {
    return [
      { text: split[1].trim(), kind: 'finding' },
      { text: split[2].trim(), kind: 'question' }
    ]
  }

  return [{ text, kind: /[？?]/.test(text) ? 'question' : 'body' }]
}

function withBlocks(message) {
  if (!message || typeof message !== 'object') return message
  return {
    ...message,
    images: message.images || [],
    blocks: Array.isArray(message.blocks) && message.blocks.length
      ? message.blocks
      : formatMessageBlocks(message.content, message.role)
  }
}

Page({
  data: {
    sessionId: '',
    startedAt: 0,
    productText: '',
    messages: [],
    inputValue: '',
    phase: 'clarify_need',
    inputType: 'choice',
    options: [],
    showTextInput: false,
    textInputFocus: false,
    questionCount: 0,
    progressTotal: 3,
    progressText: '准备分析',
    progressPercent: 8,
    draft: {},
    impulse: null,
    mode: 'live',
    loading: false,
    loadingText: '正在想下一问…',
    errorMessage: '',
    completed: false
  },

  onLoad() {
    const productText = wx.getStorageSync('currentProduct') || ''
    if (!productText) {
      wx.showToast({ title: '没读到你想买的东西，请重新输入', icon: 'none' })
      wx.switchTab({ url: '/pages/index/index' })
      return
    }

    const saved = loadDraft(productText)
    if (saved) {
      this.setData({
        ...saved,
        messages: (saved.messages || []).map(withBlocks),
        showTextInput: Boolean(saved.showTextInput)
      }, () => {
        const lastMessage = this.data.messages[this.data.messages.length - 1]
        if (!lastMessage || lastMessage.role === 'user') {
          this.requestStep()
        }
      })
      return
    }

    const initialState = {
      sessionId: createId('session'),
      startedAt: Date.now(),
      productText,
      impulse: wx.getStorageSync('calm_buy_current_impulse_v1') || null,
      messages: [withBlocks({ role: 'user', content: `我想买：${productText}`, images: [] })]
    }
    this.setData(initialState, () => {
      track('analysis_started', initialState.sessionId, { mode: 'live' })
      this.requestStep()
    })
  },

  onShow() {
    enableShareMenu()
  },

  onReady() {
    this._pageReady = true
    if (this._pendingResultNavigation) {
      this.navigateToResult()
    }
  },

  onUnload() {
    if (!this.data.completed && this.data.productText) {
      saveDraft(this.serializableState())
    }
  },

  serializableState() {
    const {
      sessionId,
      startedAt,
      productText,
      messages,
      inputValue,
      phase,
      inputType,
      options,
      showTextInput,
      questionCount,
      progressTotal,
      progressText,
      progressPercent,
      draft,
      impulse,
      mode
    } = this.data
    return {
      sessionId,
      startedAt,
      productText,
      messages,
      inputValue,
      phase,
      inputType,
      options,
      showTextInput,
      questionCount,
      progressTotal,
      progressText,
      progressPercent,
      draft,
      impulse,
      mode
    }
  },

  conversationMessages() {
    return this.data.messages.map(({ role, content }) => ({ role, content }))
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value })
  },

  backToOptions() {
    this.setData({ showTextInput: false, textInputFocus: false, inputValue: '' })
  },

  submitText() {
    if (this.data.loading) return
    const value = this.data.inputValue.trim()
    if (!value) {
      wx.showToast({ title: '写一句真实情况就好', icon: 'none' })
      return
    }

    this.appendUserAnswer(value, {
      incrementQuestion: true,
      confirmation: this.data.phase === 'confirm_need' ? false : null
    })
  },

  isSelfSupplement(value) {
    if (!value || typeof value !== 'string') return false
    const normalized = value.trim()
    return normalized === SELF_SUPPLEMENT_OPTION || normalized.includes('自己补充')
  },

  answerOption(event) {
    if (this.data.loading) return
    const index = Number(event.currentTarget.dataset.index)
    const value = Number.isInteger(index)
      ? this.data.options[index]
      : event.currentTarget.dataset.value

    if (this.isSelfSupplement(value)) {
      this.setData({ showTextInput: true, textInputFocus: false }, () => {
        this.setData({ textInputFocus: true })
      })
      return
    }

    if (!value) {
      wx.showToast({ title: '选项读取失败，请重试', icon: 'none' })
      return
    }

    this.appendUserAnswer(value, { incrementQuestion: true })
  },

  appendUserAnswer(content, { incrementQuestion, confirmation = null }) {
    this.setData({
      messages: [...this.data.messages, withBlocks({ role: 'user', content, images: [] })],
      inputValue: '',
      options: [],
      showTextInput: false,
      textInputFocus: false,
      questionCount: incrementQuestion ? this.data.questionCount + 1 : this.data.questionCount
    }, () => this.requestStep({ confirmation }))
  },

  confirmNeed(event) {
    if (this.data.loading) return
    const confirmed = event.currentTarget.dataset.value === 'yes'

    if (!confirmed) {
      this.setData({ showTextInput: true, textInputFocus: false }, () => {
        this.setData({ textInputFocus: true })
      })
      return
    }

    this.setData({
      messages: [...this.data.messages, withBlocks({ role: 'user', content: '对，就是这个', images: [] })],
      options: [],
      showTextInput: false,
      textInputFocus: false
    }, () => this.requestStep({ confirmation: true }))
  },

  retry() {
    if (this.data.loading) return
    this.requestStep()
  },

  continueBasic() {
    const response = buildClientFallback(
      this.data.productText,
      this.conversationMessages(),
      'USER_SELECTED_FALLBACK'
    )
    this.finish(response)
  },

  async requestStep({ confirmation = null } = {}) {
    this.setData({
      loading: true,
      loadingText: loadingCopy({
        productText: this.data.productText,
        questionCount: this.data.questionCount,
        confirmation
      }),
      errorMessage: '',
      showTextInput: false,
      textInputFocus: false
    })

    const payload = {
      requestId: createId('request'),
      sessionId: this.data.sessionId,
      productText: this.data.productText,
      messages: this.conversationMessages(),
      phase: this.data.phase,
      questionCount: this.data.questionCount,
      confirmation,
      draft: this.data.draft,
      impulse: this.data.impulse || undefined
    }

    try {
      const response = await analyzeStep(payload)
      this.applyResponse(response)
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: `${error.message}。你可以重试，或继续基础判断。`
      })
      saveDraft(this.serializableState())
    }
  },

  applyComposerState(response) {
    const options = response.options || []
    const inputType = response.inputType || (options.length ? 'choice' : 'text')
    const showTextInput = inputType === 'text' || !options.length
    return { options, inputType, showTextInput }
  },

  applyResponse(response) {
    if (response.phase === 'done' && response.result) {
      this.finish(response)
      return
    }

    const messages = response.assistantMessage
      ? [...this.data.messages, withBlocks({
        role: 'assistant',
        content: response.assistantMessage,
        images: (response.images || []).slice(0, 2)
      })]
      : this.data.messages
    const progress = response.progress || {}
    const total = Number(progress.total) || this.data.progressTotal
    const current = Math.min(total, Number(progress.current) || this.data.questionCount + 1)
    const composer = this.applyComposerState(response)

    this.setData({
      messages,
      phase: response.phase || 'clarify_need',
      ...composer,
      progressTotal: total,
      progressText: progress.label || `${current} / ${total}`,
      progressPercent: Math.min(100, Math.max(8, Math.round((current / total) * 100))),
      draft: response.draft || this.data.draft,
      mode: response.mode || 'live',
      loading: false,
      errorMessage: ''
    }, () => {
      getApp().globalData.currentSession = this.serializableState()
      saveDraft(this.serializableState())
    })
  },

  finish(response) {
    const result = adaptResult(response.result, {
      mode: response.mode || 'fallback',
      productText: this.data.productText,
      searchUsed: Boolean(response.searchUsed),
      searchProvider: response.searchProvider || '',
      searchSources: response.searchSources || [],
      searchedAt: response.searchedAt || '',
      analysisId: this.data.sessionId
    })
    const elapsed = Math.max(0, Date.now() - (this.data.startedAt || Date.now()))
    const durationBucket = elapsed < 60000 ? 'under_1m' : elapsed < 180000 ? '1_3m' : 'over_3m'
    track('analysis_completed', this.data.sessionId, {
      mode: response.mode || 'fallback',
      verdict: result.verdict,
      confidence: result.confidence,
      needClarity: result.needClarity,
      evidenceQuality: result.evidenceQuality,
      decisionTier: this.data.draft?.decisionTier || 'unknown',
      durationBucket
    })

    getApp().globalData.lastResult = result
    getApp().globalData.currentSession = null
    wx.setStorageSync('lastResult', result)
    clearDraft()
    this.setData({ loading: false, completed: true, phase: 'done' })
    if (this._pageReady) {
      this.navigateToResult()
    } else {
      this._pendingResultNavigation = true
    }
  },

  navigateToResult() {
    this._pendingResultNavigation = false
    setTimeout(() => {
      wx.navigateTo({
        url: '/pages/result/result',
        fail: (error) => {
          this.setData({
            completed: false,
            errorMessage: `结果已生成，但页面打开失败：${error.errMsg || '未知原因'}`
          })
        }
      })
    }, 500)
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.url
    if (!current) return
    const urls = (this.data.messages || [])
      .flatMap((message) => (message.images || []).map((img) => img.url))
      .filter(Boolean)
    wx.previewImage({ current, urls: urls.length ? urls : [current] })
  },

  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline
})
