const http = require('node:http')
const { analyzeRequestSchema } = require('./schema')
const { buildMessages } = require('./prompt')
const { callDeepSeek, llmBudget } = require('./deepseek')
const { applyPolicy } = require('./policy')
const { buildFallbackResponse } = require('./fallback')
const { isFinalRound, shouldResearchNow } = require('./questions')
const {
  annotateSearchMeta,
  emptySearchEvidence,
  isDoubaoConfigured,
  isSearchConfigured,
  isTavilyConfigured,
  researchProduct
} = require('./search')

const PORT = Number(process.env.PORT || 8787)
const MAX_BODY_BYTES = 64 * 1024
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60 * 1000
const rateBuckets = new Map()

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const SEARCH_CACHE_MAX = 200
const searchCache = new Map()

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  })
  response.end(JSON.stringify(payload))
}

function checkRateLimit(ip) {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { startedAt: now, count: 1 })
    return true
  }
  bucket.count += 1
  return bucket.count <= RATE_LIMIT
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { code: 'BODY_TOO_LARGE' }))
        request.destroy()
        return
      }
      body += chunk
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        reject(Object.assign(new Error('请求 JSON 非法'), { code: 'INVALID_JSON' }))
      }
    })
    request.on('error', reject)
  })
}

function pruneSearchCache(now) {
  for (const [key, entry] of searchCache) {
    if (now - entry.createdAt >= SEARCH_CACHE_TTL_MS) searchCache.delete(key)
  }
  while (searchCache.size > SEARCH_CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value)
  }
}

/**
 * 第一轮就把检索发出去并等待结果，后面几轮直接复用：
 * 提问阶段能带上真实行情，最终轮若需求变了再补搜一次。
 */
function getOrStartResearch(sessionId, productText, draft = {}, round = 'first') {
  const now = Date.now()
  const needKey = String(draft.rootNeed || draft.desiredOutcome || '')
  const cached = searchCache.get(sessionId)
  if (
    cached
    && cached.productText === productText
    && cached.needKey === needKey
    && cached.round === round
    && now - cached.createdAt < SEARCH_CACHE_TTL_MS
  ) {
    return cached
  }

  const entry = {
    createdAt: now,
    productText,
    needKey,
    round,
    settled: false,
    value: emptySearchEvidence()
  }
  entry.promise = researchProduct(productText, draft, { round })
    .then((value) => {
      entry.value = value
      return value
    })
    .catch((error) => {
      console.error(JSON.stringify({ sessionId, searchError: error.code || 'SEARCH_FAILED' }))
      entry.value = emptySearchEvidence(error.code || 'SEARCH_FAILED')
      return entry.value
    })
    .finally(() => {
      entry.settled = true
    })

  searchCache.set(sessionId, entry)
  pruneSearchCache(now)
  return entry
}

async function attachSearchEvidence(requestData) {
  if (!isSearchConfigured() || !shouldResearchNow(requestData)) {
    return { ...requestData, searchEvidence: emptySearchEvidence() }
  }

  const entry = getOrStartResearch(
    requestData.sessionId,
    requestData.productText,
    requestData.draft,
    isFinalRound(requestData) ? 'final' : 'first'
  )
  await entry.promise
  return { ...requestData, searchEvidence: entry.value }
}

async function analyze(requestData) {
  const enriched = await attachSearchEvidence(requestData)
  const messages = buildMessages(enriched)
  const budget = llmBudget(isFinalRound(requestData))
  let output = await callDeepSeek(messages, budget)

  try {
    const result = applyPolicy(output, enriched)
    return annotateSearchMeta(result, enriched.searchEvidence)
  } catch (validationError) {
    output = await callDeepSeek([
      ...messages,
      {
        role: 'system',
        content: `上一份输出未通过结构校验，问题是：${validationError.message}。请严格按约定字段重新输出完整合法 json，不要省略字段，不要改字段名。`
      }
    ], budget)
    const result = applyPolicy(output, enriched)
    return annotateSearchMeta(result, enriched.searchEvidence)
  }
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now()
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      searchEnabled: isSearchConfigured(),
      searchProvider: process.env.SEARCH_PROVIDER || 'auto',
      doubaoConfigured: isDoubaoConfigured(),
      tavilyConfigured: isTavilyConfigured()
    })
    return
  }

  if (request.method !== 'POST' || url.pathname !== '/api/analyze/step') {
    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
    return
  }

  const ip = request.socket.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) {
    sendJson(response, 429, { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } })
    return
  }

  let requestId = 'unknown'
  let phase = 'unknown'

  try {
    const body = await readJsonBody(request)
    const parsed = analyzeRequestSchema.safeParse(body)
    if (!parsed.success) {
      sendJson(response, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: '请求字段不符合约定',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        }
      })
      return
    }

    requestId = parsed.data.requestId
    phase = parsed.data.phase

    try {
      const result = await analyze(parsed.data)
      console.info(JSON.stringify({
        requestId,
        phase,
        mode: 'live',
        searchUsed: Boolean(result.searchUsed),
        searchProvider: result.searchProvider || null,
        durationMs: Date.now() - startedAt
      }))
      sendJson(response, 200, { ...result, mode: 'live', error: null })
    } catch (error) {
      const errorCode = error.code || 'ANALYSIS_FAILED'
      console.error(JSON.stringify({
        requestId,
        phase,
        mode: 'fallback',
        errorCode,
        reason: (error.message || '').slice(0, 500),
        durationMs: Date.now() - startedAt
      }))
      sendJson(response, 200, buildFallbackResponse(parsed.data, errorCode))
    }
  } catch (error) {
    sendJson(response, error.code === 'BODY_TOO_LARGE' ? 413 : 400, {
      error: {
        code: error.code || 'BAD_REQUEST',
        message: error.message || '请求处理失败'
      }
    })
  }
})

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.info(`Calm Buy server listening on http://0.0.0.0:${PORT}`)
  })
}

module.exports = { analyze, server }
