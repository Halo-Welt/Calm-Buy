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

function shortProductName(productText = '') {
  const name = String(productText || '')
    .replace(/^我想买[:：]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return name.slice(0, 18) || '这件东西'
}

function searchHaystack(searchEvidence) {
  return (searchEvidence?.items || [])
    .map((item) => `${item.title || ''} ${item.content || ''}`)
    .join(' ')
    .slice(0, 800)
}

const GENERIC_PACK = {
  id: 'generic',
  outcome: {
    message: (name) => `${name}你最想先解决哪件事？`,
    options: () => ['现有的撑不住了', '想做现在做不到的事', '先体验一下'],
    label: '锁定真实需求'
  },
  scene: {
    message: (name) => `你通常什么时候会用到${name}？`,
    options: () => ['几乎每天', '一周几次', '偶尔才用'],
    label: '确认发生场景'
  },
  gap: {
    message: (name) => `没有${name}的时候，你现在怎么对付？`,
    options: () => ['有旧的但不好用', '基本没有办法', '其实还能凑合'],
    label: '找出真实缺口'
  },
  budget: {
    message: (name) => `${name}预算上你更接近哪种？`,
    options: () => ['已经想好上限', '还在比价', '价格不是主要顾虑'],
    label: '确认预算取向'
  },
  urgency: {
    message: (name) => `如果现在不买${name}，最坏会怎样？`,
    options: () => ['会一直影响我', '有点难受但能忍', '其实没什么影响'],
    label: '测试迫切度'
  }
}

const CATEGORY_PACKS = [
  {
    id: 'chair',
    re: /椅|座椅|沙发|embody|aeron|人体工学/,
    outcome: {
      message: (name) => `${name}你最想先解决哪件事？`,
      options: () => ['久坐腰酸背痛', '坐姿和腰托撑不住', '旧椅已经快散架'],
      label: '椅子真实需求'
    },
    scene: {
      message: () => '这把椅一天大概要坐多久？',
      options: () => ['工作日坐满八小时', '每天坐几小时', '偶尔坐坐'],
      label: '久坐时长'
    },
    gap: {
      message: () => '现在这张椅最卡在哪？',
      options: () => ['没有腰托或撑不住', '尺寸高度不对', '其实还能凑合'],
      label: '旧椅缺口'
    }
  },
  {
    id: 'camera',
    re: /相机|微单|单反|镜头|a7c|a7m|z6|z8|r5|r6|gopro|运动相机/,
    outcome: {
      message: (name) => `${name}你最想拍清楚什么？`,
      options: () => ['人像和旅行记录', '工作和创作素材', '先体验一下器材'],
      label: '拍摄真实需求'
    },
    scene: {
      message: () => '这些照片主要会在哪拍？',
      options: () => ['出门旅行和街拍', '室内棚拍或固定场景', '偶尔才拿出来'],
      label: '拍摄场景'
    },
    gap: {
      message: () => '现在这套器材最卡在哪？',
      options: () => ['画质或暗光不够', '太重带不走', '其实手机也能凑合'],
      label: '器材缺口'
    }
  },
  {
    id: 'headphones',
    re: /耳机|耳塞|降噪|xm5|xm4|airpods|头戴/,
    outcome: {
      message: (name) => `${name}你最想挡掉的是哪种声音？`,
      options: () => ['地铁飞机的轰鸣', '办公室人声', '夜里别人的动静'],
      label: '降噪真实需求'
    },
    scene: {
      message: () => '这副耳机一天大概戴多久？',
      options: () => ['通勤几乎全程戴', '工作时戴几小时', '偶尔戴戴'],
      label: '佩戴时长'
    },
    gap: {
      message: () => '现在这副耳机最卡在哪？',
      options: () => ['漏音或降噪不够', '夹头戴不久', '其实还能凑合'],
      label: '旧耳机缺口'
    }
  },
  {
    id: 'laptop',
    re: /笔记本|电脑|macbook|thinkpad|轻薄本|游戏本/,
    outcome: {
      message: (name) => `${name}你最想先解决哪件事？`,
      options: () => ['现在这台又卡又慢', '要出门带着干活', '先换新体验一下'],
      label: '电脑真实需求'
    },
    scene: {
      message: () => '这台电脑主要在哪用？',
      options: () => ['每天办公或上课', '出门差旅带着', '偶尔在家用用'],
      label: '使用场景'
    },
    gap: {
      message: () => '现在这台电脑最卡在哪？',
      options: () => ['性能或续航不够', '屏幕或接口不对', '其实还能凑合'],
      label: '旧电脑缺口'
    }
  },
  {
    id: 'vacuum',
    re: /吸尘器|扫地机|洗地机|除螨/,
    outcome: {
      message: (name) => `${name}你最想先解决哪块脏？`,
      options: () => ['地板毛发灰尘', '沙发床品除螨', '先体验一下新品'],
      label: '清洁真实需求'
    },
    scene: {
      message: () => '家里大概多久需要清一次？',
      options: () => ['几乎每天都要扫', '一周两三次', '偶尔才扫'],
      label: '清洁频率'
    },
    gap: {
      message: () => '现在这套清洁工具最卡在哪？',
      options: () => ['吸力或边角扫不干净', '太重懒得拿', '其实还能凑合'],
      label: '旧工具缺口'
    }
  },
  {
    id: 'car',
    re: /汽车|轿车|SUV|新能源|特斯拉|tesla|model\s?[3y]/i,
    outcome: {
      message: (name) => `${name}你最想先解决哪件事？`,
      options: () => ['通勤代步更省事', '家人出行更从容', '先体验一下新车'],
      label: '用车真实需求'
    },
    scene: {
      message: () => '这台车一周大概开几次？',
      options: () => ['工作日几乎天天开', '周末才开', '一个月用不了几次'],
      label: '用车频率'
    },
    gap: {
      message: () => '现在出行最卡在哪？',
      options: () => ['没车或旧车撑不住', '空间油耗不对', '其实还能凑合'],
      label: '出行缺口'
    }
  },
  {
    id: 'phone',
    re: /手机|iphone|华为|小米|pixel|galaxy/,
    outcome: {
      message: (name) => `${name}你最想先解决哪件事？`,
      options: () => ['旧机卡顿续航不行', '拍照或屏幕不够用', '先换新体验一下'],
      label: '换机真实需求'
    },
    scene: {
      message: () => '这台手机一天大概握多久？',
      options: () => ['几乎不离手', '工作和通勤在用', '偶尔看看'],
      label: '使用强度'
    },
    gap: {
      message: () => '现在这台手机最卡在哪？',
      options: () => ['卡顿或续航不够', '相机屏幕不满意', '其实还能凑合'],
      label: '旧机缺口'
    }
  },
  {
    id: 'course',
    re: /课|培训|会员年卡|训练营|辅导/,
    outcome: {
      message: (name) => `${name}你最想先拿到哪项结果？`,
      options: () => ['工作里马上用得上', '系统补一块能力', '先体验一下内容'],
      label: '学习真实需求'
    },
    scene: {
      message: () => '你每周能稳定拿出多少时间学？',
      options: () => ['每周能拿出整块时间', '只能碎片时间', '还没排上'],
      label: '投入时间'
    },
    gap: {
      message: () => '没有这门课的时候，你现在怎么学？',
      options: () => ['有免费资料但学不动', '完全没有路径', '其实还能自学'],
      label: '学习缺口'
    }
  }
]

function matchCategoryPack(productText = '', searchEvidence) {
  const hay = `${productText} ${searchHaystack(searchEvidence)}`
  return CATEGORY_PACKS.find((pack) => pack.re.test(hay)) || GENERIC_PACK
}

function packQuestion(slot, name) {
  return {
    message: slot.message(name),
    options: withSelfSupplement(slot.options(name)),
    label: slot.label
  }
}

function slotsForTier(pack, tier) {
  const resolved = resolveTier(tier)
  if (resolved === 'trivial') return [pack.outcome || GENERIC_PACK.outcome]
  const extras = resolved === 'major'
    ? [pack.budget || GENERIC_PACK.budget, pack.urgency || GENERIC_PACK.urgency]
    : []
  return [
    pack.outcome || GENERIC_PACK.outcome,
    pack.scene || GENERIC_PACK.scene,
    pack.gap || GENERIC_PACK.gap,
    ...extras
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

function pickFollowUp(questionCount, tier, productText = '', searchEvidence) {
  const name = shortProductName(productText)
  const pool = slotsForTier(matchCategoryPack(productText, searchEvidence), tier)
  const index = Math.min(Math.max(questionCount, 0), pool.length - 1)
  return packQuestion(pool[index], name)
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

function pickNeedFollowUp(draft = {}, productText = '', questionCount = 0, tier = 'standard', searchEvidence) {
  const name = shortProductName(productText)
  const pack = matchCategoryPack(productText, searchEvidence)
  if (!String(draft.desiredOutcome || draft.functionalNeed || '').trim()
    || isProductRestatement(draft.rootNeed, productText)) {
    return packQuestion(pack.outcome || GENERIC_PACK.outcome, name)
  }
  if (!String(draft.scene || '').trim()) {
    return packQuestion(pack.scene || GENERIC_PACK.scene, name)
  }
  if (!String(draft.gap || draft.currentAlternative || '').trim()) {
    return packQuestion(pack.gap || GENERIC_PACK.gap, name)
  }
  const dimension = nextOpenDimension(draft)
  if (dimension) {
    return {
      message: `对${name}来说，「${dimension}」你更在意哪种？`,
      options: withSelfSupplement(['必须做到位', '够用就行', '其实没太在意']),
      label: `确认${dimension}`
    }
  }
  return pickFollowUp(questionCount, tier, productText, searchEvidence)
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
  matchCategoryPack,
  needDiscoveryComplete,
  nextOpenDimension,
  pickFollowUp,
  pickNeedFollowUp,
  planForRequest,
  resolvePlan,
  resolveTier,
  shouldResearchNow,
  shortProductName,
  tierFromPrice,
  withSelfSupplement
}
