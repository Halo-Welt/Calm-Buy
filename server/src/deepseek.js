const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-v4-flash'

class DeepSeekError extends Error {
  constructor(message, code, status = 500) {
    super(message)
    this.name = 'DeepSeekError'
    this.code = code
    this.status = status
  }
}

function llmBudget(isFinal) {
  // 追问轮只回传 draftPatch，输出短了一半，上限跟着收紧；最终轮 result 长，留足余量
  return isFinal
    ? { timeoutMs: 12000, maxTokens: 2600 }
    : { timeoutMs: 7000, maxTokens: 1200 }
}

async function callDeepSeek(messages, { timeoutMs = 15000, maxTokens = 1400 } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new DeepSeekError('DeepSeek API Key 未配置', 'DEEPSEEK_NOT_CONFIGURED', 503)
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL

  let lastError = null
  for (let attempt = 0; attempt < 1; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: maxTokens,
          // V4 默认开思考链，会先闷头推理再给 JSON，追问轮体感会到十几秒
          thinking: { type: 'disabled' }
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        await response.text()
        throw new DeepSeekError(
          `DeepSeek 请求失败：${response.status}`,
          response.status === 401 ? 'DEEPSEEK_AUTH_FAILED' : 'DEEPSEEK_HTTP_ERROR',
          response.status
        )
      }

      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content
      if (!content || !content.trim()) {
        lastError = new DeepSeekError('DeepSeek 返回空内容', 'DEEPSEEK_EMPTY_RESPONSE', 502)
        continue
      }

      try {
        return JSON.parse(content)
      } catch {
        lastError = new DeepSeekError('DeepSeek 返回了非法 JSON', 'DEEPSEEK_INVALID_JSON', 502)
        continue
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new DeepSeekError('DeepSeek 请求超时', 'DEEPSEEK_TIMEOUT', 504)
      }
      if (error instanceof DeepSeekError) {
        if (error.code === 'DEEPSEEK_AUTH_FAILED' || error.code === 'DEEPSEEK_NOT_CONFIGURED') {
          throw error
        }
        lastError = error
      } else {
        lastError = new DeepSeekError('DeepSeek 网络请求失败', 'DEEPSEEK_NETWORK_ERROR', 502)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError || new DeepSeekError('DeepSeek 请求失败', 'DEEPSEEK_HTTP_ERROR', 502)
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DeepSeekError,
  callDeepSeek,
  llmBudget
}
