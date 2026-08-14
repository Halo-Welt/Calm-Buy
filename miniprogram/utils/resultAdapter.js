const VERDICT_LABELS = {
  stop: '不建议买',
  wait: '先验证',
  buy: '可以买',
  replace: '别买当前这个'
}

const VERDICT_ART = {
  stop: '/assets/art/verdict-stop.jpg',
  wait: '/assets/art/verdict-wait.jpg',
  buy: '/assets/art/verdict-buy.jpg',
  replace: '/assets/art/verdict-replace.jpg'
}

const CONFIDENCE_LABELS = {
  high: '高',
  medium: '中',
  low: '低'
}

const NEED_LABELS = {
  identity: '身份 / 被看见',
  novelty: '新奇体验',
  utility: '场景功能',
  anxiety: '落后焦虑',
  emotion: '情绪奖励',
  belong: '归属 / 跟风',
  collect: '收藏占有'
}

function normalizeMarketSnapshot(snapshot = {}) {
  return {
    priceRange: snapshot.priceRange || '',
    reputation: snapshot.reputation || '',
    watchOuts: Array.isArray(snapshot.watchOuts) ? snapshot.watchOuts.filter(Boolean) : []
  }
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

function withPlatform(item) {
  if (!item || typeof item !== 'object') return item
  return {
    ...item,
    platform: item.platform || platformFromUrl(item.url)
  }
}

function searchSourceNote(usedSearch, mode, provider) {
  if (!usedSearch) {
    return mode === 'live'
      ? '本次没有可用联网结果，价格与口碑未经核验'
      : '基础判断；未连接智能分析'
  }
  if (provider === 'doubao') {
    return '结论参考了豆包搜索的价格与口碑，具体成交价请自行核对'
  }
  if (provider === 'doubao+tavily') {
    return '结论参考了豆包搜索，部分结果来自备用搜索，具体成交价请自行核对'
  }
  return '结论参考了备用搜索的价格与口碑，具体成交价请自行核对'
}

function adaptResult(apiResult, { mode, productText, searchUsed = false, searchSources = [], searchProvider = '' }) {
  const usedSearch = Boolean(searchUsed || apiResult.searchUsed)
  const provider = searchProvider || apiResult.searchProvider || ''
  const marketSnapshot = normalizeMarketSnapshot(apiResult.marketSnapshot)
  return {
    ...apiResult,
    marketSnapshot,
    hasMarketInfo: Boolean(
      marketSnapshot.priceRange || marketSnapshot.reputation || marketSnapshot.watchOuts.length
    ),
    id: `result_${Date.now().toString(36)}`,
    productText,
    mode,
    searchUsed: usedSearch,
    searchProvider: provider,
    searchSourceLabel: provider === 'doubao' || provider === 'doubao+tavily'
      ? '信息来源 · 豆包搜索'
      : provider === 'tavily'
        ? '信息来源 · 备用搜索'
        : '信息来源',
    searchSources: (searchSources.length ? searchSources : (apiResult.searchSources || []))
      .filter((item) => item && item.url)
      .map(withPlatform),
    verdictLabel: VERDICT_LABELS[apiResult.verdict] || '先验证',
    verdictArt: VERDICT_ART[apiResult.verdict] || VERDICT_ART.wait,
    confidenceLabel: CONFIDENCE_LABELS[apiResult.confidence] || '低',
    primaryNeedLabel: NEED_LABELS[apiResult.primaryNeedId] || '尚未确认',
    alternatives: apiResult.alternatives || [],
    candidateProducts: (apiResult.candidateProducts || []).map(withPlatform),
    evidenceQuotes: apiResult.evidenceQuotes || [],
    reviewSummary: {
      pros: [],
      cons: [],
      best_for: '',
      not_for: '',
      source_note: searchSourceNote(usedSearch, mode, provider)
    },
    cooldownHours: apiResult.cooldownHours ?? 48,
    createdAt: Date.now()
  }
}

module.exports = {
  CONFIDENCE_LABELS,
  NEED_LABELS,
  VERDICT_ART,
  VERDICT_LABELS,
  adaptResult
}
