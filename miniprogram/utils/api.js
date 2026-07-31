const {
  ANALYZE_FUNCTION_NAME,
  LOCAL_API_BASE,
  REQUEST_TIMEOUT,
  USE_LOCAL_API
} = require('../config')

class ApiError extends Error {
  constructor(message, code = 'API_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** 云调用失败时把原始 errMsg 带出来：只说“无法连接”等于没说，排查全靠猜 */
function describeCloudFailure(errMsg = '') {
  if (errMsg.includes('timeout')) {
    return { code: 'REQUEST_TIMEOUT', message: '分析超时' }
  }
  if (errMsg.includes('-501000') || errMsg.includes('could not be found')) {
    return { code: 'CLOUD_FUNCTION_MISSING', message: '云函数 analyze 还没部署到当前环境' }
  }
  if (errMsg.includes('env') && errMsg.includes('not exist')) {
    return { code: 'CLOUD_ENV_MISSING', message: '云开发环境 ID 不存在或未开通' }
  }
  return { code: 'CLOUD_CALL_FAILED', message: `云端调用失败：${errMsg || '未知原因'}` }
}

function analyzeViaCloud(payload) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new ApiError('当前微信版本不支持云开发', 'CLOUD_UNAVAILABLE'))
      return
    }

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new ApiError('分析超时', 'REQUEST_TIMEOUT'))
    }, REQUEST_TIMEOUT)

    wx.cloud.callFunction({
      name: ANALYZE_FUNCTION_NAME,
      data: {
        action: 'analyze',
        payload
      },
      success(response) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const result = response.result
        if (!result || result.ok !== true) {
          const code = result?.error?.code || 'CLOUD_FUNCTION_ERROR'
          reject(new ApiError(
            result?.error?.message || `云端分析暂时不可用（${code}）`,
            code
          ))
          return
        }
        resolve(result.data)
      },
      fail(error) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const failure = describeCloudFailure(error.errMsg)
        reject(new ApiError(failure.message, failure.code))
      }
    })
  })
}

function analyzeViaLocal(payload) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${LOCAL_API_BASE}/api/analyze/step`,
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      header: {
        'Content-Type': 'application/json'
      },
      data: payload,
      success(response) {
        const body = response.data
        if (response.statusCode >= 400 || !body || body.error?.code === 'NOT_FOUND') {
          reject(new ApiError(
            body?.error?.message || '本地分析服务不可用',
            body?.error?.code || 'LOCAL_API_ERROR'
          ))
          return
        }
        if (!body.phase) {
          reject(new ApiError(
            body?.error?.message || '本地分析返回异常',
            body?.error?.code || 'LOCAL_API_INVALID'
          ))
          return
        }
        resolve(body)
      },
      fail(error) {
        reject(new ApiError(
          error.errMsg?.includes('timeout') ? '分析超时' : '无法连接本地分析服务，请确认已启动 server',
          error.errMsg?.includes('timeout') ? 'REQUEST_TIMEOUT' : 'LOCAL_API_UNREACHABLE'
        ))
      }
    })
  })
}

function analyzeStep(payload) {
  return USE_LOCAL_API ? analyzeViaLocal(payload) : analyzeViaCloud(payload)
}

module.exports = { ApiError, analyzeStep }
