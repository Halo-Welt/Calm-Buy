module.exports = {
  // 留空则用小程序绑定的默认云开发环境，只有存在多个环境时才需要显式指定
  CLOUD_ENV_ID: 'cloudbase-d6gn146s16b182fd7',
  ANALYZE_FUNCTION_NAME: 'analyze',
  // 真机只能走云函数：http + IP 进不了微信的域名白名单，本地服务仅供模拟器调试
  USE_LOCAL_API: false,
  LOCAL_API_BASE: 'http://127.0.0.1:8787',
  // 比云函数 60 秒的超时多留一点：两边同时到点的话，客户端会抢在函数返回前先放弃
  REQUEST_TIMEOUT: 65000
}
