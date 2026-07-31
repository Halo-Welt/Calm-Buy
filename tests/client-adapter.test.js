const test = require('node:test')
const assert = require('node:assert/strict')
const { adaptResult } = require('../miniprogram/utils/resultAdapter')
const { buildClientFallback } = require('../miniprogram/utils/fallback')

test('live 结果映射为当前结果页字段且标记未联网核验', () => {
  const result = adaptResult({
    verdict: 'wait',
    confidence: 'medium',
    needSentence: '想在床上舒适看大屏',
    primaryNeedId: 'utility',
    matchScore: 'medium',
    rootNeed: '低负担的大屏观影体验',
    needDecomposition: {
      functional: '躺卧大屏',
      emotional: '放松',
      social: '',
      constraints: ['不能太重'],
      successCriterion: '看完一部电影'
    },
    evidenceQuotes: ['每天睡前看电影', '手机屏幕太小'],
    reasons: ['需求明确'],
    minimumExperiment: {
      title: '借用一次',
      action: '看完一部电影',
      duration: '2 小时'
    },
    alternatives: [],
    candidateProducts: [{
      title: '床头投影',
      why: '无需佩戴',
      servesNeedId: 'utility',
      verificationStatus: '模型常识，未联网核验',
      price: null,
      url: null
    }],
    nextStep: '先体验',
    cooldownHours: 48
  }, {
    mode: 'live',
    productText: '未来眼镜'
  })

  assert.equal(result.verdictLabel, '先验证')
  assert.equal(result.primaryNeedLabel, '场景功能')
  assert.equal(result.candidateProducts.length, 1)
  assert.match(result.reviewSummary.source_note, /未联网核验/)
})

test('客户端 fallback 不给替代或商品候选', () => {
  const response = buildClientFallback('未来眼镜', [], 'NETWORK_ERROR')
  assert.equal(response.result.verdict, 'wait')
  assert.equal(response.result.confidence, 'low')
  assert.deepEqual(response.result.alternatives, [])
  assert.deepEqual(response.result.candidateProducts, [])
})
