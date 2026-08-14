const cloud = require('wx-server-sdk')
const { analyzeRequestSchema } = require('./src/schema')
const { buildMessages } = require('./src/prompt')
const { callDeepSeek, llmBudget } = require('./src/deepseek')
const { applyPolicy } = require('./src/policy')
const { buildFallbackResponse } = require('./src/fallback')
const { isFinalRound, shouldResearchNow } = require('./src/questions')
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
 * 微信小程序不能加载任意 CDN 图片。把检索到的配图转存到云存储，
 * 返回 cloud:// fileID；失败则回退原链接。
 */
async function materializeImages(images, requestId) {
  const limited = Array.isArray(images) ? images.slice(0, 2) : []
  if (!limited.length) return []

  const uploaded = await Promise.all(limited.map(async (item, index) => {
    const url = String(item?.url || '')
    if (!/^https?:\/\//i.test(url)) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return null
      const contentType = String(response.headers.get('content-type') || '')
      if (!contentType.startsWith('image/')) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length || buffer.length > 1.5 * 1024 * 1024) return null
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
      const { fileID } = await cloud.uploadFile({
        cloudPath: `calm-buy/search/${requestId}/${index}.${ext}`,
        fileContent: buffer
      })
      return fileID ? { url: fileID, alt: String(item.alt || '').slice(0, 80) } : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }))

  const ready = uploaded.filter(Boolean)
  return ready.length ? ready : limited
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
  const enriched = await attachSearchEvidence(requestData)
  const imageJob = materializeImages(enriched.searchEvidence?.images, requestData.requestId)
  const messages = buildMessages(enriched)
  const budget = llmBudget(isFinalRound(requestData))
  let output = await callDeepSeek(messages, budget)

  try {
    const images = await imageJob
    return annotateSearchMeta(
      applyPolicy(output, enriched),
      { ...enriched.searchEvidence, images }
    )
  } catch (validationError) {
    output = await callDeepSeek([
      ...messages,
      {
        role: 'system',
        content: `上一份输出未通过结构校验，问题是：${validationError.message}。请严格按约定字段重新输出完整合法 json，不要省略字段，不要改字段名。`
      }
    ], budget)
    const images = await imageJob
    return annotateSearchMeta(
      applyPolicy(output, enriched),
      { ...enriched.searchEvidence, images }
    )
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
        searchEnabled: isSearchConfigured(),
        doubaoConfigured: isDoubaoConfigured(),
        tavilyConfigured: isTavilyConfigured()
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
