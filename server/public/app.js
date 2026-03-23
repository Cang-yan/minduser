(function () {
  var MU = window.MindUser
  var service = MU.serviceKey
  var brand = MU.brand
  var PAGE_SIZE = 10

  var message = document.getElementById('page-message')
  var serviceTag = document.getElementById('service-tag')
  var appTitle = document.getElementById('app-title')
  var appSubtitle = document.getElementById('app-subtitle')
  var featureHomeBtn = document.getElementById('feature-home-btn')
  var cdkeyLink = document.getElementById('cdkey-link')
  var state = {
    rechargePage: 1,
    rechargeTotal: 0,
    consumptionPage: 1,
    consumptionTotal: 0,
    isLoading: false,
  }

  function showMessage(type, text) {
    message.className = 'message ' + type
    message.textContent = text
    message.style.display = 'block'
  }

  function hideMessage() {
    message.className = 'message'
    message.textContent = ''
    message.style.display = 'none'
  }

  function setBasicInfo() {
    document.title = brand.full + ' - 会员中心'
    serviceTag.textContent = service.toUpperCase()
    appTitle.textContent = brand.short + ' 会员中心'
    appSubtitle.textContent = brand.slogan

    if (cdkeyLink) {
      cdkeyLink.href = '/' + service + '/cdkey'
    }

    var featureHomeUrl = MU.getFeatureHomeUrl()
    if (featureHomeBtn) {
      if (featureHomeUrl) {
        featureHomeBtn.style.display = ''
        featureHomeBtn.dataset.targetUrl = featureHomeUrl
      } else {
        featureHomeBtn.style.display = 'none'
      }
    }
  }

  function renderUser(me) {
    document.getElementById('user-uid').textContent = me.uid || me.id || '-'
    document.getElementById('user-name').textContent = me.username || '-'
    document.getElementById('user-email').textContent = me.email || '-'
    document.getElementById('user-created').textContent = me.created_at || '-'
    if (cdkeyLink) {
      cdkeyLink.href = '/' + service + '/cdkey'
    }
  }

  function renderWallet(summary) {
    document.getElementById('credits-balance').textContent = MU.formatNumber(summary.credits || 0)
    document.getElementById('recharge-count').textContent = MU.formatNumber(summary.recharge_count || 0)
    document.getElementById('consumed-total').textContent = MU.formatNumber(summary.consumed_total || 0)
    document.getElementById('consumption-count').textContent = MU.formatNumber(summary.consumption_count || 0)
  }

  function totalPages(total) {
    var n = Number(total || 0)
    if (!Number.isFinite(n) || n <= 0) return 1
    return Math.max(Math.ceil(n / PAGE_SIZE), 1)
  }

  function renderRechargePager() {
    var pages = totalPages(state.rechargeTotal)
    if (state.rechargePage > pages) state.rechargePage = pages
    if (state.rechargePage < 1) state.rechargePage = 1

    var prevBtn = document.getElementById('recharge-prev-btn')
    var nextBtn = document.getElementById('recharge-next-btn')
    var info = document.getElementById('recharge-page-info')

    if (prevBtn) prevBtn.disabled = state.rechargePage <= 1 || state.isLoading
    if (nextBtn) nextBtn.disabled = state.rechargePage >= pages || state.isLoading
    if (info) {
      info.textContent =
        '第 ' + state.rechargePage + ' / ' + pages + ' 页，共 ' + MU.formatNumber(state.rechargeTotal || 0) + ' 条'
    }
  }

  function renderConsumptionPager() {
    var pages = totalPages(state.consumptionTotal)
    if (state.consumptionPage > pages) state.consumptionPage = pages
    if (state.consumptionPage < 1) state.consumptionPage = 1

    var prevBtn = document.getElementById('consumption-prev-btn')
    var nextBtn = document.getElementById('consumption-next-btn')
    var info = document.getElementById('consumption-page-info')

    if (prevBtn) prevBtn.disabled = state.consumptionPage <= 1 || state.isLoading
    if (nextBtn) nextBtn.disabled = state.consumptionPage >= pages || state.isLoading
    if (info) {
      info.textContent =
        '第 ' + state.consumptionPage + ' / ' + pages + ' 页，共 ' + MU.formatNumber(state.consumptionTotal || 0) + ' 条'
    }
  }

  function renderRecharges(records) {
    var tbody = document.getElementById('recharge-tbody')
    tbody.innerHTML = ''

    if (!records || !records.length) {
      var empty = document.createElement('tr')
      empty.innerHTML = '<td colspan="4" class="muted">暂无充值记录</td>'
      tbody.appendChild(empty)
      return
    }

    records.forEach(function (item) {
      var tr = document.createElement('tr')
      tr.innerHTML = [
        '<td>' + (item.card_code || '-') + '</td>',
        '<td>' + (item.face_value || '-') + '</td>',
        '<td>' + MU.formatNumber(item.recharge_amount || 0) + '</td>',
        '<td>' + (item.recharged_at || '-') + '</td>',
      ].join('')
      tbody.appendChild(tr)
    })
  }

  function renderConsumptions(records) {
    var tbody = document.getElementById('consumption-tbody')
    tbody.innerHTML = ''

    if (!records || !records.length) {
      var empty = document.createElement('tr')
      empty.innerHTML = '<td colspan="5" class="muted">暂无消耗记录</td>'
      tbody.appendChild(empty)
      return
    }

    records.forEach(function (item) {
      var tr = document.createElement('tr')
      tr.innerHTML = [
        '<td>' + MU.formatNumber(item.consume_amount || 0) + '</td>',
        '<td>' + (item.reason || '-') + '</td>',
        '<td>' + (item.source_ref || '-') + '</td>',
        '<td>' + MU.formatNumber(item.balance_after || 0) + '</td>',
        '<td>' + (item.consumed_at || '-') + '</td>',
      ].join('')
      tbody.appendChild(tr)
    })
  }

  function bindActions() {
    document.getElementById('logout-btn').addEventListener('click', function () {
      MU.clearAuth()
      window.location.href = '/' + service + '/login'
    })

    document.getElementById('refresh-btn').addEventListener('click', function () {
      loadAll()
    })

    document.getElementById('recharge-prev-btn').addEventListener('click', function () {
      if (state.isLoading) return
      if (state.rechargePage <= 1) return
      state.rechargePage -= 1
      loadAll({ keepMessage: true })
    })

    document.getElementById('recharge-next-btn').addEventListener('click', function () {
      if (state.isLoading) return
      var pages = totalPages(state.rechargeTotal)
      if (state.rechargePage >= pages) return
      state.rechargePage += 1
      loadAll({ keepMessage: true })
    })

    document.getElementById('consumption-prev-btn').addEventListener('click', function () {
      if (state.isLoading) return
      if (state.consumptionPage <= 1) return
      state.consumptionPage -= 1
      loadAll({ keepMessage: true })
    })

    document.getElementById('consumption-next-btn').addEventListener('click', function () {
      if (state.isLoading) return
      var pages = totalPages(state.consumptionTotal)
      if (state.consumptionPage >= pages) return
      state.consumptionPage += 1
      loadAll({ keepMessage: true })
    })

    if (featureHomeBtn) {
      featureHomeBtn.addEventListener('click', function () {
        var target = featureHomeBtn.dataset.targetUrl || MU.getFeatureHomeUrl()
        if (!target) {
          showMessage('error', '未配置功能首页地址，请联系管理员设置。')
          return
        }
        window.location.href = target
      })
    }
  }

  function redirectToLoginWithMessage(text) {
    MU.clearAuth()
    var params = new URLSearchParams()
    if (text) params.set('msg', text)
    var query = params.toString()
    window.location.href = '/' + service + '/login' + (query ? ('?' + query) : '')
  }

  async function loadAll(options) {
    var opts = options || {}
    if (state.isLoading) return
    state.isLoading = true
    renderRechargePager()
    renderConsumptionPager()
    if (!opts.keepMessage) hideMessage()

    try {
      var meResp = await MU.apiRequest('/api/' + service + '/auth/me', { auth: true })
      var walletResp = await MU.apiRequest('/api/' + service + '/wallet/summary', { auth: true })
      var listResp = await MU.apiRequest(
        '/api/' + service + '/wallet/recharges?page=' + state.rechargePage + '&limit=' + PAGE_SIZE,
        { auth: true }
      )
      var consumeResp = await MU.apiRequest(
        '/api/' + service + '/wallet/consumptions?page=' + state.consumptionPage + '&limit=' + PAGE_SIZE,
        { auth: true }
      )

      var rechargeData = (listResp && listResp.data) || {}
      var consumptionData = (consumeResp && consumeResp.data) || {}

      state.rechargeTotal = Number(rechargeData.total || 0)
      state.consumptionTotal = Number(consumptionData.total || 0)

      var rechargePages = totalPages(state.rechargeTotal)
      var consumptionPages = totalPages(state.consumptionTotal)
      var adjusted = false

      if (state.rechargePage > rechargePages && rechargePages >= 1) {
        state.rechargePage = rechargePages
        adjusted = true
      }
      if (state.consumptionPage > consumptionPages && consumptionPages >= 1) {
        state.consumptionPage = consumptionPages
        adjusted = true
      }

      if (adjusted && !opts.skipRequery) {
        state.isLoading = false
        renderRechargePager()
        renderConsumptionPager()
        return loadAll({ keepMessage: true, skipRequery: true })
      }

      renderUser(meResp.data || {})
      renderWallet(walletResp.data || {})
      renderRecharges(rechargeData.list || [])
      renderConsumptions(consumptionData.list || [])
      renderRechargePager()
      renderConsumptionPager()
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        redirectToLoginWithMessage(error.message || '登录状态异常，请重新登录')
        return
      }
      showMessage('error', error.message || '加载失败，请稍后重试')
    } finally {
      state.isLoading = false
      renderRechargePager()
      renderConsumptionPager()
    }
  }

  if (!MU.ensureAuthOrRedirect(false)) return
  setBasicInfo()
  bindActions()
  loadAll()
})()
