const { analyzeResponseSchema } = require('./schema')

const RESTRICTED_CATEGORIES = [
  {
    id: 'medical',
    label: '医疗与药品',
    pattern: /处方药|非处方药|药品|买药|减肥药|保健药|布洛芬|阿司匹林|褪黑素|抗生素|医疗器械|治疗仪|血糖仪|血压计|诊断|手术|医美项目/
  },
  {
    id: 'financial',
    label: '投资与高风险金融产品',
    pattern: /股票|基金|期货|外汇|加密货币|虚拟币|理财产品|投资项目|保险(?:产品|计划|合同|理财|年金)|投保|博彩|彩票|赌博/
  },
  {
    id: 'illegal',
    label: '违法或受管制商品',
    pattern: /毒品|枪支|弹药|管制刀具|假证|窃听器|违禁品/
  }
]

function restrictedCategory(productText = '') {
  return RESTRICTED_CATEGORIES.find((item) => item.pattern.test(String(productText))) || null
}

function looksAmbiguous(productText = '') {
  const text = String(productText).trim()
  return /^(新|那个|一个|某个|想买)?(手机|电脑|课程|会员|保险|车|相机|耳机|鞋|衣服|家电|礼物)$/.test(text)
}

function buildAmbiguousResponse(request) {
  return analyzeResponseSchema.parse({
    assistantMessage: '你考虑的是哪个具体对象或价格范围？',
    phase: 'clarify_need',
    inputType: 'choice',
    options: ['已有品牌或型号', '只确定了品类', '我想自己补充'],
    progress: { current: 1, total: 3, label: '确认购买对象' },
    draft: {
      productName: request.productText,
      rootNeed: '确认具体购买对象后再拆真实需求',
      readiness: 0.1
    },
    result: null
  })
}

function buildRestrictedResponse(request, category) {
  const quote = `我想买：${request.productText}`
  return analyzeResponseSchema.parse({
    assistantMessage: `这属于${category.label}，Calm Buy 不提供购买判断。`,
    phase: 'done',
    inputType: 'none',
    options: [],
    progress: { current: 1, total: 1, label: '能力边界' },
    draft: {
      productName: request.productText,
      rootNeed: '获得适合自身情况的专业、安全建议',
      primaryNeedId: 'utility',
      evidenceQuotes: [quote],
      missingDimensions: ['需要由具备资质的专业人士评估'],
      readiness: 0.2,
      userConfirmedNeed: false
    },
    result: {
      verdict: 'wait',
      confidence: 'low',
      needClarity: 'low',
      evidenceQuality: 'low',
      safetyBoundary: true,
      boundaryReason: `涉及${category.label}，通用消费建议不能替代专业判断。`,
      needSentence: '获得适合自身情况的专业、安全建议',
      primaryNeedId: 'utility',
      matchScore: 'low',
      rootNeed: '获得适合自身情况的专业、安全建议',
      needDecomposition: {
        functional: '确认风险、适用性和合规购买渠道',
        emotional: '',
        social: '',
        constraints: ['需要专业资质与个体情况评估'],
        successCriterion: '从医生、持牌顾问或官方机构获得可核验建议'
      },
      evidenceQuotes: [quote],
      reasons: [
        `该对象属于${category.label}，错误建议可能带来明显风险。`,
        'Calm Buy 只提供一般消费决策辅助，不具备相应专业资质。'
      ],
      marketSnapshot: {},
      minimumExperiment: null,
      alternatives: [],
      candidateProducts: [],
      nextStep: category.id === 'medical'
        ? '咨询医生、药师或正规医疗机构。'
        : category.id === 'financial'
          ? '咨询持牌顾问并查阅监管机构公开信息。'
          : '停止交易，并通过官方渠道核实是否合法。',
      cooldownHours: 0
    }
  })
}

module.exports = {
  buildAmbiguousResponse,
  buildRestrictedResponse,
  looksAmbiguous,
  restrictedCategory
}
