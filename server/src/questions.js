const SELF_SUPPLEMENT_OPTION = '我想自己补充'

const DECISION_TIERS = ['trivial', 'standard', 'major']

/**
 * 决策量级决定该问几轮：几块钱的快消不值得盘问，几万块的大件才需要慢慢拆。
 * skipConfirm=true 时跳过“我理解你想要的是 X，对吗”这一步，直接出结论。
 */
const TIER_PLANS = {
  trivial: {
    maxQuestions: 1,
    minQuestionsBeforeConfirm: 1,
    readinessThreshold: 0.35,
    minEvidence: 1,
    skipConfirm: true,
    label: '小额低风险'
  },
  standard: {
    maxQuestions: 3,
    minQuestionsBeforeConfirm: 3,
    readinessThreshold: 0.6,
    minEvidence: 2,
    skipConfirm: false,
    label: '中等决策'
  },
  major: {
    maxQuestions: 5,
    minQuestionsBeforeConfirm: 4,
    readinessThreshold: 0.7,
    minEvidence: 2,
    skipConfirm: false,
    label: '大额长期决策'
  }
}

const TIER_GUIDE = `决策量级不能只看价格，还要综合使用周期、退换难度、空间占用与长期承诺：
- trivial：低价、短期、易退换、不占空间、几乎没有持续承诺（泡面、饮料、纸巾、小工具）。
- standard：中等支出或会使用数月至数年，但通常可退换、转卖或停止使用（耳机、小家电、服饰、键盘）。
- major：高价，或长期持有、难退换、明显占空间/时间、有持续付费或机会成本（车、电脑、家具、课程、会员年卡）。
即使价格不高，只要长期承诺或退出成本高，也应提高量级；高价但可无损退换，只能作为初始锚点。`

const FALLBACK_QUESTIONS = {
  trivial: [
    {
      message: '这次是解决一个具体需要，还是纯粹想尝个鲜？',
      options: ['有具体需要', '想尝个鲜', '囤着备用'],
      label: '快速定性'
    }
  ],
  standard: [
    {
      message: '抛开这件商品，你最想解决的具体麻烦是什么？',
      options: ['现有的东西不好用', '想做一件现在做不到的事', '主要是想体验一下'],
      label: '锁定真实需求'
    },
    {
      message: '这个问题一般什么时候会出现？',
      options: ['几乎每天都会碰到', '一周几次', '偶尔才有'],
      label: '确认发生场景'
    },
    {
      message: '现在你是怎么对付的，最卡在哪一步？',
      options: ['有办法但不好用', '基本没有办法', '其实还能凑合'],
      label: '找出真实缺口'
    }
  ],
  major: [
    {
      message: '抛开这件商品，你最想解决的具体麻烦是什么？',
      options: ['替换现在不好用的东西', '想开始一件现在做不到的事', '暂时说不好'],
      label: '锁定真实需求'
    },
    {
      message: '这个问题大概多久出现一次？',
      options: ['几乎每天', '每周几次', '一个月都不一定碰到'],
      label: '确认发生频率'
    },
    {
      message: '现在你用什么顶着，具体卡在哪一步？',
      options: ['有旧的，性能不够', '有旧的，坏了', '完全没有'],
      label: '找出真实缺口'
    },
    {
      message: '预算上你更接近哪种想法？',
      options: ['已经想好上限', '还在比价', '价格不是主要顾虑'],
      label: '确认预算取向'
    },
    {
      message: '如果现在不买，最坏会怎样？',
      options: ['会一直影响我', '有点难受但能忍', '其实没什么影响'],
      label: '测试迫切度'
    }
  ]
}

/** 行为信号显示用户正在冲动时，多留一轮追问的余地 */
const HIGH_IMPULSE_THRESHOLD = 60

function resolveTier(tier) {
  return DECISION_TIERS.includes(tier) ? tier : 'standard'
}

/** 决策量级本质上是价格问题。有真实报价时就别让模型靠商品名猜。 */
function tierFromPrice(value) {
  const price = Number(value)
  if (!Number.isFinite(price) || price <= 0) return null
  if (price < 100) return 'trivial'
  if (price <= 3000) return 'standard'
  return 'major'
}

/**
 * 检索到的价格中位数优先于模型判断：模型只看得到商品名，
 * 「未来眼镜」既可能是 99 块的玩具也可能是两万块的头显。
 * 只在首轮定档，之后跟着 draft 走，避免中途改判导致提问轮数上限突变。
 * 要求至少两个报价，单个游离数字不足以决定一次决策的量级。
 */
function anchoredTier(modelTier, searchEvidence) {
  const anchor = searchEvidence?.priceAnchor
  const anchored = anchor && anchor.count >= 2 ? tierFromPrice(anchor.median) : null
  if (!anchored) return resolveTier(modelTier)
  if (!DECISION_TIERS.includes(modelTier)) return anchored
  return DECISION_TIERS.indexOf(modelTier) > DECISION_TIERS.indexOf(anchored)
    ? modelTier
    : anchored
}

function resolvePlan(tier, temperature = 0) {
  const base = TIER_PLANS[resolveTier(tier)]
  // 小额决策不加：泡面就算是凌晨第三次搜，也不值得多盘问一轮
  if (base.skipConfirm || Number(temperature) < HIGH_IMPULSE_THRESHOLD) return base
  return {
    ...base,
    maxQuestions: Math.min(6, base.maxQuestions + 1),
    minQuestionsBeforeConfirm: Math.min(6, base.minQuestionsBeforeConfirm + 1)
  }
}

function planForRequest(request = {}) {
  return resolvePlan(
    request.draft?.decisionTier || anchoredTier(null, request.searchEvidence),
    request.impulse?.temperature
  )
}

/** 本轮是否必须直接给最终建议：用户已确认，或小额决策问满了轮数 */
function isFinalRound(request = {}) {
  if (request.confirmation === true) return true
  const plan = planForRequest(request)
  return plan.skipConfirm && (request.questionCount || 0) >= plan.maxQuestions
}

const TRIVIAL_PRODUCT_RE = /泡面|方便面|饮料|矿泉水|可乐|奶茶|咖啡豆|面包|零食|辣条|薯片|饼干|糖果|口香糖|火腿肠|袜子|内裤|纸巾|抽纸|卫生巾|牙膏|牙刷|洗发水|沐浴露|洗衣液|垃圾袋|保鲜袋|一次性|数据线|充电线|笔芯|便利贴/

function looksTrivialProduct(productText = '') {
  return TRIVIAL_PRODUCT_RE.test(String(productText))
}

/**
 * 需要调研时先搜再问：非 trivial 商品的第一轮、以及最终建议轮。
 * 中间澄清轮不再搜，避免把额度耗在追问上。
 */
function shouldResearchNow(request = {}) {
  if (isFinalRound(request)) return true
  if ((request.questionCount || 0) > 0) return false
  if (request.draft?.decisionTier === 'trivial') return false
  if (looksTrivialProduct(request.productText)) return false
  if (looksAmbiguousProduct(request.productText)) return false
  return Boolean(String(request.productText || '').trim())
}

function looksAmbiguousProduct(productText = '') {
  const text = String(productText).trim()
  if (!text || text.length < 2) return true
  return /^(新|那个|一个|某个|想买)?(手机|电脑|课程|会员|保险|药|车|相机|耳机|鞋|衣服|家电|礼物)$/.test(text)
}

function withSelfSupplement(options = []) {
  const cleaned = options
    .filter((item) => typeof item === 'string' && item.trim() && item.trim() !== SELF_SUPPLEMENT_OPTION)
    .map((item) => item.trim())
    .slice(0, 3)
  return [...cleaned, SELF_SUPPLEMENT_OPTION]
}

function pickFollowUp(questionCount, tier) {
  const pool = FALLBACK_QUESTIONS[resolveTier(tier)]
  const index = Math.min(Math.max(questionCount, 0), pool.length - 1)
  const followUp = pool[index]
  return {
    ...followUp,
    options: withSelfSupplement(followUp.options)
  }
}

/** rootNeed 如果只是在复述商品名，就还没拆到真实需求 */
function isProductRestatement(rootNeed, productText) {
  const need = String(rootNeed || '').trim()
  const product = String(productText || '').trim()
  if (!need || need.length < 6) return true
  if (/待确认|购买目标|就是买|想买这|入手这/.test(need)) return true
  const compactNeed = need.replace(/[\s，。、！!？?的了呢吗啊]/g, '')
  const compactProduct = product.replace(/[\s，。、！!？?的了呢吗啊]/g, '')
  if (compactProduct.length >= 2 && compactNeed.includes(compactProduct) && /^想?买|^购买|^入手|^拥有/.test(need)) {
    return true
  }
  return false
}

function needDiscoveryComplete(draft = {}, productText = '', tier = 'standard') {
  if (resolveTier(tier) === 'trivial') return true
  const hasOutcome = Boolean(String(draft.desiredOutcome || draft.functionalNeed || '').trim())
  const hasScene = Boolean(String(draft.scene || '').trim())
  const hasGap = Boolean(String(draft.gap || draft.currentAlternative || '').trim())
  return hasOutcome && hasScene && hasGap && !isProductRestatement(draft.rootNeed, productText)
}

function pickNeedFollowUp(draft = {}, productText = '', questionCount = 0, tier = 'standard') {
  if (!String(draft.desiredOutcome || draft.functionalNeed || '').trim()
    || isProductRestatement(draft.rootNeed, productText)) {
    return {
      message: '抛开这件商品，你最想解决的具体麻烦是什么？',
      options: withSelfSupplement(['现有的东西不好用', '想做一件现在做不到的事', '主要是想体验一下']),
      label: '锁定真实需求'
    }
  }
  if (!String(draft.scene || '').trim()) {
    return {
      message: '这个问题一般什么时候会出现？',
      options: withSelfSupplement(['几乎每天都会碰到', '一周几次', '偶尔才有']),
      label: '确认发生场景'
    }
  }
  if (!String(draft.gap || draft.currentAlternative || '').trim()) {
    return {
      message: '现在你是怎么对付的，最卡在哪一步？',
      options: withSelfSupplement(['有办法但不好用', '基本没有办法', '其实还能凑合']),
      label: '找出真实缺口'
    }
  }
  const dimension = nextOpenDimension(draft)
  if (dimension) {
    return {
      message: `在「${dimension}」上，你的实际要求接近哪种？`,
      options: withSelfSupplement(['必须做到位', '够用就行', '其实没太在意']),
      label: `确认${dimension}`
    }
  }
  return pickFollowUp(questionCount, tier)
}

/** 三件套齐了以后，追问该瞄准这个品类真正决定买错买对的维度，而不是继续套通用模板 */
function nextOpenDimension(draft = {}) {
  const asked = new Set(
    (Array.isArray(draft.askedDimensions) ? draft.askedDimensions : [])
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
  )
  return (Array.isArray(draft.keyDimensions) ? draft.keyDimensions : [])
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .find((item) => !asked.has(item)) || ''
}

module.exports = {
  TIER_GUIDE,
  anchoredTier,
  isFinalRound,
  looksTrivialProduct,
  looksAmbiguousProduct,
  isProductRestatement,
  needDiscoveryComplete,
  nextOpenDimension,
  pickFollowUp,
  pickNeedFollowUp,
  planForRequest,
  resolvePlan,
  resolveTier,
  shouldResearchNow,
  tierFromPrice,
  withSelfSupplement
}
