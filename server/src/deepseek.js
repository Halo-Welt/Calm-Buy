const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-flash'

let lastStatus = { ok: null, code: null, message: null }

class DeepSeekError extends Error {
  constructor(message, code, status = 500) {
    super(message)
    this.name = 'DeepSeekError'
    this.code = code
    this.status = status
  }
}

function llmStatus() {
  return { ...lastStatus }
}

function recordStatus(ok, error) {
  lastStatus = {
    ok,
    code: error?.code || null,
    message: error ? String(error.message || '').slice(0, 180) : null
  }
}

async function errorDetail(response) {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text)
    return String(parsed.error?.message || parsed.message || text).slice(0, 200)
  } catch {
    return String(text || '').slice(0, 200)
  }
}

function classifyHttpError(status, detail) {
  const text = String(detail || '')
  if (status === 401) {
    return { code: 'DEEPSEEK_AUTH_FAILED', message: 'DeepSeek API Key 无效' }
  }
  if (status === 402 || /insufficient balance/i.test(text)) {
    return { code: 'DEEPSEEK_INSUFFICIENT_BALANCE', message: 'DeepSeek 余额不足，请充值后再试' }
  }
  return { code: 'DEEPSEEK_HTTP_ERROR', message: `DeepSeek 请求失败：${status}` }
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
    const error = new DeepSeekError('DeepSeek API Key 未配置', 'DEEPSEEK_NOT_CONFIGURED', 503)
    recordStatus(false, error)
    throw error
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
        const detail = await errorDetail(response)
        const classified = classifyHttpError(response.status, detail)
        throw new DeepSeekError(classified.message, classified.code, response.status)
      }

      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content
      if (!content || !content.trim()) {
        lastError = new DeepSeekError('DeepSeek 返回空内容', 'DEEPSEEK_EMPTY_RESPONSE', 502)
        continue
      }

      try {
        const parsed = JSON.parse(content)
        recordStatus(true, null)
        return parsed
      } catch {
        lastError = new DeepSeekError('DeepSeek 返回了非法 JSON', 'DEEPSEEK_INVALID_JSON', 502)
        continue
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeout = new DeepSeekError('DeepSeek 请求超时', 'DEEPSEEK_TIMEOUT', 504)
        recordStatus(false, timeout)
        throw timeout
      }
      if (error instanceof DeepSeekError) {
        recordStatus(false, error)
        if (
          error.code === 'DEEPSEEK_AUTH_FAILED'
          || error.code === 'DEEPSEEK_NOT_CONFIGURED'
          || error.code === 'DEEPSEEK_INSUFFICIENT_BALANCE'
        ) {
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

  recordStatus(false, lastError)
  throw lastError || new DeepSeekError('DeepSeek 请求失败', 'DEEPSEEK_HTTP_ERROR', 502)
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DeepSeekError,
  callDeepSeek,
  llmBudget,
  llmStatus
}
