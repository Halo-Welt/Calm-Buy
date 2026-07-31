const { NEED_IDS, analyzeResponseSchema } = require('./schema')
const {
  isFinalRound,
  pickFollowUp,
  resolvePlan,
  resolveTier,
  withSelfSupplement
} = require('./questions')

/** 只有在“更贵、更长期、更难退”的决策上，才对非功能性动机保持警惕 */
const CAUTIOUS_NEEDS = new Set(['anxiety', 'identity', 'belong'])

/**
 * 行为信号显示正在冲动时，本来就要缓一缓的结论至少留足这么久。
 * 只作用于非 buy 的结论：既然判断是“可以买”，再强塞冷静期只会自相矛盾。
 */
function impulseCooldownFloor(temperature) {
  if (temperature >= 85) return 72
  if (temperature >= 70) return 48
  return 0
}

function countUserAnswers(request) {
  return (request.messages || []).filter((message) => message.role === 'user').length
}

function looksLikeQuestion(text) {
  if (!text || typeof text !== 'string') return false
  return /[？?]/.test(text) || /吗$|呢$|么$|嘛$/.test(text.trim())
}

function readTier(response, request) {
  return resolveTier(response?.draft?.decisionTier || request?.draft?.decisionTier)
}

function readTemperature(request) {
  return Number(request?.impulse?.temperature) || 0
}

function planFor(response, request) {
  return resolvePlan(readTier(response, request), readTemperature(request))
}

function buildConfirmMessage(draft, productText) {
  const rootNeed = draft?.rootNeed?.trim().replace(/[。.！!？?；;，,\s]+$/, '')
  if (rootNeed) {
    return `我理解你真正想要的是：${rootNeed}。对吗？`
  }
  return `所以你真正要解决的，是“${productText}”能帮你搞定的那件具体的事，对吗？`
}

/** 模型偶尔会把 readiness 写成十分制或百分制，按量纲折回 0–1 而不是直接丢弃整份输出 */
function normalizeReadiness(value) {
  const readiness = Number(value)
  if (!Number.isFinite(readiness) || readiness <= 0) return 0
  if (readiness <= 1) return readiness
  if (readiness <= 10) return readiness / 10
  return Math.min(1, readiness / 100)
}

/** 模型经常多给一两条，截断比整份作废好 */
function clampArray(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : value
}

/** 容错模型把 title 写成 name、漏掉 servesNeedId 的情况 */
function normalizeItemList(list, fallbackNeedId, max) {
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      ...item,
      title: typeof item.title === 'string' && item.title.trim()
        ? item.title
        : String(item.name || item.productName || '').trim(),
      servesNeedId: NEED_IDS.includes(item.servesNeedId) ? item.servesNeedId : fallbackNeedId
    }))
    .filter((item) => item.title)
    .slice(0, max)
}

function sanitizeModelOutput(modelOutput) {
  const raw = modelOutput && typeof modelOutput === 'object' ? modelOutput : {}
  const draft = raw.draft && typeof raw.draft === 'object' ? raw.draft : {}
  const phase = ['clarify_need', 'confirm_need', 'done'].includes(raw.phase)
    ? raw.phase
    : 'clarify_need'
  const rawResult = phase === 'done' && raw.result && typeof raw.result === 'object' ? raw.result : null
  const fallbackNeedId = NEED_IDS.includes(rawResult?.primaryNeedId) ? rawResult.primaryNeedId : 'utility'

  return {
    assistantMessage: typeof raw.assistantMessage === 'string' && raw.assistantMessage.trim()
      ? raw.assistantMessage.trim()
      : '再说具体一点。',
    phase,
    inputType: ['text', 'choice', 'none'].includes(raw.inputType) ? raw.inputType : 'choice',
    options: Array.isArray(raw.options)
      ? raw.options.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5)
      : [],
    progress: raw.progress && typeof raw.progress === 'object'
      ? {
        current: Number(raw.progress.current) || 1,
        total: Number(raw.progress.total) || 3,
        label: typeof raw.progress.label === 'string' ? raw.progress.label : '继续拆解'
      }
      : { current: 1, total: 3, label: '继续拆解' },
    draft: {
      ...draft,
      readiness: normalizeReadiness(draft.readiness),
      constraints: clampArray(draft.constraints, 5),
      failureConditions: clampArray(draft.failureConditions, 5),
      evidenceQuotes: clampArray(draft.evidenceQuotes, 6),
      missingDimensions: clampArray(draft.missingDimensions, 6)
    },
    result: rawResult && {
      ...rawResult,
      reasons: clampArray(rawResult.reasons, 3),
      evidenceQuotes: clampArray(rawResult.evidenceQuotes, 6),
      marketSnapshot: rawResult.marketSnapshot && {
        ...rawResult.marketSnapshot,
        watchOuts: clampArray(rawResult.marketSnapshot.watchOuts, 3)
      },
      needDecomposition: rawResult.needDecomposition && {
        ...rawResult.needDecomposition,
        constraints: clampArray(rawResult.needDecomposition.constraints, 5)
      },
      alternatives: normalizeItemList(rawResult.alternatives, fallbackNeedId, 4),
      candidateProducts: normalizeItemList(rawResult.candidateProducts, fallbackNeedId, 3)
    }
  }
}

function forceClarify(response, request, reasonLabel) {
  const tier = readTier(response, request)
  const plan = planFor(response, request)
  const followUp = pickFollowUp(request.questionCount || 0, tier)
  const keepModelQuestion = looksLikeQuestion(response.assistantMessage)
    && response.phase !== 'done'
  const sourceOptions = keepModelQuestion && response.options?.length
    ? response.options
    : followUp.options

  response.phase = 'clarify_need'
  response.result = null
  response.inputType = 'choice'
  response.options = withSelfSupplement(sourceOptions)
  response.assistantMessage = keepModelQuestion
    ? response.assistantMessage
    : followUp.message
  response.progress = {
    current: Math.min(plan.maxQuestions, Math.max(1, (request.questionCount || 0) + 1)),
    total: plan.maxQuestions,
    label: reasonLabel || followUp.label
  }
  response.draft = {
    ...response.draft,
    decisionTier: tier,
    readiness: Math.min(Number(response.draft?.readiness) || 0, 0.6),
    userConfirmedNeed: false
  }
  return response
}

function forceConfirm(response, request) {
  const tier = readTier(response, request)
  const plan = planFor(response, request)

  response.phase = 'confirm_need'
  response.result = null
  response.inputType = 'choice'
  response.options = ['对，就是这个', '不对，我补充']
  response.assistantMessage = buildConfirmMessage(response.draft, request.productText)
  response.progress = {
    current: Math.min(plan.maxQuestions, Math.max(plan.minQuestionsBeforeConfirm, request.questionCount || 0)),
    total: plan.maxQuestions,
    label: '确认根本需求'
  }
  response.draft = {
    ...response.draft,
    decisionTier: tier,
    userConfirmedNeed: false
  }
  return response
}

function canEnterConfirm(response, request) {
  const plan = planFor(response, request)
  const questionCount = request.questionCount || 0
  const readiness = Number(response.draft?.readiness) || 0
  const evidenceCount = Array.isArray(response.draft?.evidenceQuotes)
    ? response.draft.evidenceQuotes.filter(Boolean).length
    : 0
  const answeredEnough = questionCount >= plan.minQuestionsBeforeConfirm
    || countUserAnswers(request) >= plan.minQuestionsBeforeConfirm

  return answeredEnough
    && readiness >= plan.readinessThreshold
    && evidenceCount >= plan.minEvidence
}

function enforcePhase(response, request) {
  const tier = readTier(response, request)
  const plan = planFor(response, request)
  const questionCount = request.questionCount || 0
  const reachedLimit = questionCount >= plan.maxQuestions

  if (isFinalRound(request)) {
    if (response.phase !== 'done' || !response.result) {
      throw new Error('本轮应给出最终建议，但模型未返回完整结果')
    }
    response.draft.userConfirmedNeed = true
    response.draft.decisionTier = tier
    return response
  }

  if (request.confirmation === false) {
    if (reachedLimit) {
      return forceConfirm(response, request)
    }
    return forceClarify(response, request, '纠偏追问')
  }

  if (reachedLimit) {
    return forceConfirm(response, request)
  }

  if (response.phase === 'done') {
    if (canEnterConfirm(response, request)) {
      return forceConfirm(response, request)
    }
    return forceClarify(response, request, '还差一点，继续问')
  }

  if (response.phase === 'confirm_need') {
    if (canEnterConfirm(response, request)) {
      return forceConfirm(response, request)
    }
    return forceClarify(response, request, '还没拆清，继续问')
  }

  if (!looksLikeQuestion(response.assistantMessage)) {
    return forceClarify(response, request, '继续追问')
  }

  response.phase = 'clarify_need'
  response.result = null
  response.inputType = 'choice'
  response.options = withSelfSupplement(
    response.options?.length ? response.options : pickFollowUp(questionCount, tier).options
  )
  response.draft = { ...response.draft, decisionTier: tier }
  return response
}

function applyResultGuards(response, request = {}) {
  const result = response.result
  if (!result) {
    throw new Error('done 阶段缺少 result')
  }

  const tier = readTier(response, request)
  const hasSearch = Boolean(request.searchEvidence?.enabled && request.searchEvidence?.items?.length)

  if (!hasSearch && result.confidence === 'high') {
    result.confidence = 'medium'
  }

  // 大额决策里，焦虑/身份/从众驱动的“买”先降级为验证；小额决策不做这种家长式干预。
  if (tier === 'major' && CAUTIOUS_NEEDS.has(result.primaryNeedId) && result.verdict === 'buy') {
    result.verdict = 'wait'
    result.reasons = [
      ...result.reasons.slice(0, 2),
      '这笔支出不小，而驱动力更偏焦虑或身份认同，建议先验证真实使用频率。'
    ].slice(0, 3)
  }

  result.alternatives = result.alternatives.slice(0, 2).map((item) => ({
    ...item,
    type: ['non_purchase', 'rent_or_try', 'product'].includes(item.type)
      ? item.type
      : 'non_purchase'
  }))

  if (!hasSearch) {
    result.marketSnapshot = {
      ...result.marketSnapshot,
      priceRange: null
    }
  }

  result.candidateProducts = result.confidence === 'low'
    ? []
    : result.candidateProducts.slice(0, 2).map((item) => {
      const url = hasSearch && typeof item.url === 'string' && /^https?:\/\//.test(item.url)
        ? item.url
        : null
      const price = hasSearch && typeof item.price === 'string' && item.price.trim()
        ? item.price.trim().slice(0, 40)
        : null
      return {
        ...item,
        verificationStatus: hasSearch ? '联网搜索摘要，请自行核对' : '模型常识，未联网核验',
        price,
        url
      }
    })

  if (result.verdict !== 'buy') {
    result.cooldownHours = Math.max(
      result.cooldownHours,
      impulseCooldownFloor(readTemperature(request))
    )
  }

  response.inputType = 'none'
  response.options = []
  return response
}

function applyPolicy(modelOutput, request) {
  let response = analyzeResponseSchema.parse(sanitizeModelOutput(modelOutput))
  response = enforcePhase(response, request)

  const plan = planFor(response, request)
  const progressCurrent = response.phase === 'done'
    ? plan.maxQuestions
    : Math.min(
      plan.maxQuestions,
      Math.max(1, (request.questionCount || 0) + (response.phase === 'clarify_need' ? 1 : 0))
    )

  response.progress = {
    ...response.progress,
    current: progressCurrent,
    total: plan.maxQuestions
  }

  if (request.confirmation === true) {
    response.draft.userConfirmedNeed = true
  }

  if (response.phase !== 'done') {
    response.result = null
    if (response.phase === 'clarify_need') {
      response.inputType = 'choice'
      response.options = withSelfSupplement(response.options)
    }
    return analyzeResponseSchema.parse(response)
  }

  response = applyResultGuards(response, request)
  return analyzeResponseSchema.parse(response)
}

module.exports = {
  applyPolicy,
  isFinalRound,
  pickFollowUp,
  resolvePlan
}
