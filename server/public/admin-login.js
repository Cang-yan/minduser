(function () {
  var MU = window.MindUser
  var service = MU.serviceKey
  var brand = MU.brand

  var message = document.getElementById('auth-message')

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

  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return
    btn.disabled = !!loading
    btn.dataset.origin = btn.dataset.origin || btn.textContent
    btn.textContent = loading ? loadingText : btn.dataset.origin
  }

  function validUsername(name) {
    return /^[A-Za-z0-9_\-.]{3,32}$/.test(name)
  }

  function renderBrand() {
    document.title = brand.short + ' Admin Login'
    var desktopLogo = document.getElementById('admin-logo')
    var mobileLogo = document.getElementById('mobile-admin-logo')

    // Hide logo for all services.
    if (desktopLogo) {
      desktopLogo.style.display = 'none'
    }
    if (mobileLogo) {
      mobileLogo.style.display = 'none'
    }
    document.getElementById('admin-brand-title').textContent = brand.short + ' 管理后台'
    document.getElementById('admin-brand-desc').textContent = '你正在登录 ' + brand.short + ' 的独立后台。该后台仅展示本服务的用户与充值数据。'
    document.getElementById('admin-scope').textContent = service
    document.getElementById('mobile-admin-title').textContent = brand.short + ' 管理后台'
    document.getElementById('mobile-admin-subtitle').textContent = '服务隔离模式：' + service

    document.getElementById('back-user-login').href = '/' + service + '/login'
  }

  async function tryAutoAdmin() {
    if (!MU.getToken()) return
    try {
      var meResp = await MU.apiRequest('/api/' + service + '/auth/me', { auth: true })
      var me = meResp.data || {}
      if (me.role === 'admin') {
        window.location.replace(MU.adminHomePath())
        return
      }
    } catch {
      MU.clearAuth()
    }
  }

  document.getElementById('admin-login-form').addEventListener('submit', async function (event) {
    event.preventDefault()
    hideMessage()

    var username = String(document.getElementById('admin-username').value || '').trim()
    var password = String(document.getElementById('admin-password').value || '')

    if (!validUsername(username)) {
      showMessage('error', '管理员用户名格式错误')
      return
    }
    if (password.length < 6) {
      showMessage('error', '密码长度至少 6 位')
      return
    }

    var btn = document.getElementById('admin-login-submit')
    setButtonLoading(btn, true, '登录中...')

    try {
      var result = await MU.apiRequest('/api/' + service + '/auth/admin-login', {
        method: 'POST',
        body: {
          username: username,
          password: password,
        },
      })
      MU.setAuth(result.data)
      showMessage('success', '管理员登录成功，正在跳转...')
      setTimeout(function () {
        window.location.href = MU.adminHomePath()
      }, 350)
    } catch (error) {
      showMessage('error', error.message || '管理员登录失败')
    } finally {
      setButtonLoading(btn, false, '')
    }
  })

  renderBrand()
  tryAutoAdmin()
})()
