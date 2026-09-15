module.exports = {
  // 留空则用小程序绑定的默认云开发环境，只有存在多个环境时才需要显式指定
  CLOUD_ENV_ID: 'cloudbase-d6gn146s16b182fd7',
  ANALYZE_FUNCTION_NAME: 'analyze',
  // 真机只能走云函数：http + IP 进不了微信的域名白名单，本地服务仅供模拟器调试
  USE_LOCAL_API: false,
  LOCAL_API_BASE: 'http://127.0.0.1:8787',
  // 在微信公众平台创建一次性订阅消息模板后填入；留空时不请求提醒权限
  SUBSCRIBE_TEMPLATE_ID: '',
  // 首问目标 10 秒、最终结果目标 20 秒；客户端到点后保留草稿并提供基础判断
  REQUEST_TIMEOUT: 20000
}
