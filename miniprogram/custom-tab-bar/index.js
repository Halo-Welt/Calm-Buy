Component({
  data: {
    selected: 0,
    sliderIndex: 0,
    animate: false,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        iconPath: '/assets/tabbar/home-default.png'
      },
      {
        pagePath: '/pages/list/list',
        text: '记录',
        iconPath: '/assets/tabbar/record-default.png'
      },
      {
        pagePath: '/pages/about/about',
        text: '我的',
        iconPath: '/assets/tabbar/profile-default.png'
      }
    ]
  },

  lifetimes: {
    ready() {
      this._ready = true
      if (this._pending) {
        this.select(this._pending.to, this._pending.from)
        this._pending = null
      }
    }
  },

  methods: {
    select(to, from) {
      if (!this._ready) {
        this._pending = { to, from }
        this.setData({ selected: to, sliderIndex: to, animate: false })
        return
      }

      if (from == null || from === to) {
        this.setData({ selected: to, sliderIndex: to, animate: false })
        return
      }

      this.setData({
        selected: to,
        sliderIndex: from,
        animate: false
      }, () => {
        setTimeout(() => {
          this.setData({ animate: true, sliderIndex: to })
        }, 24)
      })
    },

    switchTab(event) {
      const { path, index } = event.currentTarget.dataset
      if (index === this.data.selected) return
      wx.switchTab({ url: path })
    }
  }
})
