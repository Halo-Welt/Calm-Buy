const test = require('node:test')
const assert = require('node:assert/strict')
const {
  anchoredTier,
  looksTrivialProduct,
  nextOpenDimension,
  planForRequest,
  shouldResearchNow,
  tierFromPrice
} = require('../src/questions')

test('泡面这类快消不值得首轮检索', () => {
  assert.equal(looksTrivialProduct('一箱泡面'), true)
  assert.equal(shouldResearchNow({
    productText: '一箱泡面',
    questionCount: 0,
    draft: { decisionTier: 'trivial' }
  }), false)
})

test('降噪耳机第一轮要检索，第二轮不再检索', () => {
  assert.equal(looksTrivialProduct('降噪耳机'), false)
  assert.equal(shouldResearchNow({
    productText: '降噪耳机',
    questionCount: 0,
    draft: { decisionTier: 'standard' }
  }), true)
  assert.equal(shouldResearchNow({
    productText: '降噪耳机',
    questionCount: 1,
    draft: { decisionTier: 'standard' }
  }), false)
})

test('用户确认后的最终轮必须检索', () => {
  assert.equal(shouldResearchNow({
    productText: '降噪耳机',
    questionCount: 3,
    confirmation: true,
    draft: { decisionTier: 'standard' }
  }), true)
})

test('决策量级按真实价格分档', () => {
  assert.equal(tierFromPrice(29), 'trivial')
  assert.equal(tierFromPrice(1999), 'standard')
  assert.equal(tierFromPrice(129800), 'major')
  assert.equal(tierFromPrice(0), null)
})

test('检索到的价格覆盖模型对量级的猜测', () => {
  const evidence = { priceAnchor: { median: 19800, count: 3 } }
  assert.equal(anchoredTier('trivial', evidence), 'major')
  assert.equal(planForRequest({ searchEvidence: evidence }).maxQuestions, 5)
})

test('只有一个游离报价时不足以定档，仍听模型', () => {
  assert.equal(anchoredTier('trivial', { priceAnchor: { median: 19800, count: 1 } }), 'trivial')
})

test('已锁定的量级不被价格改判', () => {
  assert.equal(planForRequest({
    draft: { decisionTier: 'trivial' },
    searchEvidence: { priceAnchor: { median: 19800, count: 3 } }
  }).maxQuestions, 1)
})

test('追问兜底会挑一个还没问过的品类维度', () => {
  assert.equal(nextOpenDimension({
    keyDimensions: ['拍摄题材', '便携度', '镜头预算'],
    askedDimensions: ['拍摄题材']
  }), '便携度')
  assert.equal(nextOpenDimension({ keyDimensions: ['便携度'], askedDimensions: ['便携度'] }), '')
})
