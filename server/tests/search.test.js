const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSearchQueries, formatSearchSummary, isSearchConfigured } = require('../src/search')

test('搜索查询覆盖价格、口碑与缺点', () => {
  const queries = buildSearchQueries('未来眼镜')
  assert.equal(queries.length, 3)
  assert.match(queries[0], /价格/)
  assert.match(queries[1], /口碑/)
  assert.match(queries[2], /缺点/)
  queries.forEach((query) => assert.match(query, /未来眼镜/))
})

test('搜索摘要格式化包含标题与来源', () => {
  const summary = formatSearchSummary([
    { title: '评测A', url: 'https://example.com/a', content: '优点明显' }
  ])
  assert.match(summary, /评测A/)
  assert.match(summary, /https:\/\/example.com\/a/)
  assert.match(summary, /优点明显/)
})

test('搜索能力可通过 keyless 兜底始终可用', () => {
  assert.equal(isSearchConfigured(), true)
})
