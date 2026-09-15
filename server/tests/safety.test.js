const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildAmbiguousResponse,
  buildRestrictedResponse,
  looksAmbiguous,
  restrictedCategory
} = require('../src/safety')

const ORDINARY_CASES = {
  快消: ['泡面', '矿泉水', '咖啡豆', '纸巾', '牙膏', '垃圾袋', '饼干', '洗衣液', '袜子', '笔芯'],
  数码: ['iPhone 17 Pro', '索尼降噪耳机', '游戏电脑', '微单相机', '机械键盘', '平板电脑', '智能手表', '电子书阅读器', '显示器', '移动硬盘'],
  家电: ['扫地机器人', '洗碗机', '空气净化器', '冰箱', '洗衣机', '烘干机', '电饭煲', '吸尘器', '投影仪', '吹风机'],
  服饰: ['羽绒服', '跑鞋', '西装', '双肩包', '太阳镜', '联名球鞋', '羊毛衫', '雨衣', '登山鞋', '行李箱'],
  出行: ['纯电汽车', '折叠自行车', '电动滑板车', '儿童安全座椅', '行车记录仪', '汽车轮胎', '露营拖车', '通勤月票', '摩托车头盔', '车顶行李箱'],
  课程: ['英语口语课', '编程训练营', '摄影课程', '健身私教课', '绘画班', '音乐课', '职业认证课', '驾驶培训', '烘焙课', '公开演讲课'],
  收藏: ['限量手办', '黑胶唱片', '纪念币册', '球星卡', '乐高套装', '艺术版画', '邮票册', '模型车', '漫画典藏版', '签名海报'],
  居家服务: ['搬家服务', '保洁服务', '宠物寄养', '家电清洗', '摄影服务', '婚礼策划', '云存储会员', '视频会员', '联合办公月卡', '旅行套餐']
}

test('80 个普通消费案例不会被高风险边界误拦截', async (t) => {
  for (const [category, products] of Object.entries(ORDINARY_CASES)) {
    for (const product of products) {
      await t.test(`${category}：${product}`, () => {
        assert.equal(restrictedCategory(product), null)
      })
    }
  }
})

test('医疗、投资、博彩和违法商品会进入能力边界', () => {
  for (const product of [
    '处方药', '减肥药', '布洛芬', '家用血糖仪', '医美项目',
    '股票基金', '期货课程', '加密货币', '保险产品', '彩票', '博彩平台',
    '枪支', '管制刀具', '假证'
  ]) {
    assert.ok(restrictedCategory(product), product)
  }
})

test('能力边界响应可直接由统一结果页渲染', () => {
  const category = restrictedCategory('想买减肥药')
  const response = buildRestrictedResponse({ productText: '想买减肥药' }, category)
  assert.equal(response.phase, 'done')
  assert.equal(response.result.safetyBoundary, true)
  assert.equal(response.result.confidence, 'low')
  assert.deepEqual(response.result.candidateProducts, [])
})

test('模糊购买对象先澄清，不联网猜具体商品', () => {
  assert.equal(looksAmbiguous('新手机'), true)
  const response = buildAmbiguousResponse({ productText: '新手机' })
  assert.equal(response.phase, 'clarify_need')
  assert.match(response.assistantMessage, /具体对象|价格范围/)
  assert.ok(response.options.includes('我想自己补充'))
})
