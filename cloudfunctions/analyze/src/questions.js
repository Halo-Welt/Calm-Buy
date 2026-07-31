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
    minQuestionsBeforeConfirm: 2,
    readinessThreshold: 0.6,
    minEvidence: 2,
    skipConfirm: false,
    label: '中等决策'
  },
  major: {
    maxQuestions: 5,
    minQuestionsBeforeConfirm: 3,
    readinessThreshold: 0.7,
    minEvidence: 2,
    skipConfirm: false,
    label: '大额长期决策'
  }
}

const TIER_GUIDE = `- trivial：单价约 100 元以内、快消/日用/一次性、买错几乎无成本（泡面、饮料、袜子、纸巾、九块九小工具）。
- standard：单价约 100–3000 元，会用上几个月到两三年，买错也就是闲置（耳机、小家电、衣服鞋子、键盘、行李箱、平板配件）。
- major：单价约 3000 元以上，或长期持有、占空间、有明显机会成本（车、房、手机、电脑、相机、家具、乐器、长期课程或健身年卡）。`

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
      message: '你打算在什么场景下用它？',
      options: ['经常会用到的固定场景', '偶尔用一下', '暂时说不好'],
      label: '确认使用场景'
    },
    {
      message: '现在你是怎么应付这件事的，哪里最不顺手？',
      options: ['有替代方案但不好用', '基本没有替代方案', '其实还能凑合'],
      label: '找出真实缺口'
    },
    {
      message: '预算上你更接近哪种想法？',
      options: ['一步到位买好的', '够用就行', '想找更便宜的替代'],
      label: '确认预算取向'
    }
  ],
  major: [
    {
      message: '你希望它帮你解决的最主要的一件事是什么？',
      options: ['替换现在不好用的东西', '开启一个新的用途', '暂时说不好'],
      label: '锁定核心目标'
    },
    {
      message: '大概多久会用到一次？',
      options: ['几乎每天', '每周几次', '一个月都不一定用上'],
      label: '确认使用频率'
    },
    {
      message: '现在你用什么顶着，具体卡在哪一步？',
      options: ['有旧的，性能不够', '有旧的，坏了', '完全没有'],
      label: '找出真实缺口'
    },
    {
      message: '预算区间大概是多少？',
      options: ['已经想好上限', '还在比价', '价格不是主要顾虑'],
      label: '确认预算区间'
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
  return resolvePlan(request.draft?.decisionTier, request.impulse?.temperature)
}

/** 本轮是否必须直接给最终建议：用户已确认，或小额决策问满了轮数 */
function isFinalRound(request = {}) {
  if (request.confirmation === true) return true
  const plan = planForRequest(request)
  return plan.skipConfirm && (request.questionCount || 0) >= plan.maxQuestions
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

module.exports = {
  TIER_GUIDE,
  isFinalRound,
  pickFollowUp,
  planForRequest,
  resolvePlan,
  resolveTier,
  withSelfSupplement
}
