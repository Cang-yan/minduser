(function () {
  var MU = window.MindUser
  var service = MU.serviceKey
  var brand = MU.brand

  var message = document.getElementById('admin-message')
  var refreshBtn = document.getElementById('admin-refresh-btn')
  var filterState = {
    username: '',
    card: '',
    batch: '',
  }
  var isLoading = false

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

  function setButtonLoading(btn, loading, text) {
    if (!btn) return
    btn.disabled = !!loading
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent
    btn.textContent = loading ? text : btn.dataset.originalText
  }

  function withCacheBust(url) {
    var sep = url.indexOf('?') >= 0 ? '&' : '?'
    return url + sep + '_ts=' + Date.now()
  }

  function redirectToAdminLoginWithMessage(text) {
    MU.clearAuth()
    var params = new URLSearchParams()
    if (text) params.set('msg', text)
    var query = params.toString()
    window.location.href = MU.adminLoginPath() + (query ? ('?' + query) : '')
  }

  function escapeHtml(raw) {
    return String(raw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
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
      empty.innerHTML = '<td colspan="9" class="muted">暂无用户数据</td>'
      tbody.appendChild(empty)
      return
    }

    users.forEach(function (item) {
      var isDisabled = String(item.account_status || 'active') === 'disabled'
      var isAdmin = String(item.role || '') === 'admin'
      var statusText = isDisabled ? '已停用' : '正常'
      var statusClass = isDisabled ? 'status-pill danger' : 'status-pill success'
      var uid = String(item.id || '')
      var username = String(item.username || '')
      var usernameEncoded = encodeURIComponent(username)

      var actionHtml = '<span class="muted">-</span>'
      if (!isAdmin) {
        var toggleAction = isDisabled ? 'enable' : 'disable'
        var toggleLabel = isDisabled ? '启用' : '停用'
        actionHtml = [
          '<div class="inline-actions user-row-actions">',
          '<button type="button" class="secondary-btn user-action-btn" data-action="' + toggleAction + '" data-uid="' + escapeHtml(uid) + '" data-username="' + usernameEncoded + '">' + toggleLabel + '</button>',
          '<button type="button" class="secondary-btn danger-btn user-action-btn" data-action="delete" data-uid="' + escapeHtml(uid) + '" data-username="' + usernameEncoded + '">删除</button>',
          '</div>',
        ].join('')
      }

      var tr = document.createElement('tr')
      tr.innerHTML = [
        '<td>' + escapeHtml(uid) + '</td>',
        '<td>' + escapeHtml(username) + '</td>',
        '<td>' + escapeHtml(item.email || '-') + '</td>',
        '<td>' + escapeHtml(item.role || '-') + '</td>',
        '<td><span class="' + statusClass + '">' + statusText + '</span></td>',
        '<td>' + MU.formatNumber(item.credits_balance || 0) + '</td>',
        '<td>' + MU.formatNumber(item.recharge_count || 0) + '</td>',
        '<td>' + escapeHtml(item.created_at || '-') + '</td>',
        '<td>' + actionHtml + '</td>',
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

  async function loadAll(options) {
    var opts = options || {}
    if (isLoading) return
    isLoading = true
    setButtonLoading(refreshBtn, true, '刷新中...')
    if (!opts.keepMessage) hideMessage()

    try {
      await ensureAdminRole()

      var dashboardResp = await MU.apiRequest(withCacheBust('/api/' + service + '/admin/dashboard'), { auth: true })
      var usersResp = await MU.apiRequest(withCacheBust('/api/' + service + '/admin/users?page=1&limit=100'), { auth: true })

      var query = buildFilterQuery()
      var rechargePath = '/api/' + service + '/admin/recharges?page=1&limit=100' + (query ? '&' + query : '')
      var rechargeResp = await MU.apiRequest(withCacheBust(rechargePath), { auth: true })

      renderStats(dashboardResp.data || {})
      renderUsers((usersResp.data && usersResp.data.list) || [])
      renderRecharges((rechargeResp.data && rechargeResp.data.list) || [])
      if (opts.showSuccess) {
        var timeText = new Date().toLocaleString()
        showMessage('success', '数据已刷新：' + timeText)
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        redirectToAdminLoginWithMessage(error.message || '登录状态异常，请重新登录')
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
    } finally {
      isLoading = false
      setButtonLoading(refreshBtn, false, '')
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

  async function updateUserStatus(uid, action) {
    return MU.apiRequest('/api/' + service + '/admin/users/' + encodeURIComponent(uid) + '/status', {
      method: 'PATCH',
      auth: true,
      body: { action: action },
    })
  }

  async function deleteUser(uid) {
    return MU.apiRequest('/api/' + service + '/admin/users/' + encodeURIComponent(uid), {
      method: 'DELETE',
      auth: true,
    })
  }

  async function handleUserAction(btn) {
    if (!btn) return
    var action = String(btn.getAttribute('data-action') || '').trim().toLowerCase()
    var uid = String(btn.getAttribute('data-uid') || '').trim()
    var username = ''
    try {
      username = decodeURIComponent(String(btn.getAttribute('data-username') || ''))
    } catch {
      username = String(btn.getAttribute('data-username') || '')
    }
    var label = username || uid

    if (!action || !uid) return
    if (isLoading) return

    var confirmed = false
    if (action === 'delete') {
      confirmed = window.confirm('确认删除用户 [' + label + '] 吗？删除后其登录与数据查询会提示未注册。')
    } else if (action === 'disable') {
      confirmed = window.confirm('确认停用用户 [' + label + '] 吗？停用后用户登录与信息查询将提示联系管理员。')
    } else if (action === 'enable') {
      confirmed = window.confirm('确认启用用户 [' + label + '] 吗？')
    }
    if (!confirmed) return

    var loadingText = '处理中...'
    if (action === 'delete') loadingText = '删除中...'
    if (action === 'disable') loadingText = '停用中...'
    if (action === 'enable') loadingText = '启用中...'

    setButtonLoading(btn, true, loadingText)
    try {
      var resp = null
      if (action === 'delete') {
        resp = await deleteUser(uid)
      } else {
        resp = await updateUserStatus(uid, action)
      }

      showMessage('success', (resp && resp.message) || '操作成功')
      await loadAll({ keepMessage: true })
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        redirectToAdminLoginWithMessage(error.message || '登录状态异常，请重新登录')
        return
      }
      showMessage('error', error.message || '操作失败')
    } finally {
      setButtonLoading(btn, false, '')
    }
  }

  function parseGeneratePayloadFromDom() {
    var count = Number.parseInt(String(document.getElementById('gen-count').value || '').trim(), 10)
    var faceValue = String(document.getElementById('gen-face-value').value || '').trim()
    var salePrice = String(document.getElementById('gen-sale-price').value || '').trim()
    var validDays = Number.parseInt(String(document.getElementById('gen-valid-days').value || '').trim(), 10)
    var batchNo = String(document.getElementById('gen-batch-no').value || '').trim()
    var startDate = String(document.getElementById('gen-start-date').value || '').trim()

    if (!Number.isFinite(count) || count < 1 || count > 200000) {
      throw new Error('生成数量必须是 1-200000 的整数')
    }
    if (!faceValue) {
      throw new Error('请输入对应面值/规格')
    }
    if (!salePrice) {
      throw new Error('请输入售价')
    }
    if (!Number.isFinite(validDays) || validDays < 1 || validDays > 36500) {
      throw new Error('有效期天数必须是 1-36500 的整数')
    }
    if (!batchNo) {
      throw new Error('请输入批次号')
    }
    if (!/^[0-9A-Za-z._-]{2,64}$/.test(batchNo)) {
      throw new Error('批次号仅支持字母/数字/._-，长度 2-64')
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error('生效日期格式应为 YYYY-MM-DD')
    }

    var payload = {
      count: count,
      faceValue: faceValue,
      salePrice: salePrice,
      validDays: validDays,
      batchNo: batchNo,
    }
    if (startDate) payload.startDate = startDate
    return payload
  }

  function extractFileName(contentDisposition, fallback) {
    var raw = String(contentDisposition || '')
    var utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match && utf8Match[1]) {
      try {
        return decodeURIComponent(utf8Match[1])
      } catch {}
    }

    var normalMatch = raw.match(/filename="?([^";]+)"?/i)
    if (normalMatch && normalMatch[1]) return normalMatch[1]
    return fallback
  }

  function triggerDownload(blob, fileName) {
    var link = document.createElement('a')
    var objectUrl = URL.createObjectURL(blob)
    link.href = objectUrl
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
  }

  async function generateCardkeys(event) {
    if (event) event.preventDefault()
    hideMessage()

    var payload = null
    try {
      payload = parseGeneratePayloadFromDom()
    } catch (error) {
      showMessage('error', error.message || '生成参数不合法')
      return
    }

    var submitBtn = document.getElementById('cardkey-generate-btn')
    setButtonLoading(submitBtn, true, '生成中...')
    try {
      await ensureAdminRole()
      var url = '/api/' + service + '/admin/cardkeys/generate'
      var resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + MU.getToken(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!resp.ok) {
        var errorPayload = await resp.json().catch(function () { return null })
        throw new Error((errorPayload && errorPayload.message) || '生成卡密失败')
      }

      var blob = await resp.blob()
      var fileName = extractFileName(
        resp.headers.get('Content-Disposition'),
        service + '_cardkeys.csv'
      )
      triggerDownload(blob, fileName)
      showMessage('success', '卡密生成成功，已开始下载')
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        redirectToAdminLoginWithMessage(error.message || '登录状态异常，请重新登录')
        return
      }
      showMessage('error', error.message || '生成卡密失败')
    } finally {
      setButtonLoading(submitBtn, false, '')
    }
  }

  function resetGenerateForm() {
    var countInput = document.getElementById('gen-count')
    var validDaysInput = document.getElementById('gen-valid-days')
    var faceValueInput = document.getElementById('gen-face-value')
    var salePriceInput = document.getElementById('gen-sale-price')
    var batchNoInput = document.getElementById('gen-batch-no')
    var startDateInput = document.getElementById('gen-start-date')

    if (countInput) countInput.value = '100'
    if (validDaysInput) validDaysInput.value = '365'
    if (faceValueInput) faceValueInput.value = ''
    if (salePriceInput) salePriceInput.value = ''
    if (batchNoInput) batchNoInput.value = ''
    if (startDateInput) startDateInput.value = ''
  }

  function bindActions() {
    document.getElementById('admin-logout-btn').addEventListener('click', function () {
      MU.clearAuth()
      window.location.href = MU.adminLoginPath()
    })

    document.getElementById('admin-refresh-btn').addEventListener('click', function () {
      readFiltersFromDom()
      loadAll({ showSuccess: true })
    })

    document.getElementById('filter-search-btn').addEventListener('click', function () {
      readFiltersFromDom()
      loadAll({ showSuccess: true })
    })

    document.getElementById('filter-reset-btn').addEventListener('click', function () {
      filterState.username = ''
      filterState.card = ''
      filterState.batch = ''
      writeFiltersToDom()
      loadAll({ showSuccess: true })
    })

    document.getElementById('admin-export-btn').addEventListener('click', function () {
      exportExcel()
    })

    var cardkeyForm = document.getElementById('cardkey-generate-form')
    if (cardkeyForm) {
      cardkeyForm.addEventListener('submit', generateCardkeys)
    }

    var cardkeyResetBtn = document.getElementById('cardkey-generate-reset-btn')
    if (cardkeyResetBtn) {
      cardkeyResetBtn.addEventListener('click', function () {
        resetGenerateForm()
      })
    }

    var usersTbody = document.getElementById('users-tbody')
    if (usersTbody) {
      usersTbody.addEventListener('click', function (event) {
        var target = event.target
        if (!target || typeof target.closest !== 'function') return
        var btn = target.closest('.user-action-btn')
        if (!btn) return
        handleUserAction(btn)
      })
    }
  }

  if (!MU.ensureAuthOrRedirect(true)) return
  renderHeader()
  writeFiltersToDom()
  resetGenerateForm()
  bindActions()
  loadAll()
})()
