const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildSearchQueries,
  collectImages,
  extractPriceAnchor,
  formatSearchSummary,
  interleaveByIntent,
  isSearchConfigured,
  parsePrices,
  snippetImages,
  sourceTier
} = require('../src/search')

test('检索按意图拆开：一条查价格渠道，一条查口碑缺点', () => {
  const queries = buildSearchQueries('未来眼镜')
  assert.deepEqual(queries.map((item) => item.intent), ['price', 'reputation'])
  assert.match(queries[0].query, /未来眼镜/)
  assert.match(queries[0].query, /价格/)
  assert.match(queries[0].query, /京东/)
  assert.match(queries[1].query, /缺点/)
})

test('最终轮补一条替代方案检索，并带上已确认的根本需求', () => {
  const queries = buildSearchQueries('降噪耳机', { rootNeed: '通勤时隔开地铁噪音' }, { round: 'final' })
  const alternative = queries.find((item) => item.intent === 'alternative')
  assert.match(alternative.query, /通勤时隔开地铁噪音/)
  assert.match(alternative.query, /替代方案/)
})

test('商品页权重高于社区，洗稿站被降权', () => {
  assert.equal(sourceTier('https://item.jd.com/1.html').kind, 'shop')
  assert.ok(sourceTier('https://item.jd.com/1.html').weight > sourceTier('https://www.zhihu.com/q/1').weight)
  assert.ok(sourceTier('https://www.zhihu.com/q/1').weight > sourceTier('https://example.com/x').weight)
  assert.ok(sourceTier('https://baijiahao.baidu.com/s?id=1').weight < 1)
})

test('价格解析认「元」和「万元」，不把销量读成价格', () => {
  assert.deepEqual(parsePrices('售价 2899 元'), [2899])
  assert.deepEqual(parsePrices('¥1,299 起'), [1299])
  assert.deepEqual(parsePrices('指导价 12.98 万元'), [129800])
  assert.deepEqual(parsePrices('累计销量 10 万+'), [])
  assert.deepEqual(parsePrices('电池 5000mAh'), [])
})

test('价格锚点剔除配件离群价，产出可引用的区间', () => {
  const anchor = extractPriceAnchor([
    { title: '京东报价', content: '售价 1999 元' },
    { title: '淘宝', content: '到手 2199 元' },
    { title: '配件', content: '收纳盒 39 元' }
  ])
  assert.equal(anchor.count, 2)
  assert.equal(anchor.min, 1999)
  assert.equal(anchor.max, 2199)
  assert.match(anchor.text, /1999/)
  assert.match(anchor.text, /2199/)
})

test('没有任何报价时不编造价格锚点', () => {
  assert.equal(extractPriceAnchor([{ title: '开箱', content: '手感不错' }]), null)
})

test('合并结果按意图轮转，价格页不会挤掉差评', () => {
  const merged = interleaveByIntent([
    { url: 'a', intent: 'price', relevance: 1 },
    { url: 'b', intent: 'price', relevance: 0.9 },
    { url: 'c', intent: 'price', relevance: 0.8 },
    { url: 'd', intent: 'reputation', relevance: 0.4 }
  ], 3)
  assert.deepEqual(merged.map((item) => item.intent), ['price', 'reputation', 'price'])
})

test('未配置搜索 Key 时如实报告不可用', () => {
  const previousDoubao = process.env.DOUBAO_SEARCH_API_KEY
  const previousVolc = process.env.VOLC_SEARCH_API_KEY
  const previousTavily = process.env.TAVILY_API_KEY
  const previousSearch = process.env.SEARCH_API_KEY
  delete process.env.DOUBAO_SEARCH_API_KEY
  delete process.env.VOLC_SEARCH_API_KEY
  delete process.env.TAVILY_API_KEY
  delete process.env.SEARCH_API_KEY
  try {
    assert.equal(isSearchConfigured(), false)
  } finally {
    if (previousDoubao) process.env.DOUBAO_SEARCH_API_KEY = previousDoubao
    if (previousVolc) process.env.VOLC_SEARCH_API_KEY = previousVolc
    if (previousTavily) process.env.TAVILY_API_KEY = previousTavily
    if (previousSearch) process.env.SEARCH_API_KEY = previousSearch
  }
})

test('搜索摘要格式化包含标题与来源', () => {
  const summary = formatSearchSummary([
    { title: '评测A', url: 'https://example.com/a', content: '优点明显' }
  ])
  assert.match(summary, /评测A/)
  assert.match(summary, /https:\/\/example.com\/a/)
  assert.match(summary, /优点明显/)
})

test('豆包 snippet 能抽出配图，并写进摘要', () => {
  const images = snippetImages([
    { Type: 'text', Text: '口碑不错' },
    { Type: 'image', Image: { ImageUrl: 'https://cdn.example.com/xm5.jpg', Alt: 'XM5' } }
  ])
  assert.equal(images.length, 1)
  assert.equal(images[0].url, 'https://cdn.example.com/xm5.jpg')
  const summary = formatSearchSummary(
    [{ title: '评测', url: 'https://example.com/a', content: '口碑不错' }],
    images
  )
  assert.match(summary, /可用配图/)
  assert.match(summary, /xm5\.jpg/)
})

test('价格锚点写进摘要头部，供模型直接引用', () => {
  const summary = formatSearchSummary(
    [{ title: '京东', url: 'https://item.jd.com/1.html', content: '售价 1999 元', intent: 'price' }],
    [],
    { priceAnchor: { text: '约 1999 元', count: 2 } }
  )
  assert.match(summary, /价格锚点/)
  assert.match(summary, /约 1999 元/)
  assert.match(summary, /京东·价格\/渠道/)
})

test('追问轮摘要按 brief 预算截断，最终轮给完整正文', () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    title: `结果${index}`,
    url: `https://example.com/${index}`,
    content: 'x'.repeat(400),
    intent: 'price'
  }))
  const brief = formatSearchSummary(items, [], { budget: 'brief' })
  const full = formatSearchSummary(items, [], { budget: 'full' })
  assert.equal((brief.match(/来源：/g) || []).length, 4)
  assert.equal((full.match(/来源：/g) || []).length, 6)
  assert.ok(brief.length < full.length)
})

test('配图去重并丢掉非法链接', () => {
  const images = collectImages([
    { url: 'https://cdn.example.com/a.jpg' },
    { url: 'https://cdn.example.com/a.jpg' },
    { url: 'javascript:alert(1)' },
    'https://cdn.example.com/b.jpg'
  ], 2)
  assert.equal(images.length, 2)
  assert.equal(images[0].url, 'https://cdn.example.com/a.jpg')
  assert.equal(images[1].url, 'https://cdn.example.com/b.jpg')
})

