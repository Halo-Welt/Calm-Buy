const cloud = require('wx-server-sdk')
const { analyzeRequestSchema } = require('./src/schema')
const { buildMessages } = require('./src/prompt')
const { callDeepSeek } = require('./src/deepseek')
const { applyPolicy } = require('./src/policy')
const { buildFallbackResponse } = require('./src/fallback')
const { isFinalRound } = require('./src/questions')
const {
  annotateSearchMeta,
  emptySearchEvidence,
  isSearchConfigured,
  researchProduct
} = require('./src/search')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const command = db.command
const USAGE_COLLECTION = 'calm_buy_usage'

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

  await db.runTransaction(async (transaction) => {
    await incrementUsage(
      transaction,
      `minute_${openId}_${minuteKey(now)}`,
      perMinute,
      { scope: 'user_minute', openId, bucket: minuteKey(now) }
    )
    await incrementUsage(
      transaction,
      `day_${openId}_${dateKey(now)}`,
      perDay,
      { scope: 'user_day', openId, bucket: dateKey(now) }
    )
    await incrementUsage(
      transaction,
      `global_${dateKey(now)}`,
      globalPerDay,
      { scope: 'global_day', bucket: dateKey(now) }
    )
  })
}

/**
 * 每次调用可能落在不同容器实例上，跨轮预取的内存缓存不可靠，
 * 所以只在最终轮现场检索一次——价格与口碑也正是在那一轮才真正用得上。
 */
async function attachSearchEvidence(requestData) {
  if (!isFinalRound(requestData) || !isSearchConfigured()) {
    return { ...requestData, searchEvidence: emptySearchEvidence() }
  }

  try {
    return { ...requestData, searchEvidence: await researchProduct(requestData.productText) }
  } catch (error) {
    console.error(JSON.stringify({
      requestId: requestData.requestId,
      searchError: error.code || error.message || 'SEARCH_FAILED'
    }))
    return { ...requestData, searchEvidence: emptySearchEvidence(error.code || 'SEARCH_FAILED') }
  }
}

async function analyze(requestData) {
  const enriched = await attachSearchEvidence(requestData)
  const messages = buildMessages(enriched)
  let output = await callDeepSeek(messages)

  try {
    return annotateSearchMeta(applyPolicy(output, enriched), enriched.searchEvidence)
  } catch (validationError) {
    output = await callDeepSeek([
      ...messages,
      {
        role: 'system',
        content: `上一份输出未通过结构校验，问题是：${validationError.message}。请严格按约定字段重新输出完整合法 json，不要省略字段，不要改字段名。`
      }
    ])
    return annotateSearchMeta(applyPolicy(output, enriched), enriched.searchEvidence)
  }
}

exports.main = async (event) => {
  const startedAt = Date.now()
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID

  if (event?.action === 'health') {
    return {
      ok: true,
      data: {
        deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        searchEnabled: isSearchConfigured()
      }
    }
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
