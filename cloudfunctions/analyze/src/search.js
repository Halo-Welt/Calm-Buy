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
  return isDoubaoConfigured() || isTavilyConfigured()
}

function preferredProvider() {
  const explicit = String(process.env.SEARCH_PROVIDER || 'auto').toLowerCase()
  if (explicit === 'tavily') return 'tavily'
  if (explicit === 'doubao' || explicit === 'doubao_global') return 'doubao'
  return isDoubaoConfigured() ? 'doubao' : 'tavily'
}

/**
 * 一条 query 塞不下三件事。按意图拆开分别检索，再在合并阶段保证每种意图都有结果，
 * 否则排序很容易被清一色的比价页占满，拿不到差评和替代方案。
 */
function buildSearchQueries(productText, draft = {}, { round = 'first' } = {}) {
  const product = String(productText || '').trim().slice(0, 60)
  if (!product) return []
  const need = String(draft.rootNeed || draft.desiredOutcome || '').trim().slice(0, 30)

  const queries = [
    { intent: 'price', query: `${product} 价格 多少钱 京东 淘宝 拼多多` },
    { intent: 'reputation', query: `${product} 值不值得买 真实评价 缺点 翻车` }
  ]

  if (round === 'final') {
    queries.push({
      intent: 'alternative',
      query: need ? `${need} 替代方案 更平价 推荐` : `${product} 替代方案 更平价 值得买`
    })
  } else if (need) {
    queries.push({ intent: 'alternative', query: `${product} ${need} 适合吗 选购` })
  }

  return queries.map((item) => ({ ...item, query: item.query.slice(0, 100) }))
}

function snippetText(snippetList) {
  if (!Array.isArray(snippetList)) return ''
  return snippetList
    .filter((s) => s && s.Type === 'text' && s.Text)
    .map((s) => String(s.Text).trim())
    .join('\n')
    .slice(0, 500)
}

function snippetImages(snippetList) {
  if (!Array.isArray(snippetList)) return []
  return snippetList
    .filter((s) => s && String(s.Type || '').toLowerCase() === 'image')
    .map((s) => ({
      url: String(s.Image?.ImageUrl || s.ImageUrl || s.Url || '').slice(0, 500),
      alt: String(s.Image?.Alt || s.Text || '').slice(0, 80)
    }))
    .filter((item) => /^https?:\/\//i.test(item.url))
}

function collectImages(candidates, limit = 4) {
  const seen = new Set()
  const out = []
  for (const item of candidates || []) {
    const url = String(item?.url || (typeof item === 'string' ? item : '')).slice(0, 500)
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      alt: String(item?.alt || item?.description || '').slice(0, 80)
    })
    if (out.length >= limit) break
  }
  return out
}

function platformFromUrl(url = '') {
  const host = String(url).toLowerCase()
  if (/taobao\.com|tmall\.com/.test(host)) return '淘宝'
  if (/jd\.com/.test(host)) return '京东'
  if (/pinduoduo\.com|yangkeduo\.com/.test(host)) return '拼多多'
  if (/douyin\.com|iesdouyin/.test(host)) return '抖音'
  if (/xiaohongshu\.com|xhslink/.test(host)) return '小红书'
  if (/smzdm\.com/.test(host)) return '什么值得买'
  if (/zhihu\.com/.test(host)) return '知乎'
  return ''
}

/**
 * 不同来源对购买决策的价值差很远：商品页给得出真实报价，社区和评测给得出差评，
 * 洗稿站两样都给不出。排序时按这个权重放大位次分。
 */
const SOURCE_TIERS = [
  {
    kind: 'farm',
    weight: 0.6,
    re: /baijiahao\.baidu\.com|wenku\.baidu\.com|docin\.com|doc88\.com|renrendoc\.com|so\.com|sm\.cn/
  },
  {
    kind: 'official',
    weight: 1.2,
    re: /apple\.com|microsoft\.com|sony\.(com|cn)|mi\.com|huawei\.com|samsung\.com|gov\.cn/
  },
  {
    kind: 'shop',
    weight: 1.25,
    re: /taobao\.com|tmall\.com|jd\.com|pinduoduo\.com|yangkeduo\.com|suning\.com|vip\.com|kaola\.com|apple\.com\/[a-z-]*\/shop/
  },
  {
    kind: 'community',
    weight: 1.15,
    re: /smzdm\.com|zhihu\.com|xiaohongshu\.com|xhslink|bilibili\.com|douban\.com|coolapk\.com|chiphell\.com|tieba\.baidu\.com/
  },
  {
    kind: 'media',
    weight: 1.08,
    re: /ithome\.com|zol\.com\.cn|pconline\.com\.cn|expreview\.com|sspai\.com|geekpark\.net|autohome\.com\.cn|dongchedi\.com|dcdapp\.com/
  }
]

function sourceTier(url = '') {
  const host = String(url).toLowerCase()
  const hit = SOURCE_TIERS.find((tier) => tier.re.test(host))
  return hit ? { kind: hit.kind, weight: hit.weight } : { kind: 'general', weight: 1 }
}

function publisherGroup(url = '') {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const knownGroups = [
      ['alibaba', /taobao\.com|tmall\.com/],
      ['jd', /jd\.com/],
      ['baidu', /baidu\.com/],
      ['bytedance', /douyin\.com|iesdouyin/],
      ['xiaohongshu', /xiaohongshu\.com|xhslink/]
    ]
    return knownGroups.find(([, pattern]) => pattern.test(host))?.[0]
      || host.split('.').slice(-2).join('.')
  } catch {
    return ''
  }
}

function assessSearchEvidence(items = []) {
  const useful = items.filter((item) => item?.url && item.sourceKind !== 'farm')
  const experienceGroups = new Set(
    useful
      .filter((item) => item.sourceKind === 'community' || item.sourceKind === 'media')
      .map((item) => item.publisherGroup || publisherGroup(item.url))
      .filter(Boolean)
  )
  const hasPriceSource = useful.some((item) => item.sourceKind === 'shop' || item.sourceKind === 'official')
  return {
    level: experienceGroups.size >= 2 && hasPriceSource
      ? 'high'
      : useful.length ? 'medium' : 'low',
    hasPriceSource,
    independentExperienceSources: experienceGroups.size
  }
}

/** 「12.98 万元」这类写法必须带「万元」才认，否则「销量 10 万+」会被读成十万块 */
const PRICE_WAN_RE = /(\d+(?:\.\d{1,2})?)\s*万\s*元/g
const PRICE_YUAN_RE = /(?:[¥￥]|RMB\s*|人民币\s*)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)\s*(?:元|块钱)/gi

const PRICE_FLOOR = 5
const PRICE_CEILING = 5000000

function parsePrices(text = '') {
  const source = String(text)
  const values = []

  for (const match of source.matchAll(PRICE_WAN_RE)) {
    values.push(Number(match[1]) * 10000)
  }
  for (const match of source.matchAll(PRICE_YUAN_RE)) {
    values.push(Number(String(match[1] || match[2]).replaceAll(',', '')))
  }

  return values.filter((value) => Number.isFinite(value) && value >= PRICE_FLOOR && value <= PRICE_CEILING)
}

function formatMoney(value) {
  if (value >= 10000) return `${Number((value / 10000).toFixed(2))} 万`
  return String(Math.round(value))
}

function formatPriceRange(min, max) {
  if (!Number.isFinite(min)) return null
  if (max - min < Math.max(1, min * 0.05)) return `约 ${formatMoney(min)} 元`
  return `约 ${formatMoney(min)}–${formatMoney(max)} 元`
}

/**
 * 让模型自己从几千字摘要里读价格，十次里有几次会读成 null 或读到配件价。
 * 服务端先抽成结构化区间：既能当提示词里的价格锚点，也能给决策量级判定当依据。
 * 按中位数剔除离群值，避免「手机壳 29 元」把手机的价格带塌。
 */
function extractPriceAnchor(items = []) {
  const values = []
  for (const item of items) {
    values.push(...parsePrices(`${item?.title || ''} ${item?.content || ''}`))
  }
  if (!values.length) return null

  const sorted = values.sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const kept = sorted.filter((value) => value >= median / 8 && value <= median * 8)
  if (!kept.length) return null

  const min = kept[0]
  const max = kept[kept.length - 1]
  return {
    min,
    max,
    median: kept[Math.floor(kept.length / 2)],
    count: kept.length,
    text: formatPriceRange(min, max)
  }
}

async function doubaoGlobalSearch(query, { maxResults = 4, timeoutMs = 3500 } = {}) {
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
      images: snippetImages(doc.Snippet),
      rank: Number.isFinite(doc.Rank) ? doc.Rank : index,
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

async function tavilySearch(query, { maxResults = 4, timeoutMs = 3500 } = {}) {
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
    const items = (payload.results || []).map((item, index) => ({
      title: String(item.title || '').slice(0, 160),
      url: String(item.url || '').slice(0, 500),
      content: String(item.content || item.snippet || '').slice(0, 500),
      rank: index,
      query
    }))
    return {
      items,
      images: collectImages(payload.images || [])
    }
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

/**
 * 豆包给的是位次、Tavily 给的是自家相关性分，两者量纲不可比，混在一起排序等于没排。
 * 统一折成「provider 内位次分 × 来源权重」再参与合并排序。
 */
function decorateItems(items, intent) {
  return (items || []).map((item, index) => {
    const rank = Number.isFinite(item.rank) ? item.rank : index
    const tier = sourceTier(item.url)
    return {
      ...item,
      rank,
      intent,
      sourceKind: tier.kind,
      publisherGroup: publisherGroup(item.url),
      relevance: (1 / (1 + rank)) * tier.weight
    }
  })
}

function asSearchResult(provider, raw, intent) {
  if (Array.isArray(raw)) {
    return {
      provider,
      items: decorateItems(raw, intent),
      images: collectImages(raw.flatMap((item) => item.images || []))
    }
  }
  return {
    provider,
    items: decorateItems(raw.items, intent),
    images: collectImages([
      ...(raw.images || []),
      ...(raw.items || []).flatMap((item) => item.images || [])
    ])
  }
}

async function searchOnce(query, { maxResults = 3, intent = 'general' } = {}) {
  const provider = preferredProvider()
  if (provider === 'doubao') {
    try {
      return asSearchResult('doubao', await doubaoGlobalSearch(query, { maxResults }), intent)
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
      return asSearchResult('tavily', await tavilySearch(query, { maxResults }), intent)
    }
  }
  return asSearchResult('tavily', await tavilySearch(query, { maxResults }), intent)
}

const INTENT_LABELS = {
  price: '价格/渠道',
  reputation: '口碑/缺点',
  alternative: '替代方案',
  general: '综合'
}

/**
 * 追问轮只需要价格和一两个坑点，塞四千字进提示词既慢又让模型抓不住重点；
 * 最终轮才需要完整摘要来支撑结论。
 */
const SUMMARY_BUDGETS = {
  brief: { maxItems: 4, contentChars: 180 },
  full: { maxItems: 8, contentChars: 420 }
}

function formatSearchSummary(items, images = [], { budget = 'full', priceAnchor = null } = {}) {
  if (!items.length) return '未检索到可用网页摘要。'
  const { maxItems, contentChars } = SUMMARY_BUDGETS[budget] || SUMMARY_BUDGETS.full

  const body = items.slice(0, maxItems).map((item, index) => {
    const tags = [
      platformFromUrl(item.url),
      INTENT_LABELS[item.intent] || ''
    ].filter(Boolean).join('·')
    const parts = [
      `[${index + 1}] ${item.title || '无标题'}${tags ? `（${tags}）` : ''}`,
      item.url ? `来源：${item.url}` : '',
      item.content ? `摘要：${String(item.content).slice(0, contentChars)}` : ''
    ].filter(Boolean)
    return parts.join('\n')
  }).join('\n\n')

  const header = priceAnchor?.text
    ? `价格锚点（服务端从以下结果里抽出的 ${priceAnchor.count} 个报价，可直接引用）：${priceAnchor.text}\n\n`
    : ''
  if (!images.length) return `${header}${body}`
  return `${header}${body}\n\n可用配图（展示给用户，不要编造其它链接）：\n${
    images.map((img, index) => `${index + 1}. ${img.url}`).join('\n')
  }`
}

/** 按意图轮转取结果，保证价格页不会把差评和替代方案挤出去 */
function interleaveByIntent(items, limit) {
  const groups = new Map()
  for (const item of items) {
    const key = item.intent || 'general'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => b.relevance - a.relevance)
  }

  const out = []
  let picked = true
  while (out.length < limit && picked) {
    picked = false
    for (const list of groups.values()) {
      if (!list.length || out.length >= limit) continue
      out.push(list.shift())
      picked = true
    }
  }
  return out
}

/** 没有正文又不是商品页的结果，对结论毫无贡献，只会占摘要预算 */
function hasDecisionValue(item) {
  if (!item?.url) return false
  if (item.sourceKind === 'shop') return true
  const content = String(item.content || '')
  return content.length >= 16 || parsePrices(content).length > 0
}

async function researchProduct(productText, draft = {}, { round = 'first' } = {}) {
  const plans = buildSearchQueries(productText, draft, { round })
  const settled = await Promise.allSettled(
    plans.map((plan) => searchOnce(plan.query, { maxResults: 4, intent: plan.intent }))
  )

  const items = []
  const seen = new Set()
  const errors = []
  const providers = new Set()
  const imageCandidates = []

  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      errors.push(result.reason?.code || result.reason?.message || 'SEARCH_FAILED')
      continue
    }
    providers.add(result.value.provider)
    imageCandidates.push(...(result.value.images || []))
    for (const item of result.value.items) {
      const key = item.url || `${item.title}:${item.content.slice(0, 40)}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!hasDecisionValue(item)) continue
      items.push(item)
      imageCandidates.push(...(item.images || []))
    }
  }

  const budget = round === 'final' ? 'full' : 'brief'
  const limited = interleaveByIntent(items, SUMMARY_BUDGETS[budget].maxItems)
  const images = collectImages(imageCandidates, 4)
  const priceAnchor = extractPriceAnchor(limited)
  const credibility = assessSearchEvidence(limited)

  const provider = providers.has('doubao') && !providers.has('tavily')
    ? 'doubao'
    : providers.has('doubao') && providers.has('tavily')
      ? 'doubao+tavily'
      : 'tavily'

  return {
    enabled: limited.length > 0,
    provider,
    round,
    queries: plans.map((plan) => plan.query),
    items: limited,
    images,
    priceAnchor,
    credibility,
    searchedAt: new Date().toISOString(),
    summary: formatSearchSummary(limited, images, { budget, priceAnchor }),
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
    images: [],
    priceAnchor: null,
    credibility: { level: 'low', hasPriceSource: false, independentExperienceSources: 0 },
    searchedAt: null,
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
    searchProvider: used ? (searchEvidence.provider || null) : null,
    searchError: used
      ? null
      : (searchEvidence?.error || searchEvidence?.errors?.[0] || null),
    searchSources: used
      ? searchEvidence.items.filter((item) => item.url).slice(0, 6).map((item) => ({
        title: item.title,
        url: item.url,
        platform: platformFromUrl(item.url),
        sourceKind: item.sourceKind,
        publisherGroup: item.publisherGroup
      }))
      : [],
    searchedAt: used ? searchEvidence.searchedAt : null,
    sourceCredibility: searchEvidence?.credibility || {
      level: 'low',
      hasPriceSource: false,
      independentExperienceSources: 0
    },
    images: []
  }
}

module.exports = {
  annotateSearchMeta,
  assessSearchEvidence,
  buildSearchQueries,
  collectImages,
  doubaoGlobalSearch,
  emptySearchEvidence,
  extractPriceAnchor,
  formatSearchSummary,
  interleaveByIntent,
  isDoubaoConfigured,
  isSearchConfigured,
  isTavilyConfigured,
  parsePrices,
  preferredProvider,
  publisherGroup,
  researchProduct,
  snippetImages,
  sourceTier,
  tavilySearch,
  platformFromUrl
}
