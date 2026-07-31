function buildClientFallback(productText, messages, errorCode = 'NETWORK_ERROR') {
  const lastAnswer = [...messages].reverse().find((message) => message.role === 'user')?.content
  const evidenceQuotes = [
    `我想买：${productText}`,
    lastAnswer || '还没有补充具体使用场景'
  ]

  return {
    mode: 'fallback',
    error: { code: errorCode },
    assistantMessage: '现在连不上智能分析。先别猜答案，冷却 48 小时，再记录一次真实需要它的场景。',
    phase: 'done',
    draft: {
      productName: productText,
      rootNeed: '目前信息不足，先验证真实使用需求',
      primaryNeedId: 'novelty',
      evidenceQuotes,
      missingDimensions: ['真实场景', '使用频率', '当前替代方案'],
      readiness: 0.2,
      userConfirmedNeed: false
    },
    result: {
      verdict: 'wait',
      confidence: 'low',
      needSentence: '先确认它是否解决一个会重复出现的真实问题',
      primaryNeedId: 'novelty',
      matchScore: 'low',
      rootNeed: '目前信息不足，先验证真实使用需求',
      needDecomposition: {
        functional: '',
        emotional: '',
        social: '',
        constraints: [],
        successCriterion: ''
      },
      evidenceQuotes,
      reasons: ['当前未连接智能分析，不能可靠判断。', '还缺真实场景、频率和替代方案信息。'],
      minimumExperiment: {
        title: '记录一次真实需求',
        action: '未来 48 小时内，只记录具体需要它的时刻，不继续刷评测或价格。',
        duration: '48 小时'
      },
      alternatives: [],
      candidateProducts: [],
      nextStep: '48 小时后带着真实场景重新分析。',
      cooldownHours: 48
    }
  }
}

module.exports = { buildClientFallback }
