const DOUBAO_SEARCH_URL = 'https://open.feedcoopapi.com/search_api/global_search'
const DOUBAO_QUOTA_CODES = new Set([10409, 10410, 10412])

/** 进程内标记：豆包免费/套餐额度耗尽后本进程直接走 Tavily */
let doubaoQuotaExhausted = false

function getDoubaoApiKey() {
  return process.env.DOUBAO_SEARCH_API_KEY || process.env.VOLC_SEARCH_API_KEY || ''
}

function isDoubaoConfigured() {
  return Boolean(getDoubaoApiKey()) && !doubaoQuotaExhausted
}

function isTavilyConfigured() {
  return Boolean(process.env.TAVILY_API_KEY || process.env.SEARCH_API_KEY)
}

function isSearchConfigured() {
  return isDoubaoConfigured() || isTavilyConfigured() || true
}

function preferredProvider() {
  const explicit = String(process.env.SEARCH_PROVIDER || 'auto').toLowerCase()
  if (explicit === 'tavily') return 'tavily'
  if (explicit === 'doubao' || explicit === 'doubao_global') return 'doubao'
  return isDoubaoConfigured() ? 'doubao' : 'tavily'
}

function buildSearchQueries(productText) {
  const product = String(productText || '').trim().slice(0, 80)
  const queries = [
    `${product} 价格 多少钱`,
    `${product} 真实评价 口碑 优缺点`,
    `${product} 缺点 踩坑 值不值得买`
  ]
  return [...new Set(queries.filter(Boolean))].slice(0, 3).map((q) => q.slice(0, 100))
}

function snippetText(snippetList) {
  if (!Array.isArray(snippetList)) return ''
  return snippetList
    .filter((s) => s && s.Type === 'text' && s.Text)
    .map((s) => String(s.Text).trim())
    .join('\n')
    .slice(0, 500)
}

async function doubaoGlobalSearch(query, { maxResults = 4, timeoutMs = 12000 } = {}) {
  const apiKey = getDoubaoApiKey()
  if (!apiKey) {
    const error = new Error('未配置 DOUBAO_SEARCH_API_KEY')
    error.code = 'DOUBAO_NOT_CONFIGURED'
    throw error
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(DOUBAO_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        Query: String(query || '').slice(0, 100),
        DocCount: Math.min(Math.max(Number(maxResults) || 4, 1), 20),
        MaxSnippetLength: 800,
        MaxImageCountPerDoc: 0
      }),
      signal: controller.signal
    })

    const text = await response.text()
    let payload = {}
    try {
      payload = JSON.parse(text || '{}')
    } catch {
      payload = { raw: text }
    }

    const metaError = payload?.ResponseMetadata?.Error
    if (metaError) {
      const codeN = Number(metaError.CodeN || metaError.Code) || 0
      const error = new Error(metaError.Message || `豆包搜索失败：${codeN}`)
      error.code = DOUBAO_QUOTA_CODES.has(codeN) ? 'DOUBAO_QUOTA_EXHAUSTED' : 'DOUBAO_API_ERROR'
      error.doubaoCode = codeN
      error.detail = text.slice(0, 300)
      if (error.code === 'DOUBAO_QUOTA_EXHAUSTED') doubaoQuotaExhausted = true
      throw error
    }

    const result = payload?.Result
    if (!result) {
      const error = new Error(`豆包搜索 HTTP ${response.status}`)
      error.code = 'SEARCH_HTTP_ERROR'
      error.detail = text.slice(0, 300)
      throw error
    }

    const errorCode = Number(result.ErrorCode)
    if (errorCode !== 0) {
      const error = new Error(result.ErrorMsg || `豆包搜索业务错误：${errorCode}`)
      error.code = DOUBAO_QUOTA_CODES.has(errorCode) ? 'DOUBAO_QUOTA_EXHAUSTED' : 'DOUBAO_API_ERROR'
      error.doubaoCode = errorCode
      if (error.code === 'DOUBAO_QUOTA_EXHAUSTED') doubaoQuotaExhausted = true
      throw error
    }

    if (!response.ok) {
      const error = new Error(`豆包搜索 HTTP ${response.status}`)
      error.code = 'SEARCH_HTTP_ERROR'
      error.detail = text.slice(0, 300)
      throw error
    }

    return (result.Documents || []).map((doc, index) => ({
      title: String(doc.Title || '').slice(0, 160),
      url: String(doc.Url || '').slice(0, 500),
      content: snippetText(doc.Snippet),
      score: 1 / (1 + (Number.isFinite(doc.Rank) ? doc.Rank : index)),
      query,
      host: doc.HostInfo?.Hostname || ''
    }))
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('豆包搜索超时')
      timeoutError.code = 'SEARCH_TIMEOUT'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function tavilySearch(query, { maxResults = 4, timeoutMs = 10000 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY || process.env.SEARCH_API_KEY
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  async function request(headers, body) {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await response.text()
    let payload = {}
    try {
      payload = JSON.parse(text || '{}')
    } catch {
      payload = { raw: text }
    }
    return { response, payload, text }
  }

  function mapResults(payload) {
    return (payload.results || []).map((item) => ({
      title: String(item.title || '').slice(0, 160),
      url: String(item.url || '').slice(0, 500),
      content: String(item.content || item.snippet || '').slice(0, 500),
      score: Number(item.score) || 0,
      query
    }))
  }

  try {
    if (apiKey) {
      const keyed = await request(
        { Authorization: `Bearer ${apiKey}` },
        {
          query,
          search_depth: 'basic',
          include_answer: false,
          include_images: false,
          include_raw_content: false,
          max_results: maxResults,
          topic: 'general'
        }
      )
      if (keyed.response.ok) return mapResults(keyed.payload)

      if (keyed.response.status !== 401) {
        const error = new Error(`Tavily 请求失败：${keyed.response.status}`)
        error.code = 'SEARCH_HTTP_ERROR'
        error.detail = keyed.text.slice(0, 300)
        throw error
      }
      console.warn(JSON.stringify({
        search: 'tavily',
        warning: 'API Key 无效，回退 keyless 模式'
      }))
    }

    const keyless = await request(
      { 'X-Tavily-Access-Mode': 'keyless' },
      {
        query,
        search_depth: 'basic',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: maxResults,
        topic: 'general'
      }
    )
    if (!keyless.response.ok) {
      const error = new Error(`Tavily keyless 失败：${keyless.response.status}`)
      error.code = 'SEARCH_HTTP_ERROR'
      error.detail = keyless.text.slice(0, 300)
      throw error
    }
    return mapResults(keyless.payload)
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Tavily 请求超时')
      timeoutError.code = 'SEARCH_TIMEOUT'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function searchOnce(query, { maxResults = 3 } = {}) {
  const provider = preferredProvider()
  if (provider === 'doubao') {
    try {
      return { provider: 'doubao', items: await doubaoGlobalSearch(query, { maxResults }) }
    } catch (error) {
      const shouldFallback = error.code === 'DOUBAO_QUOTA_EXHAUSTED'
        || error.code === 'DOUBAO_NOT_CONFIGURED'
        || error.code === 'DOUBAO_API_ERROR'
        || error.code === 'SEARCH_HTTP_ERROR'
        || error.code === 'SEARCH_TIMEOUT'
      if (!shouldFallback) throw error
      console.warn(JSON.stringify({
        search: 'doubao',
        fallback: 'tavily',
        code: error.code,
        doubaoCode: error.doubaoCode || null,
        message: error.message
      }))
      return { provider: 'tavily', items: await tavilySearch(query, { maxResults }) }
    }
  }
  return { provider: 'tavily', items: await tavilySearch(query, { maxResults }) }
}

function formatSearchSummary(items) {
  if (!items.length) return '未检索到可用网页摘要。'
  return items.map((item, index) => {
    const parts = [
      `[${index + 1}] ${item.title || '无标题'}`,
      item.url ? `来源：${item.url}` : '',
      item.content ? `摘要：${item.content}` : ''
    ].filter(Boolean)
    return parts.join('\n')
  }).join('\n\n')
}

async function researchProduct(productText) {
  const queries = buildSearchQueries(productText)
  const settled = await Promise.allSettled(
    queries.map((query) => searchOnce(query, { maxResults: 3 }))
  )

  const items = []
  const seen = new Set()
  const errors = []
  const providers = new Set()

  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      errors.push(result.reason?.code || result.reason?.message || 'SEARCH_FAILED')
      continue
    }
    providers.add(result.value.provider)
    for (const item of result.value.items) {
      const key = item.url || `${item.title}:${item.content.slice(0, 40)}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }

  const limited = items
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  const provider = providers.has('doubao') && !providers.has('tavily')
    ? 'doubao'
    : providers.has('doubao') && providers.has('tavily')
      ? 'doubao+tavily'
      : 'tavily'

  return {
    enabled: limited.length > 0,
    provider,
    queries,
    items: limited,
    summary: formatSearchSummary(limited),
    errors: errors.slice(0, 3),
    doubaoQuotaExhausted
  }
}

function emptySearchEvidence(error) {
  return {
    enabled: false,
    provider: null,
    queries: [],
    items: [],
    summary: '',
    ...(error ? { error } : {})
  }
}

/** 结果里附上本次是否真的用了联网信息，以及可核对的来源 */
function annotateSearchMeta(result, searchEvidence) {
  const used = Boolean(searchEvidence?.enabled && searchEvidence?.items?.length)
  return {
    ...result,
    searchUsed: used,
    searchSources: used
      ? searchEvidence.items.slice(0, 5).map((item) => ({
        title: item.title,
        url: item.url
      }))
      : []
  }
}

module.exports = {
  annotateSearchMeta,
  buildSearchQueries,
  doubaoGlobalSearch,
  emptySearchEvidence,
  formatSearchSummary,
  isSearchConfigured,
  preferredProvider,
  researchProduct,
  tavilySearch
}
