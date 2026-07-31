const assert = require('node:assert/strict')
const path = require('node:path')
const { createResult } = require('../miniprogram/utils/mockJudge')

const cases = ['case-a', 'case-b', 'case-c', 'case-d']

cases.forEach((caseName) => {
  const fixture = require(path.join('..', 'mocks', `${caseName}.json`))
  const result = createResult(fixture)

  assert.equal(result.verdict, fixture.expected.verdict, `${caseName}: verdict`)
  assert.equal(result.confidence, fixture.expected.confidence, `${caseName}: confidence`)
  assert.equal(result.alternatives.length, fixture.expected.alternativesCount, `${caseName}: alternatives`)
  console.log(`✓ ${caseName} ${fixture.name}`)
})

console.log('4 个演示用例全部通过')
