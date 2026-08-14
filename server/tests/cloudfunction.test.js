const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

/**
 * 云函数是真机唯一能走的路径，但它的 index.js 跑不到本地 http 测试里，
 * 曾经整条联网搜索没接上都没人发现。这里桩掉 wx-server-sdk 和 fetch，
 * 不打真实网络地验证它的接线。
 */

const usage = new Map()
const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  init() {},
  getWXContext: () => ({ OPENID: 'openid_test' }),
  uploadFile: async ({ cloudPath }) => ({ fileID: `cloud://test/${cloudPath}` }),
  database: () => ({
    command: { inc: (step) => step },
    serverDate: () => new Date(),
    runTransaction: async (handler) => handler({ collection: () => ({ doc: makeDoc }) })
  })
}

function makeDoc(id) {
  return {
    get: async () => {
      if (!usage.has(id)) {
        const error = new Error('document.get:fail document does not exist')
        error.errMsg = 'document.get:fail document does not exist'
        throw error
      }
      return { data: usage.get(id) }
    },
    update: async () => usage.set(id, { count: usage.get(id).count + 1 }),
    set: async () => usage.set(id, { count: 1 })
  }
}

const originalLoad = Module._load
Module._load = function load(request, ...rest) {
  if (request === 'wx-server-sdk') return cloudStub
  return originalLoad.call(this, request, ...rest)
}

process.env.DEEPSEEK_API_KEY = 'test-key'
process.env.TAVILY_API_KEY = 'test-search-key'
process.env.SEARCH_PROVIDER = 'tavily'

const cloudFunction = require(
  path.join(__dirname, '..', '..', 'cloudfunctions', 'analyze', 'index.js')
)

const MODEL_RESULT = {
  assistantMessage: '这个价位不用纠结，想吃就买。',
  phase: 'done',
  inputType: 'none',
  options: [],
  progress: { current: 1, total: 1, label: '完成' },
  draft: {
    productName: '一箱泡面',
    decisionTier: 'trivial',
    rootNeed: '半夜想吃口热的',
    primaryNeedId: 'emotion',
    evidenceQuotes: ['就是馋了'],
    readiness: 0.8
  },
  result: {
    verdict: 'buy',
    confidence: 'high',
    needSentence: '半夜想吃口热的',
    primaryNeedId: 'emotion',
    matchScore: 'high',
    rootNeed: '半夜想吃口热的',
    needDecomposition: { functional: '', emotional: '想吃', social: '', constraints: [], successCriterion: '' },
    evidenceQuotes: ['就是馋了'],
    reasons: ['单价很低，买错几乎没有成本'],
    marketSnapshot: { priceRange: '约 35–70 元', reputation: '常见口味评价稳定', watchOuts: [] },
    minimumExperiment: null,
    alternatives: [],
    candidateProducts: [],
    nextStep: '直接下单',
    cooldownHours: 0
  }
}

const MODEL_QUESTION = {
  assistantMessage: '你主要在什么场景下用它？',
  phase: 'clarify_need',
  inputType: 'choice',
  options: ['通勤路上', '办公室', '家里'],
  progress: { current: 1, total: 3, label: '确认场景' },
  draft: {
    productName: '降噪耳机',
    decisionTier: 'standard',
    rootNeed: '通勤时安静一点',
    readiness: 0.3,
    evidenceQuotes: []
  },
  result: null
}

let searchCalls = 0
let deepSeekCalls = 0
let modelOutput = MODEL_RESULT
/** 单个用例可以覆盖检索返回，用来验证价格锚点这类依赖真实报价的逻辑 */
let searchResults = null

function jsonResponse(body, extra = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => extra.headers?.[String(name).toLowerCase()] || extra.headers?.[name] || '' },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => extra.buffer || Buffer.from(JSON.stringify(body))
  }
}

global.fetch = async (url) => {
  const href = String(url)
  if (href.includes('tavily')) {
    searchCalls += 1
    if (searchResults) return jsonResponse(searchResults)
    return jsonResponse({
      results: [{
        title: '泡面选购指南',
        url: 'https://example.com/noodle',
        content: '常见箱装售价约 35 到 70 元',
        score: 0.9
      }],
      images: ['https://cdn.example.com/headphone.jpg']
    })
  }

  if (href.includes('cdn.example.com')) {
    return jsonResponse({}, {
      headers: { 'content-type': 'image/jpeg' },
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    })
  }

  deepSeekCalls += 1
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify(modelOutput) } }]
  })
}

function payload(overrides = {}) {
  return {
    requestId: 'request_cloud0001',
    sessionId: 'session_cloud0001',
    productText: '一箱泡面',
    messages: [
      { role: 'user', content: '我想买：一箱泡面' },
      { role: 'assistant', content: '这次是解决具体需要还是想尝鲜？' },
      { role: 'user', content: '就是馋了' }
    ],
    phase: 'clarify_need',
    questionCount: 1,
    draft: { decisionTier: 'trivial' },
    ...overrides
  }
}

test('健康检查如实反映 DeepSeek 与搜索的配置状态', async () => {
  const response = await cloudFunction.main({ action: 'health' })
  assert.equal(response.ok, true)
  assert.equal(response.data.deepseekConfigured, true)
  assert.equal(response.data.searchEnabled, true)
  assert.equal(response.data.tavilyConfigured, true)
})

test('不符合约定的请求被拒绝，不会打到模型', async () => {
  const before = deepSeekCalls
  const response = await cloudFunction.main({ payload: { requestId: 'too-short' } })
  assert.equal(response.ok, false)
  assert.equal(response.error.code, 'INVALID_REQUEST')
  assert.equal(deepSeekCalls, before)
})

test('最终轮会联网检索，并把来源带回给前端', async () => {
  searchCalls = 0
  const response = await cloudFunction.main({ payload: payload() })

  assert.equal(response.ok, true)
  assert.equal(response.data.phase, 'done')
  assert.equal(response.data.mode, 'live')
  assert.ok(searchCalls > 0, '最终轮必须真的发起检索')
  assert.equal(response.data.searchUsed, true)
  assert.equal(response.data.searchProvider, 'tavily')
  assert.ok(response.data.searchSources.length > 0)
  assert.equal(response.data.result.marketSnapshot.priceRange, '约 35–70 元')
  assert.equal(response.data.result.confidence, 'high')
})

test('追问轮不检索，也不谎报价格', async (t) => {
  modelOutput = MODEL_QUESTION
  t.after(() => { modelOutput = MODEL_RESULT })
  searchCalls = 0

  const response = await cloudFunction.main({
    payload: payload({
      productText: '降噪耳机',
      questionCount: 1,
      draft: { decisionTier: 'standard' },
      messages: [
        { role: 'user', content: '我想买：降噪耳机' },
        { role: 'assistant', content: '抛开这件商品，你最想解决的具体麻烦是什么？' },
        { role: 'user', content: '通勤时太吵了' }
      ]
    })
  })

  assert.equal(searchCalls, 0, '追问阶段不该消耗检索额度')
  assert.equal(response.data.searchUsed, false)
  assert.equal(response.data.phase, 'clarify_need')
  assert.equal(response.data.result, null)
})

test('有明确商品的首轮会检索，并把配图带回', async (t) => {
  modelOutput = MODEL_QUESTION
  t.after(() => { modelOutput = MODEL_RESULT })
  searchCalls = 0

  const response = await cloudFunction.main({
    payload: payload({
      productText: '降噪耳机',
      questionCount: 0,
      draft: { decisionTier: 'standard' },
      messages: [{ role: 'user', content: '我想买：降噪耳机' }]
    })
  })

  assert.ok(searchCalls > 0, '首轮对非快消商品必须先检索')
  assert.equal(response.data.searchUsed, true)
  assert.equal(response.data.phase, 'clarify_need')
  assert.equal(response.data.images.length, 1)
  assert.match(response.data.images[0].url, /^cloud:\/\//)
})

test('冲动温度会随请求进入云函数并放宽一轮追问', async (t) => {
  modelOutput = MODEL_QUESTION
  t.after(() => { modelOutput = MODEL_RESULT })

  const calm = await cloudFunction.main({
    payload: payload({
      productText: '降噪耳机',
      questionCount: 0,
      draft: { decisionTier: 'standard' },
      messages: [{ role: 'user', content: '我想买：降噪耳机' }]
    })
  })
  assert.equal(calm.data.progress.total, 3)

  const hot = await cloudFunction.main({
    payload: payload({
      productText: '降噪耳机',
      questionCount: 0,
      draft: { decisionTier: 'standard' },
      messages: [{ role: 'user', content: '我想买：降噪耳机' }],
      impulse: { temperature: 83, signals: ['两周内你已经查过它 2 次，这是第 3 次'] }
    })
  })
  assert.equal(hot.data.progress.total, 4)
})

test('首轮按检索到的真实报价定档，模型判错也会被纠正', async (t) => {
  modelOutput = {
    ...MODEL_QUESTION,
    draft: undefined,
    draftPatch: { rootNeed: '在家躺着看大屏', readiness: 0.3, decisionTier: 'trivial' }
  }
  searchResults = {
    results: [
      { title: '京东报价', url: 'https://item.jd.com/1.html', content: '售价 19800 元' },
      { title: '天猫', url: 'https://detail.tmall.com/2.html', content: '到手 20800 元' }
    ],
    images: []
  }
  t.after(() => {
    modelOutput = MODEL_RESULT
    searchResults = null
  })

  const response = await cloudFunction.main({
    payload: payload({
      productText: '很贵的未来眼镜',
      questionCount: 0,
      draft: {},
      messages: [{ role: 'user', content: '我想买：很贵的未来眼镜' }]
    })
  })

  assert.equal(response.data.draft.decisionTier, 'major', '两万块的东西不能按小额决策问一轮就结束')
  assert.equal(response.data.progress.total, 5)
  assert.equal(response.data.draft.rootNeed, '在家躺着看大屏')
})

test('模型调用失败时返回可渲染的兜底结果，而不是错误', async () => {
  const restore = global.fetch
  global.fetch = async () => { throw new Error('network down') }

  try {
    const response = await cloudFunction.main({ payload: payload() })
    assert.equal(response.ok, true)
    assert.equal(response.data.mode, 'fallback')
    assert.equal(response.data.result.verdict, 'wait')
    assert.equal(response.data.result.confidence, 'low')
  } finally {
    global.fetch = restore
  }
})
