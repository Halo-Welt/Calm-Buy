const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const serverSource = path.join(root, 'server', 'src')
const cloudSource = path.join(root, 'cloudfunctions', 'analyze', 'src')
const sharedFiles = [
  'schema.js',
  'prompt.js',
  'deepseek.js',
  'policy.js',
  'fallback.js',
  'questions.js',
  'search.js',
  'safety.js'
]

fs.mkdirSync(cloudSource, { recursive: true })
sharedFiles.forEach((file) => {
  fs.copyFileSync(path.join(serverSource, file), path.join(cloudSource, file))
})

console.log(`已同步 ${sharedFiles.length} 个分析模块到云函数`)
