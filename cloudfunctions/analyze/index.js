const cloud = require('wx-server-sdk')
const crypto = require('node:crypto')
const { analyzeRequestSchema } = require('./src/schema')
const { buildMessages } = require('./src/prompt')
const { callDeepSeek, llmBudget } = require('./src/deepseek')
const { applyPolicy } = require('./src/policy')
const { buildFallbackResponse } = require('./src/fallback')
const { isFinalRound, shouldResearchNow } = require('./src/questions')
const {
  buildAmbiguousResponse,
  buildRestrictedResponse,
  looksAmbiguous,
  restrictedCategory
} = require('./src/safety')
const {
  annotateSearchMeta,
  emptySearchEvidence,
  isDoubaoConfigured,
  isSearchConfigured,
  isTavilyConfigured,
  researchProduct
} = require('./src/search')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const command = db.command
const USAGE_COLLECTION = 'calm_buy_usage'
const TELEMETRY_COLLECTION = 'calm_buy_telemetry'
const REMINDER_COLLECTION = 'calm_buy_reminders'
const TELEMETRY_EVENTS = new Set([
  'analysis_started',
  'analysis_completed',
  'cooldown_added',
  'review_completed'
])

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

function minuteKey(date = new Date()) {
  return date.toISOString().slice(0, 16).replaceAll(/[-:T]/g, '')
}

async function incrementUsage(transaction, id, limit, metadata) {
  const reference = transaction.collection(USAGE_COLLECTION).doc(id)
  let current
  try {
    current = await reference.get()
  } catch (error) {
    if (!String(error.errMsg || error.message).includes('does not exist')) throw error
  }

  const count = current?.data?.count || 0
  if (count >= limit) {
    const error = new Error('调用额度已用完，请稍后再试')
    error.code = 'RATE_LIMITED'
    throw error
  }

  if (current?.data) {
    await reference.update({
      data: {
        count: command.inc(1),
        updatedAt: db.serverDate()
      }
    })
  } else {
    await reference.set({
      data: {
        count: 1,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
        ...metadata
      }
    })
  }
}

async function consumeQuota(openId) {
  const now = new Date()
  const perMinute = numberFromEnv('USER_MINUTE_REQUEST_LIMIT', 12)
  const perDay = numberFromEnv('USER_DAILY_REQUEST_LIMIT', 60)
  const globalPerDay = numberFromEnv('GLOBAL_DAILY_REQUEST_LIMIT', 1000)

  const salt = process.env.RATE_LIMIT_SALT || 'calm-buy-rate-limit'
  const dailyUser = crypto
    .createHash('sha256')
    .update(`${salt}:${dateKey(now)}:${openId}`)
    .digest('hex')

  await db.runTransaction(async (transaction) => {
    const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    await incrementUsage(
      transaction,
      `minute_${dailyUser}_${minuteKey(now)}`,
      perMinute,
      { scope: 'user_minute', bucket: minuteKey(now), expiresAt }
    )
    await incrementUsage(
      transaction,
      `day_${dailyUser}_${dateKey(now)}`,
      perDay,
      { scope: 'user_day', bucket: dateKey(now), expiresAt }
    )
    await incrementUsage(
      transaction,
      `global_${dateKey(now)}`,
      globalPerDay,
      { scope: 'global_day', bucket: dateKey(now), expiresAt }
    )
  })
}

function telemetryHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function cleanTelemetryProperties(properties = {}) {
  const allowedKeys = new Set([
    'mode', 'verdict', 'confidence', 'needClarity', 'evidenceQuality',
    'decisionTier', 'durationBucket', 'reminderEnabled', 'reviewStage',
    'stillAgree', 'desireChange', 'actionTaken', 'regretExpectation'
  ])
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key, value]) => allowedKeys.has(key) && ['string', 'boolean', 'number'].includes(typeof value))
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 40) : value])
  )
}

async function recordTelemetry(event) {
  if (!TELEMETRY_EVENTS.has(event?.name)) {
    return { ok: false, error: { code: 'INVALID_EVENT', message: '匿名事件不受支持' } }
  }
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(String(event.analysisId || ''))
    || !/^[a-zA-Z0-9_-]{20,200}$/.test(String(event.deleteToken || ''))) {
    return { ok: false, error: { code: 'INVALID_EVENT', message: '匿名事件字段无效' } }
  }
  await db.collection(TELEMETRY_COLLECTION).add({
    data: {
      deletionHash: telemetryHash(event.deleteToken),
      analysisId: String(event.analysisId),
      name: event.name,
      properties: cleanTelemetryProperties(event.properties),
      createdAt: db.serverDate()
    }
  })
  return { ok: true, data: { recorded: true } }
}

async function deleteTelemetry(deleteToken) {
  if (!/^[a-zA-Z0-9_-]{20,200}$/.test(String(deleteToken || ''))) {
    return { ok: false, error: { code: 'INVALID_DELETE_TOKEN', message: '删除凭证无效' } }
  }
  const deletionHash = telemetryHash(deleteToken)
  let deleted = 0
  for (let batch = 0; batch < 100; batch += 1) {
    const result = await db.collection(TELEMETRY_COLLECTION)
      .where({ deletionHash })
      .remove()
    const removed = result.stats?.removed || 0
    deleted += removed
    if (!removed) break
  }
  return { ok: true, data: { deleted } }
}

async function scheduleReminder(reminder, openId) {
  if (!process.env.REMINDER_TEMPLATE_ID) {
    return { ok: false, error: { code: 'REMINDER_NOT_CONFIGURED', message: '提醒模板未配置' } }
  }
  const hours = Math.min(168, Math.max(1, Number(reminder?.cooldownHours) || 48))
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(reminder?.analysisId || ''))) {
    return { ok: false, error: { code: 'INVALID_REMINDER', message: '提醒字段无效' } }
  }
  await db.collection(REMINDER_COLLECTION).add({
    data: {
      openId,
      analysisId: String(reminder.analysisId),
      dueAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + (hours + 24) * 60 * 60 * 1000),
      status: 'pending',
      createdAt: db.serverDate()
    }
  })
  return { ok: true, data: { scheduled: true } }
}

async function claimReminder(id) {
  try {
    return await db.runTransaction(async (transaction) => {
      const reference = transaction.collection(REMINDER_COLLECTION).doc(id)
      const current = await reference.get()
      if (current.data?.status !== 'pending') return false
      await reference.update({ data: { status: 'processing' } })
      return true
    })
  } catch {
    return false
  }
}

async function sendDueReminders() {
  const templateId = process.env.REMINDER_TEMPLATE_ID
  if (!templateId) return { ok: false, error: { code: 'REMINDER_NOT_CONFIGURED', message: '提醒模板未配置' } }

  const due = await db.collection(REMINDER_COLLECTION)
    .where({ dueAt: command.lte(new Date()), status: 'pending' })
    .limit(10)
    .get()

  let sent = 0
  for (const item of due.data || []) {
    if (!await claimReminder(item._id)) continue
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: item.openId,
        page: 'pages/list/list',
        lang: 'zh_CN',
        templateId,
        miniprogramState: process.env.MINIPROGRAM_STATE || 'formal',
        data: {
          [process.env.REMINDER_THING_KEY || 'thing1']: { value: '你的冷静记录可以复盘了' },
          [process.env.REMINDER_TIME_KEY || 'time2']: { value: new Date().toISOString().slice(0, 16).replace('T', ' ') }
        }
      })
      sent += 1
    } catch (error) {
      console.error(JSON.stringify({ reminderError: error.errCode || error.message, reminderId: item._id }))
    } finally {
      await db.collection(REMINDER_COLLECTION).doc(item._id).remove()
    }
  }
  return { ok: true, data: { sent } }
}

/**
 * 非 trivial 商品首轮先搜再问；中间澄清轮不搜；最终轮再搜一次。
 * 云函数实例不跨轮复用，不能靠内存预取。
 */
async function attachSearchEvidence(requestData) {
  if (!isSearchConfigured() || !shouldResearchNow(requestData)) {
    return { ...requestData, searchEvidence: emptySearchEvidence() }
  }

  try {
    return {
      ...requestData,
      searchEvidence: await researchProduct(requestData.productText, requestData.draft, {
        round: isFinalRound(requestData) ? 'final' : 'first'
      })
    }
  } catch (error) {
    console.error(JSON.stringify({
      requestId: requestData.requestId,
      searchError: error.code || error.message || 'SEARCH_FAILED'
    }))
    return { ...requestData, searchEvidence: emptySearchEvidence(error.code || 'SEARCH_FAILED') }
  }
}

async function analyze(requestData) {
  const safetyText = [
    requestData.productText,
    ...(requestData.messages || []).filter((item) => item.role === 'user').map((item) => item.content)
  ].join('\n')
  const restricted = restrictedCategory(safetyText)
  if (restricted) return buildRestrictedResponse(requestData, restricted)
  if ((requestData.questionCount || 0) === 0 && looksAmbiguous(requestData.productText)) {
    return buildAmbiguousResponse(requestData)
  }

  const startedAt = Date.now()
  const deadlineMs = isFinalRound(requestData) ? 19000 : 9500
  const enriched = await attachSearchEvidence(requestData)
  const messages = buildMessages(enriched)
  const budget = llmBudget(isFinalRound(requestData))
  let output = await callDeepSeek(messages, budget)

  try {
    return annotateSearchMeta(applyPolicy(output, enriched), enriched.searchEvidence)
  } catch (validationError) {
    const remainingMs = deadlineMs - (Date.now() - startedAt)
    if (remainingMs < 2000) throw validationError
    output = await callDeepSeek([
      ...messages,
      {
        role: 'system',
        content: `上一份输出未通过结构校验，问题是：${validationError.message}。请严格按约定字段重新输出完整合法 json，不要省略字段，不要改字段名。`
      }
    ], { ...budget, timeoutMs: Math.min(budget.timeoutMs, remainingMs) })
    return annotateSearchMeta(applyPolicy(output, enriched), enriched.searchEvidence)
  }
}

exports.main = async (event) => {
  const startedAt = Date.now()
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID

  if (wxContext.SOURCE === 'wx_trigger') {
    return sendDueReminders()
  }

  if (event?.action === 'health') {
    return {
      ok: true,
      data: {
        deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        searchEnabled: isSearchConfigured(),
        doubaoConfigured: isDoubaoConfigured(),
        tavilyConfigured: isTavilyConfigured()
      }
    }
  }

  if (event?.action === 'telemetry') {
    return recordTelemetry(event.event)
  }

  if (event?.action === 'deleteTelemetry') {
    return deleteTelemetry(event.deleteToken)
  }

  if (event?.action === 'scheduleReminder') {
    return scheduleReminder(event.reminder, openId)
  }

  const parsed = analyzeRequestSchema.safeParse(event?.payload)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: '请求字段不符合约定'
      }
    }
  }

  try {
    await consumeQuota(openId)
  } catch (error) {
    console.error(JSON.stringify({
      requestId: parsed.data.requestId,
      phase: parsed.data.phase,
      errorCode: error.code || 'RATE_LIMIT_STORAGE_ERROR',
      durationMs: Date.now() - startedAt
    }))
    return {
      ok: false,
      error: {
        code: error.code || 'RATE_LIMIT_STORAGE_ERROR',
        message: error.code === 'RATE_LIMITED'
          ? error.message
          : '调用保护暂时不可用，请稍后再试'
      }
    }
  }

  try {
    const result = await analyze(parsed.data)
    console.info(JSON.stringify({
      requestId: parsed.data.requestId,
      phase: parsed.data.phase,
      mode: 'live',
      searchUsed: Boolean(result.searchUsed),
      searchProvider: result.searchProvider || null,
      durationMs: Date.now() - startedAt
    }))
    return { ok: true, data: { ...result, mode: 'live', error: null } }
  } catch (error) {
    const errorCode = error.code || 'ANALYSIS_FAILED'
    console.error(JSON.stringify({
      requestId: parsed.data.requestId,
      phase: parsed.data.phase,
      mode: 'fallback',
      errorCode,
      // 云函数只能靠日志排查，光有 code 定位不到任何东西
      reason: error.message,
      durationMs: Date.now() - startedAt
    }))
    return {
      ok: true,
      data: buildFallbackResponse(parsed.data, errorCode)
    }
  }
}
