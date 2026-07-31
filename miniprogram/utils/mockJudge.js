(function initCalmBuyJudge() {
const QUESTIONS = [
  {
    text: '先不聊参数。你准备在什么场景用它？多久会用一次？',
    placeholder: '例如：每周三次，躺在床上看电影'
  },
  {
    text: '如果没有任何朋友知道你买了它，你还会想买吗？',
    options: ['会，需求没变', '会，但没那么兴奋', '不会，立刻没那么想']
  },
  {
    text: '这次更像是在解决具体不方便，还是单纯心里痒？',
    options: ['具体不方便', '主要是心里痒', '两者都有']
  },
  {
    text: '如果有更朴素但够用的办法，你能接受吗？',
    options: ['可以，解决问题就行', '看情况', '不接受，我就想要这个']
  }
]

const NEED_LABELS = {
  identity: '身份 / 被看见',
  novelty: '新奇体验',
  utility: '场景功能',
  anxiety: '落后焦虑',
  emotion: '情绪奖励'
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word))
}

function inferNeed(productText, answers) {
  const scene = answers[0] || ''
  const visibility = answers[1] || ''
  const issue = answers[2] || ''

  if (visibility.includes('不会') || issue.includes('心里痒')) {
    return {
      id: 'identity',
      sentence: `借“${productText}”获得一点被看见和自我奖励的感觉`
    }
  }

  if (includesAny(productText, ['未来', '新款', '首发']) && issue.includes('两者')) {
    return {
      id: 'novelty',
      sentence: `低成本体验“${productText}”带来的新鲜感`
    }
  }

  return {
    id: 'utility',
    sentence: scene ? `在${scene}时，更省力地解决具体不方便` : `用“${productText}”解决一个明确场景问题`
  }
}

function reviewSummary(productText, reviewText) {
  if (!reviewText) {
    return {
      pros: [],
      cons: [],
      best_for: '',
      not_for: '',
      source_note: '未引入外部评测，结论置信度封顶为中'
    }
  }

  if (includesAny(productText, ['眼镜', 'Vision', 'vision'])) {
    return {
      pros: ['沉浸感强', '躺卧时可获得大屏体验'],
      cons: ['长时间佩戴可能重、热', '内容与使用场景仍有限'],
      best_for: '能接受佩戴负担，且高频使用沉浸内容的人',
      not_for: '只想偶尔在床上看电影的人',
      source_note: '根据用户粘贴的评测原文做演示摘要'
    }
  }

  return {
    pros: ['用户提供的评测对核心场景有正面反馈'],
    cons: ['长期耐用性与真实使用频率仍需自行核对'],
    best_for: '场景明确、使用频率稳定的人',
    not_for: '只被短期新鲜感驱动的人',
    source_note: '根据用户粘贴的评测原文做演示摘要'
  }
}

function createResult({ productText, answers, reviewText = '', rejected = false }) {
  const need = inferNeed(productText, answers)
  const summary = reviewSummary(productText, reviewText)
  const hasReview = Boolean(reviewText.trim())
  const isGlasses = includesAny(productText, ['眼镜', 'Vision', 'vision'])
  const isCleaningTool = includesAny(productText, ['拖把', '清洁', '扫地'])

  if (rejected) {
    return {
      id: String(Date.now()),
      productText,
      verdict: 'wait',
      verdictLabel: '先别急，信息还不够',
      confidence: 'low',
      confidenceLabel: '低',
      primaryNeedId: need.id,
      primaryNeedLabel: NEED_LABELS[need.id],
      needSentence: need.sentence,
      reasons: ['你否定了需求确认句，当前判断基础不成立', '再观察一次真实使用场景，比继续猜更有用'],
      reviewSummary: summary,
      alternatives: [],
      nextStep: '冷却 48 小时，记下下一次真正需要它的时刻。',
      cooldownHours: 48,
      createdAt: Date.now()
    }
  }

  if (need.id === 'identity') {
    return {
      id: String(Date.now()),
      productText,
      verdict: 'stop',
      verdictLabel: '不建议买',
      confidence: 'medium',
      confidenceLabel: '中',
      primaryNeedId: need.id,
      primaryNeedLabel: NEED_LABELS[need.id],
      needSentence: need.sentence,
      reasons: ['商品解决不了“持续被看见”的需要', '兴奋点来自拥有后的想象，不是稳定使用场景'],
      reviewSummary: summary,
      alternatives: [],
      nextStep: '把它放进愿望单，不搜价格，48 小时后再看。',
      cooldownHours: 48,
      createdAt: Date.now()
    }
  }

  if (need.id === 'utility' && isGlasses && hasReview) {
    return {
      id: String(Date.now()),
      productText,
      verdict: 'replace',
      verdictLabel: '别买当前这个',
      confidence: 'high',
      confidenceLabel: '高',
      primaryNeedId: need.id,
      primaryNeedLabel: NEED_LABELS[need.id],
      needSentence: need.sentence,
      reasons: ['你的目标是稳定获得大屏体验，不是拥有头显', '评测中的重量、发热和内容限制会直接损伤核心场景'],
      reviewSummary: summary,
      alternatives: [
        {
          title: '先借或短租头显',
          why: '用最低成本验证你能否接受重量与发热',
          servesNeedId: 'utility',
          type: 'rent_or_try'
        },
        {
          title: '床头投影或大屏平板',
          why: '更直接满足躺卧看片，也没有佩戴负担',
          servesNeedId: 'utility',
          type: 'product'
        }
      ],
      nextStep: '先试一次完整电影，再决定是否值得长期持有。',
      cooldownHours: 48,
      createdAt: Date.now()
    }
  }

  if (need.id === 'utility' && isCleaningTool && hasReview) {
    return {
      id: String(Date.now()),
      productText,
      verdict: 'buy',
      verdictLabel: '可以买',
      confidence: 'high',
      confidenceLabel: '高',
      primaryNeedId: need.id,
      primaryNeedLabel: NEED_LABELS[need.id],
      needSentence: need.sentence,
      reasons: ['问题具体、出现频率稳定', '评测信息与核心清洁场景一致'],
      reviewSummary: summary,
      alternatives: [],
      nextStep: '按原定预算购买，不为用不到的功能加价。',
      cooldownHours: 0,
      createdAt: Date.now()
    }
  }

  return {
    id: String(Date.now()),
    productText,
    verdict: 'wait',
    verdictLabel: '先验证，再决定',
    confidence: hasReview ? 'high' : 'medium',
    confidenceLabel: hasReview ? '高' : '中',
    primaryNeedId: need.id,
    primaryNeedLabel: NEED_LABELS[need.id],
    needSentence: need.sentence,
    reasons: hasReview
      ? ['需求已经清楚，但当前商品是否是最短路径仍不确定']
      : ['没有可核对的评测，不能诚实地给出购买结论'],
    reviewSummary: summary,
    alternatives: [],
    nextStep: '先借、租或线下体验一次；做不到就冷却 48 小时。',
    cooldownHours: 48,
    createdAt: Date.now()
  }
}

const CalmBuyJudge = {
  QUESTIONS,
  inferNeed,
  createResult
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalmBuyJudge
}

if (typeof window !== 'undefined') {
  window.CalmBuyJudge = CalmBuyJudge
}
})()
