(function () {
  var MU = window.MindUser
  var service = MU.serviceKey
  var brand = MU.brand

  var message = document.getElementById('page-message')
  var serviceTag = document.getElementById('service-tag')
  var appTitle = document.getElementById('app-title')
  var appSubtitle = document.getElementById('app-subtitle')
  var featureHomeBtn = document.getElementById('feature-home-btn')

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

    document.getElementById('admin-link').href = '/' + service + '/admin/login'
    document.getElementById('api-endpoint').textContent = '/api/' + service + '/open/recharge-card'

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
    document.getElementById('user-role').textContent = me.role || '-'
    document.getElementById('user-service').textContent = me.service_key || service
    document.getElementById('user-created').textContent = me.created_at || '-'
  }

  function renderWallet(summary) {
    document.getElementById('credits-balance').textContent = MU.formatNumber(summary.credits || 0)
    document.getElementById('recharge-count').textContent = MU.formatNumber(summary.recharge_count || 0)
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

  function bindActions() {
    document.getElementById('logout-btn').addEventListener('click', function () {
      MU.clearAuth()
      window.location.href = '/' + service + '/login'
    })

    document.getElementById('refresh-btn').addEventListener('click', function () {
      loadAll()
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

  async function loadAll() {
    hideMessage()
    try {
      var meResp = await MU.apiRequest('/api/' + service + '/auth/me', { auth: true })
      var walletResp = await MU.apiRequest('/api/' + service + '/wallet/summary', { auth: true })
      var listResp = await MU.apiRequest('/api/' + service + '/wallet/recharges?page=1&limit=50', { auth: true })

      renderUser(meResp.data || {})
      renderWallet(walletResp.data || {})
      renderRecharges((listResp.data && listResp.data.list) || [])
    } catch (error) {
      if (error.status === 401) {
        MU.clearAuth()
        window.location.href = '/' + service + '/login'
        return
      }
      showMessage('error', error.message || '加载失败，请稍后重试')
    }
  }

  if (!MU.ensureAuthOrRedirect(false)) return
  setBasicInfo()
  bindActions()
  loadAll()
})()
