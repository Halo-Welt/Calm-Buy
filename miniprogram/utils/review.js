function dueReviewStage(item, now = Date.now()) {
  const createdAt = Number(item.createdAt) || now
  const cooldownAt = createdAt + (Number(item.cooldownHours) || 48) * 3600 * 1000
  if (!item.review48h && now >= cooldownAt) return '48h'
  if (!item.review7d && now >= createdAt + 7 * 24 * 3600 * 1000) return '7d'
  if (!item.review30d && now >= createdAt + 30 * 24 * 3600 * 1000) return '30d'
  return ''
}

module.exports = { dueReviewStage }
