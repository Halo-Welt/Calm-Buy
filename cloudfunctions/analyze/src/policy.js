const { NEED_IDS, analyzeResponseSchema } = require('./schema')
const {
  anchoredTier,
  isFinalRound,
  needDiscoveryComplete,
  pickFollowUp,
  pickNeedFollowUp,
  resolvePlan,
  resolveTier,
  withSelfSupplement
} = require('./questions')
const { platformFromUrl } = require('./search')

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

function looksLikeNeedQuestion(text) {
  if (!looksLikeQuestion(text)) return false
  return !/想买|就是买|购买目标|下手吗|要下单吗|哪一款|什么颜色|什么型号/.test(text)
}

/** 量级一旦落进 draft 就锁定；首轮还没锁定时，检索到的真实报价优先于模型的猜测 */
function readTier(response, request) {
  if (request?.draft?.decisionTier) return resolveTier(request.draft.decisionTier)
  return anchoredTier(response?.draft?.decisionTier, request?.searchEvidence)
}

function readTemperature(request) {
  return Number(request?.impulse?.temperature) || 0
}

function planFor(response, request) {
  return resolvePlan(readTier(response, request), readTemperature(request))
}

function buildConfirmMessage(draft, productText) {
  const rootNeed = draft?.rootNeed?.trim().replace(/[。.！!？?；;，,\s]+$/, '')
  if (rootNeed && !/想买|购买|入手/.test(rootNeed)) {
    return `你真正想要的是\n${rootNeed}。对吗？`
  }
  return `你真正要解决的，不是拥有“${productText}”。对吗？`
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

/**
 * 模型只回传本轮变化的字段，服务端把它合进上一轮的草稿。
 * 空值不覆盖已有值：模型偶尔会把已确认的字段写成空串或空数组，
 * 那不代表用户改主意了，只代表它这一轮没提。
 */
function mergeDraft(previous = {}, incoming = {}) {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && !value.length) continue
    merged[key] = value
  }
  return merged
}

function normalizeIncomingDraft(incoming) {
  const normalized = {
    ...incoming,
    constraints: clampArray(incoming.constraints, 5),
    failureConditions: clampArray(incoming.failureConditions, 5),
    evidenceQuotes: clampArray(incoming.evidenceQuotes, 6),
    missingDimensions: clampArray(incoming.missingDimensions, 6),
    keyDimensions: clampArray(incoming.keyDimensions, 4),
    askedDimensions: clampArray(incoming.askedDimensions, 6)
  }
  if (incoming.readiness !== undefined) {
    normalized.readiness = normalizeReadiness(incoming.readiness)
  }
  return normalized
}

function sanitizeModelOutput(modelOutput, request = {}) {
  const raw = modelOutput && typeof modelOutput === 'object' ? modelOutput : {}
  const patch = raw.draftPatch && typeof raw.draftPatch === 'object' ? raw.draftPatch : {}
  const full = raw.draft && typeof raw.draft === 'object' ? raw.draft : {}
  const draft = mergeDraft(request.draft || {}, normalizeIncomingDraft({ ...patch, ...full }))
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
    draft,
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
  const followUp = pickNeedFollowUp(
    response.draft,
    request.productText,
    request.questionCount || 0,
    tier
  )
  const keepModelQuestion = looksLikeNeedQuestion(response.assistantMessage)
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
    && needDiscoveryComplete(response.draft, request.productText, readTier(response, request))
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

  if (!looksLikeNeedQuestion(response.assistantMessage)) {
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

function normalizeCandidate(item, hasSearch) {
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
}

function asSearchCandidate(item, needId) {
  return {
    title: String(item.title || '检索结果').slice(0, 100),
    why: String(item.content || '来自联网检索，下单前请核对店铺与价格').slice(0, 300),
    servesNeedId: NEED_IDS.includes(needId) ? needId : 'utility',
    verificationStatus: '联网搜索摘要，请自行核对',
    price: null,
    url: item.url
  }
}

function fillCandidates(candidates, searchEvidence, needId, hasSearch) {
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .slice(0, 3)
    .map((item) => normalizeCandidate(item, hasSearch))

  if (!hasSearch) return normalized.slice(0, 3)

  const items = (searchEvidence?.items || []).filter((item) => item?.url)
  const used = new Set(normalized.map((item) => item.url).filter(Boolean))

  const patched = normalized.map((item) => {
    if (item.url) return item
    const hit = items.find((entry) => !used.has(entry.url) && (
      platformFromUrl(entry.url)
      || (item.title && entry.title && entry.title.includes(item.title.slice(0, 8)))
    ))
    if (!hit) return item
    used.add(hit.url)
    return { ...item, url: hit.url, verificationStatus: '联网搜索摘要，请自行核对' }
  })

  const leftover = items.filter((item) => !used.has(item.url))
  const preferred = leftover.filter((item) => item.sourceKind === 'shop' || platformFromUrl(item.url))
  const extras = (preferred.length ? preferred : leftover)
    .slice(0, Math.max(0, 3 - patched.length))
    .map((item) => asSearchCandidate(item, needId))

  return [...patched, ...extras].slice(0, 3)
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

  // 模型漏读价格时，用服务端从检索结果抽出的锚点补上，不必因此整份降级
  const anchorText = request.searchEvidence?.priceAnchor?.text
  if (hasSearch && anchorText && !String(result.marketSnapshot?.priceRange || '').trim()) {
    result.marketSnapshot = {
      ...result.marketSnapshot,
      priceRange: anchorText
    }
  }

  result.candidateProducts = fillCandidates(
    result.confidence === 'low' ? [] : result.candidateProducts,
    request.searchEvidence,
    result.primaryNeedId || 'utility',
    hasSearch
  )

  if (!String(result.needDecomposition?.functional || '').trim()) {
    result.needDecomposition = {
      ...result.needDecomposition,
      functional: String(result.rootNeed || result.needSentence || '').slice(0, 500)
    }
  }

  if (!Array.isArray(result.reasons) || result.reasons.length < 2) {
    const extra = []
    if (result.marketSnapshot?.priceRange) extra.push(`参考价大约 ${result.marketSnapshot.priceRange}。`)
    if (result.marketSnapshot?.reputation) extra.push(result.marketSnapshot.reputation.slice(0, 80))
    result.reasons = [...(result.reasons || []), ...extra].filter(Boolean).slice(0, 3)
  }

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
  let response = analyzeResponseSchema.parse(sanitizeModelOutput(modelOutput, request))
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
