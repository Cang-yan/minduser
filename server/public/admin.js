(function () {
  var MU = window.MindUser
  var service = MU.serviceKey
  var brand = MU.brand

  var message = document.getElementById('admin-message')
  var filterState = {
    username: '',
    card: '',
    batch: '',
  }

  function showMessage(type, text) {
    message.className = 'message ' + type
    message.style.display = 'block'
    message.textContent = text
  }

  function hideMessage() {
    message.className = 'message'
    message.style.display = 'none'
    message.textContent = ''
  }

  function renderHeader() {
    document.title = brand.short + ' Admin Dashboard'
    document.getElementById('service-tag').textContent = service.toUpperCase()
    document.getElementById('admin-title').textContent = brand.short + ' 管理后台'
    document.getElementById('admin-subtitle').textContent = '服务隔离：仅展示 ' + service + ' 的用户与充值数据'
    document.getElementById('to-user-center').href = '/' + service + '/app'
  }

  function readFiltersFromDom() {
    filterState.username = String(document.getElementById('filter-username').value || '').trim()
    filterState.card = String(document.getElementById('filter-card').value || '').trim()
    filterState.batch = String(document.getElementById('filter-batch').value || '').trim()
  }

  function writeFiltersToDom() {
    document.getElementById('filter-username').value = filterState.username
    document.getElementById('filter-card').value = filterState.card
    document.getElementById('filter-batch').value = filterState.batch
  }

  function buildFilterQuery() {
    var params = new URLSearchParams()
    if (filterState.username) params.set('username', filterState.username)
    if (filterState.card) params.set('card', filterState.card)
    if (filterState.batch) params.set('batch', filterState.batch)
    return params.toString()
  }

  function renderStats(data) {
    document.getElementById('stat-users-total').textContent = MU.formatNumber(data.users_total || 0)
    document.getElementById('stat-users-active').textContent = MU.formatNumber(data.users_with_recharge || 0)
    document.getElementById('stat-total-credits').textContent = MU.formatNumber(data.total_credits_balance || 0)
    document.getElementById('stat-recharge-count').textContent = MU.formatNumber(data.recharge_total_count || 0)
    document.getElementById('stat-recharge-amount').textContent = MU.formatNumber(data.recharge_total_amount || 0)
  }

  function renderUsers(users) {
    var tbody = document.getElementById('users-tbody')
    tbody.innerHTML = ''

    if (!users || !users.length) {
      var empty = document.createElement('tr')
      empty.innerHTML = '<td colspan="6" class="muted">暂无用户数据</td>'
      tbody.appendChild(empty)
      return
    }

    users.forEach(function (item) {
      var tr = document.createElement('tr')
      tr.innerHTML = [
        '<td>' + item.id + '</td>',
        '<td>' + item.username + '</td>',
        '<td>' + item.role + '</td>',
        '<td>' + MU.formatNumber(item.credits_balance || 0) + '</td>',
        '<td>' + MU.formatNumber(item.recharge_count || 0) + '</td>',
        '<td>' + (item.created_at || '-') + '</td>',
      ].join('')
      tbody.appendChild(tr)
    })
  }

  function renderRecharges(records) {
    var tbody = document.getElementById('recharges-tbody')
    tbody.innerHTML = ''

    if (!records || !records.length) {
      var empty = document.createElement('tr')
      empty.innerHTML = '<td colspan="9" class="muted">暂无充值记录</td>'
      tbody.appendChild(empty)
      return
    }

    records.forEach(function (item) {
      var tr = document.createElement('tr')
      tr.innerHTML = [
        '<td>' + (item.recharged_at || '-') + '</td>',
        '<td>' + (item.user_id || '-') + '</td>',
        '<td>' + (item.username || '-') + '</td>',
        '<td>' + (item.card_code || '-') + '</td>',
        '<td>' + (item.face_value || '-') + '</td>',
        '<td>' + MU.formatNumber(item.recharge_amount || 0) + '</td>',
        '<td>' + (item.sale_price || '-') + '</td>',
        '<td>' + (item.valid_period || '-') + '</td>',
        '<td>' + (item.batch_no || '-') + '</td>',
      ].join('')
      tbody.appendChild(tr)
    })
  }

  async function ensureAdminRole() {
    var meResp = await MU.apiRequest('/api/' + service + '/auth/me', { auth: true })
    var me = meResp.data || {}
    if (me.role !== 'admin') {
      throw new Error('当前账号不是管理员')
    }
  }

  async function loadAll() {
    hideMessage()
    try {
      await ensureAdminRole()

      var dashboardResp = await MU.apiRequest('/api/' + service + '/admin/dashboard', { auth: true })
      var usersResp = await MU.apiRequest('/api/' + service + '/admin/users?page=1&limit=100', { auth: true })

      var query = buildFilterQuery()
      var rechargePath = '/api/' + service + '/admin/recharges?page=1&limit=100' + (query ? '&' + query : '')
      var rechargeResp = await MU.apiRequest(rechargePath, { auth: true })

      renderStats(dashboardResp.data || {})
      renderUsers((usersResp.data && usersResp.data.list) || [])
      renderRecharges((rechargeResp.data && rechargeResp.data.list) || [])
    } catch (error) {
      if (error.status === 401) {
        MU.clearAuth()
        window.location.href = MU.adminLoginPath()
        return
      }
      if (error.message === '当前账号不是管理员') {
        showMessage('error', '你不是管理员账号，已跳转至用户中心。')
        setTimeout(function () {
          window.location.href = '/' + service + '/app'
        }, 900)
        return
      }
      showMessage('error', error.message || '后台数据加载失败')
    }
  }

  async function exportExcel() {
    hideMessage()
    try {
      var query = buildFilterQuery()
      var url = '/api/' + service + '/admin/recharges/export' + (query ? '?' + query : '')
      var resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + MU.getToken(),
        },
      })

      if (!resp.ok) {
        var errorPayload = await resp.json().catch(function () { return null })
        throw new Error((errorPayload && errorPayload.message) || '导出失败')
      }

      var blob = await resp.blob()
      var contentDisposition = resp.headers.get('Content-Disposition') || ''
      var fileNameMatch = contentDisposition.match(/filename="([^"]+)"/)
      var fileName = fileNameMatch ? fileNameMatch[1] : service + '_recharge_records.xlsx'

      var link = document.createElement('a')
      var objectUrl = URL.createObjectURL(blob)
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)

      showMessage('success', 'Excel 导出成功')
    } catch (error) {
      showMessage('error', error.message || '导出失败')
    }
  }

  function bindActions() {
    document.getElementById('admin-logout-btn').addEventListener('click', function () {
      MU.clearAuth()
      window.location.href = MU.adminLoginPath()
    })

    document.getElementById('admin-refresh-btn').addEventListener('click', function () {
      loadAll()
    })

    document.getElementById('filter-search-btn').addEventListener('click', function () {
      readFiltersFromDom()
      loadAll()
    })

    document.getElementById('filter-reset-btn').addEventListener('click', function () {
      filterState.username = ''
      filterState.card = ''
      filterState.batch = ''
      writeFiltersToDom()
      loadAll()
    })

    document.getElementById('admin-export-btn').addEventListener('click', function () {
      exportExcel()
    })
  }

  if (!MU.ensureAuthOrRedirect(true)) return
  renderHeader()
  writeFiltersToDom()
  bindActions()
  loadAll()
})()
