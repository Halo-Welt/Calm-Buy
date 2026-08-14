function syncTabBar(page, selected) {
  const app = getApp()
  const from = app.globalData.tabBarSelected
  app.globalData.tabBarSelected = selected
  const tabBar = typeof page.getTabBar === 'function' ? page.getTabBar() : null
  if (tabBar) tabBar.select(selected, from)
}

module.exports = { syncTabBar }
