const { analyzeStep } = require('../../utils/api')
const { buildClientFallback } = require('../../utils/fallback')
const { adaptResult } = require('../../utils/resultAdapter')
const { clearDraft, createId, loadDraft, saveDraft } = require('../../utils/session')

const SELF_SUPPLEMENT_OPTION = '我想自己补充'

Page({
  data: {
    sessionId: '',
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
      productText,
      impulse: wx.getStorageSync('calm_buy_current_impulse_v1') || null,
      messages: [{ role: 'user', content: `我想买：${productText}` }]
    }
    this.setData(initialState, () => this.requestStep())
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
    return this.data.messages.slice(1).map(({ role, content }) => ({ role, content }))
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

    this.appendUserAnswer(value, { incrementQuestion: true })
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

  appendUserAnswer(content, { incrementQuestion }) {
    this.setData({
      messages: [...this.data.messages, { role: 'user', content }],
      inputValue: '',
      options: [],
      showTextInput: false,
      textInputFocus: false,
      questionCount: incrementQuestion ? this.data.questionCount + 1 : this.data.questionCount
    }, () => this.requestStep())
  },

  confirmNeed(event) {
    if (this.data.loading) return
    const confirmed = event.currentTarget.dataset.value === 'yes'
    const content = confirmed ? '对，就是这个' : '不对，我补充'

    this.setData({
      messages: [...this.data.messages, { role: 'user', content }],
      options: [],
      showTextInput: false,
      textInputFocus: false
    }, () => this.requestStep({ confirmation: confirmed }))
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
    this.setData({ loading: true, errorMessage: '', showTextInput: false, textInputFocus: false })

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
      ? [...this.data.messages, { role: 'assistant', content: response.assistantMessage }]
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
      searchSources: response.searchSources || []
    })

    getApp().globalData.lastResult = result
    getApp().globalData.currentSession = null
    wx.setStorageSync('lastResult', result)
    clearDraft()
    this.setData({ loading: false, completed: true })
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
  }
})
