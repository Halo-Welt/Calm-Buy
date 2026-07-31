const { isFinalRound, pickFollowUp, planForRequest, resolveTier } = require('./questions')

function emptyDraft(request, overrides = {}) {
  return {
    productName: request.productText,
    decisionTier: resolveTier(request.draft?.decisionTier),
    tierReason: '',
    desiredOutcome: '',
    scene: '',
    frequency: '',
    currentAlternative: '',
    gap: '',
    counterfactual: '',
    constraints: [],
    failureConditions: [],
    successCriterion: '',
    functionalNeed: '',
    emotionalNeed: '',
    socialNeed: '',
    rootNeed: '',
    primaryNeedId: null,
    secondaryNeedId: null,
    evidenceQuotes: [],
    missingDimensions: ['真实场景', '使用频率', '当前替代方案'],
    readiness: 0.2,
    userConfirmedNeed: false,
    ...overrides
  }
}

function shouldKeepAsking(request) {
  if (isFinalRound(request)) return false
  const plan = planForRequest(request)
  return (request.questionCount || 0) < plan.maxQuestions
}

function buildClarifyFallback(request, errorCode) {
  const tier = resolveTier(request.draft?.decisionTier)
  const plan = planForRequest(request)
  const followUp = pickFollowUp(request.questionCount || 0, tier)
  const current = Math.min(plan.maxQuestions, Math.max(1, (request.questionCount || 0) + 1))

  return {
    assistantMessage: followUp.message,
    phase: 'clarify_need',
    inputType: followUp.options.length ? 'choice' : 'text',
    options: followUp.options,
    progress: {
      current,
      total: plan.maxQuestions,
      label: followUp.label
    },
    draft: emptyDraft(request, { readiness: Math.min(0.4, 0.1 * current) }),
    result: null,
    mode: 'fallback',
    error: { code: errorCode }
  }
}

function buildDoneFallback(request, errorCode = 'ANALYSIS_UNAVAILABLE') {
  const plan = planForRequest(request)
  const lastUserMessage = [...request.messages]
    .reverse()
    .find((message) => message.role === 'user')?.content
  const evidenceQuotes = [
    `我想买：${request.productText}`,
    lastUserMessage || '现在还没有补充具体使用场景'
  ]

  return {
    assistantMessage: '智能分析暂时不可用。先别替模型猜：把它冷却 48 小时，再记录一次真实需要它的场景。',
    phase: 'done',
    inputType: 'none',
    options: [],
    progress: { current: plan.maxQuestions, total: plan.maxQuestions, label: '基础判断' },
    draft: emptyDraft(request, {
      rootNeed: '目前信息不足，先验证真实使用需求',
      primaryNeedId: 'novelty',
      evidenceQuotes,
      missingDimensions: ['真实场景', '使用频率', '当前替代方案', '成功标准']
    }),
    result: {
      verdict: 'wait',
      confidence: 'low',
      needSentence: '先确认它是否解决一个会重复出现的真实问题',
      primaryNeedId: 'novelty',
      matchScore: 'low',
      rootNeed: '目前信息不足，先验证真实使用需求',
      needDecomposition: {
        functional: '',
        emotional: '',
        social: '',
        constraints: [],
        successCriterion: ''
      },
      evidenceQuotes,
      reasons: ['智能分析当前不可用，不能可靠判断。', '缺少真实场景、频率和替代方案信息。'],
      marketSnapshot: { priceRange: null, reputation: '', watchOuts: [] },
      minimumExperiment: {
        title: '记录一次真实需求',
        action: '未来 48 小时内，只有当具体场景再次出现时才记录；不要继续刷评测或价格。',
        duration: '48 小时'
      },
      alternatives: [],
      candidateProducts: [],
      nextStep: '48 小时后带着真实场景重新分析。',
      cooldownHours: 48
    },
    mode: 'fallback',
    error: { code: errorCode }
  }
}

function buildFallbackResponse(request, errorCode = 'ANALYSIS_UNAVAILABLE') {
  if (shouldKeepAsking(request)) {
    return buildClarifyFallback(request, errorCode)
  }
  return buildDoneFallback(request, errorCode)
}

module.exports = { buildFallbackResponse }
