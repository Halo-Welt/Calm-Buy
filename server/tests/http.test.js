const test = require('node:test')
const assert = require('node:assert/strict')
const { server } = require('../src/index')

test('无 Key 时 HTTP 接口返回可渲染 fallback，而不是白屏错误', async (context) => {
  const previousKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    if (previousKey) process.env.DEEPSEEK_API_KEY = previousKey
  })

  const address = server.address()
  const response = await fetch(`http://127.0.0.1:${address.port}/api/analyze/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'request_12345678',
      sessionId: 'session_12345678',
      productText: '未来眼镜',
      messages: [],
      phase: 'clarify_need',
      questionCount: 0,
      confirmation: null,
      draft: {}
    })
  })

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.mode, 'fallback')
  assert.equal(payload.phase, 'clarify_need')
  assert.equal(payload.result, null)
  assert.match(payload.assistantMessage, /[？?]/)
  assert.ok(payload.progress.current >= 1)
  assert.equal(payload.progress.total, 3)
})
