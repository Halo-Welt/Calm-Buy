function formatDate(timestamp) {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}.${day}`
}

Page({
  data: {
    items: []
  },

  onShow() {
    const items = (wx.getStorageSync('calmList') || []).map((item) => ({
      ...item,
      dateLabel: formatDate(item.createdAt),
      statusLabel: item.status === 'abandoned' ? '已放弃' : item.status === 'still-want' ? '冷静后仍想要' : '冷静中'
    }))
    this.setData({ items })
  },

  updateStatus(event) {
    const { id, status } = event.currentTarget.dataset
    const items = (wx.getStorageSync('calmList') || []).map((item) => (
      item.id === id ? { ...item, status } : item
    ))
    wx.setStorageSync('calmList', items)
    this.onShow()
  },

  remove(event) {
    const { id } = event.currentTarget.dataset
    const items = (wx.getStorageSync('calmList') || []).filter((item) => item.id !== id)
    wx.setStorageSync('calmList', items)
    this.onShow()
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
