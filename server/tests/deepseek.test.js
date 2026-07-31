const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { callDeepSeek } = require('../src/deepseek')

test('DeepSeek 客户端使用服务端 Key、当前模型与 JSON Output', async (context) => {
  let received
  const fakeDeepSeek = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      received = {
        authorization: request.headers.authorization,
        body: JSON.parse(body)
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ ok: true })
          }
        }]
      }))
    })
  })

  await new Promise((resolve) => fakeDeepSeek.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
    await new Promise((resolve) => fakeDeepSeek.close(resolve))
  })

  const previous = {
    key: process.env.DEEPSEEK_API_KEY,
    base: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL
  }
  context.after(() => {
    if (previous.key == null) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous.key
    if (previous.base == null) delete process.env.DEEPSEEK_BASE_URL
    else process.env.DEEPSEEK_BASE_URL = previous.base
    if (previous.model == null) delete process.env.DEEPSEEK_MODEL
    else process.env.DEEPSEEK_MODEL = previous.model
  })

  const address = fakeDeepSeek.address()
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash'

  const result = await callDeepSeek([{ role: 'system', content: 'return json' }])
  assert.deepEqual(result, { ok: true })
  assert.equal(received.authorization, 'Bearer test-key')
  assert.equal(received.body.model, 'deepseek-v4-flash')
  assert.deepEqual(received.body.response_format, { type: 'json_object' })
})
