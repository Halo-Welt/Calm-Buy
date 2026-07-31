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

function adaptResult(apiResult, { mode, productText, searchUsed = false, searchSources = [] }) {
  const usedSearch = Boolean(searchUsed || apiResult.searchUsed)
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
    searchSources: searchSources.length ? searchSources : (apiResult.searchSources || []),
    verdictLabel: VERDICT_LABELS[apiResult.verdict] || '先验证',
    verdictArt: VERDICT_ART[apiResult.verdict] || VERDICT_ART.wait,
    confidenceLabel: CONFIDENCE_LABELS[apiResult.confidence] || '低',
    primaryNeedLabel: NEED_LABELS[apiResult.primaryNeedId] || '尚未确认',
    alternatives: apiResult.alternatives || [],
    candidateProducts: apiResult.candidateProducts || [],
    evidenceQuotes: apiResult.evidenceQuotes || [],
    reviewSummary: {
      pros: [],
      cons: [],
      best_for: '',
      not_for: '',
      source_note: usedSearch
        ? '结论参考了联网检索到的价格与口碑，具体成交价请自行核对'
        : mode === 'live'
          ? '本次没有可用联网结果，价格与口碑未经核验'
          : '基础判断；未连接智能分析'
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
