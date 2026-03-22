(function () {
  var MU = window.MindUser
  var service = MU.serviceKey
  var brand = MU.brand
  var query = new URLSearchParams(window.location.search || '')
  var forceLogout = query.get('logout') === '1'

  var tabLogin = document.getElementById('tab-login')
  var tabRegister = document.getElementById('tab-register')
  var loginForm = document.getElementById('login-form')
  var registerForm = document.getElementById('register-form')
  var msg = document.getElementById('auth-message')

  var sendCodeBtn = document.getElementById('send-email-code')
  var registerEmailInput = document.getElementById('register-email')

  var codeCooldownTimer = null
  var codeCooldownLeft = 0

  function parseRedirectTarget() {
    var raw = String(query.get('redirect') || '').trim()
    if (!raw) return null
    try {
      var url = new URL(raw, window.location.origin)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      return url
    } catch {
      return null
    }
  }

  function buildRedirectUrl(payload) {
    var target = parseRedirectTarget()
    if (!target) return null

    var data = payload || {}
    var user = data.user || data.user_info || {}
    target.searchParams.set('token', data.token || '')
    target.searchParams.set('uid', user.uid || user.id || '')
    target.searchParams.set('username', user.username || '')
    target.searchParams.set('role', user.role || 'user')
    target.searchParams.set('service', service)
    return target.toString()
  }

  function gotoAfterAuth(payload) {
    var handoffUrl = buildRedirectUrl(payload)
    if (handoffUrl) {
      window.location.replace(handoffUrl)
      return
    }
    var featureHome = MU.getFeatureHomeUrl({ queryParams: query })
    if (featureHome) {
      window.location.replace(featureHome)
      return
    }
    window.location.replace('/' + service + '/app')
  }

  function setBrandText() {
    document.title = brand.full + ' - 登录'
    document.getElementById('brand-title').textContent = brand.full
    document.getElementById('brand-intro').textContent = brand.intro
    document.getElementById('feature-1').textContent = brand.feature1
    document.getElementById('feature-2').textContent = brand.feature2
    document.getElementById('feature-3').textContent = brand.feature3

    var desktopLogo = document.getElementById('brand-logo')
    var mobileLogo = document.getElementById('mobile-logo')

    if (desktopLogo) desktopLogo.style.display = 'none'
    if (mobileLogo) mobileLogo.style.display = 'none'

    document.getElementById('mobile-title').textContent = brand.short
    document.getElementById('mobile-slogan').textContent = brand.slogan
    document.getElementById('service-label').textContent = '当前服务：' + brand.short
  }

  function switchTab(mode) {
    if (mode === 'login') {
      tabLogin.classList.add('active')
      tabRegister.classList.remove('active')
      loginForm.style.display = ''
      registerForm.style.display = 'none'
    } else {
      tabRegister.classList.add('active')
      tabLogin.classList.remove('active')
      registerForm.style.display = ''
      loginForm.style.display = 'none'
    }
    hideMessage()
  }

  function showMessage(type, text) {
    msg.className = 'message ' + type
    msg.textContent = text
    msg.style.display = 'block'
  }

  function hideMessage() {
    msg.className = 'message'
    msg.style.display = 'none'
    msg.textContent = ''
  }

  function setButtonLoading(btn, loading, text) {
    if (!btn) return
    btn.disabled = !!loading
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent
    btn.textContent = loading ? text : btn.dataset.originalText
  }

  function validUsername(name) {
    return /^[A-Za-z0-9_\-.]{3,32}$/.test(name)
  }

  function validEmail(email) {
    return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email)
  }

  function validAccount(account) {
    return validUsername(account) || validEmail(account)
  }

  function validEmailCode(code) {
    return /^\d{6}$/.test(code)
  }

  function updateSendCodeButton() {
    if (!sendCodeBtn) return
    if (codeCooldownLeft > 0) {
      sendCodeBtn.disabled = true
      sendCodeBtn.textContent = codeCooldownLeft + 's 后重试'
      return
    }
    sendCodeBtn.disabled = false
    sendCodeBtn.textContent = '发送验证码'
  }

  function startSendCodeCooldown(seconds) {
    codeCooldownLeft = Math.max(Number(seconds) || 0, 0)
    if (codeCooldownTimer) {
      window.clearInterval(codeCooldownTimer)
      codeCooldownTimer = null
    }
    updateSendCodeButton()
    if (codeCooldownLeft <= 0) return

    codeCooldownTimer = window.setInterval(function () {
      codeCooldownLeft -= 1
      if (codeCooldownLeft <= 0) {
        codeCooldownLeft = 0
        window.clearInterval(codeCooldownTimer)
        codeCooldownTimer = null
      }
      updateSendCodeButton()
    }, 1000)
  }

  async function tryAutoLogin() {
    if (forceLogout) {
      MU.clearAuth()
      return
    }
    if (!MU.getToken() || !MU.getUid()) return
    try {
      var meResp = await MU.apiRequest('/api/' + service + '/auth/me', { auth: true })
      gotoAfterAuth({
        token: MU.getToken(),
        user: meResp && meResp.data ? meResp.data : {
          id: MU.getUid(),
          uid: MU.getUid(),
          username: window.localStorage.getItem(MU.storageKey('username')) || '',
          role: window.localStorage.getItem(MU.storageKey('role')) || 'user',
        },
      })
    } catch {
      MU.clearAuth()
    }
  }

  tabLogin.addEventListener('click', function () {
    switchTab('login')
  })

  tabRegister.addEventListener('click', function () {
    switchTab('register')
  })

  if (sendCodeBtn && registerEmailInput) {
    sendCodeBtn.addEventListener('click', async function () {
      hideMessage()
      if (codeCooldownLeft > 0) return

      var email = String(registerEmailInput.value || '').trim().toLowerCase()
      if (!validEmail(email)) {
        showMessage('error', '请输入正确的邮箱地址')
        registerEmailInput.focus()
        return
      }

      setButtonLoading(sendCodeBtn, true, '发送中...')
      try {
        var result = await MU.apiRequest('/api/' + service + '/auth/send-register-code', {
          method: 'POST',
          body: { email: email },
        })
        var retrySeconds = result && result.data ? Number(result.data.retry_after_seconds || 0) : 0
        startSendCodeCooldown(retrySeconds || 60)
        showMessage('success', '验证码已发送，请查收邮箱')
      } catch (error) {
        showMessage('error', error.message || '验证码发送失败')
      } finally {
        if (codeCooldownLeft <= 0) {
          setButtonLoading(sendCodeBtn, false, '')
        } else {
          updateSendCodeButton()
        }
      }
    })
  }

  loginForm.addEventListener('submit', async function (event) {
    event.preventDefault()
    hideMessage()

    var account = String(document.getElementById('login-account').value || '').trim()
    var password = String(document.getElementById('login-password').value || '')

    if (!validAccount(account)) {
      showMessage('error', '请输入合法的用户名或邮箱')
      return
    }
    if (password.length < 6) {
      showMessage('error', '密码长度至少 6 位')
      return
    }

    var submitBtn = document.getElementById('login-submit')
    setButtonLoading(submitBtn, true, '登录中...')
    try {
      var result = await MU.apiRequest('/api/' + service + '/auth/login', {
        method: 'POST',
        body: {
          account: account,
          password: password,
        },
      })
      MU.setAuth(result.data)
      showMessage('success', '登录成功，正在跳转...')
      setTimeout(function () {
        gotoAfterAuth(result.data)
      }, 350)
    } catch (error) {
      showMessage('error', error.message || '登录失败')
    } finally {
      setButtonLoading(submitBtn, false, '')
    }
  })

  registerForm.addEventListener('submit', async function (event) {
    event.preventDefault()
    hideMessage()

    var username = String(document.getElementById('register-username').value || '').trim()
    var email = String(document.getElementById('register-email').value || '').trim().toLowerCase()
    var emailCode = String(document.getElementById('register-email-code').value || '').trim()
    var password = String(document.getElementById('register-password').value || '')
    var confirmPassword = String(document.getElementById('register-confirm').value || '')

    if (!validUsername(username)) {
      showMessage('error', '用户名仅支持字母/数字/_/.-，长度 3-32 位')
      return
    }
    if (!validEmail(email)) {
      showMessage('error', '请输入正确的邮箱地址')
      return
    }
    if (!validEmailCode(emailCode)) {
      showMessage('error', '请输入 6 位数字邮箱验证码')
      return
    }
    if (password.length < 6) {
      showMessage('error', '密码长度至少 6 位')
      return
    }
    if (password !== confirmPassword) {
      showMessage('error', '两次输入密码不一致')
      return
    }

    var submitBtn = document.getElementById('register-submit')
    setButtonLoading(submitBtn, true, '注册中...')
    try {
      var result = await MU.apiRequest('/api/' + service + '/auth/register', {
        method: 'POST',
        body: {
          username: username,
          email: email,
          emailCode: emailCode,
          password: password,
        },
      })
      MU.setAuth(result.data)
      showMessage('success', '注册成功，已自动登录并分配 10 位 UID')
      setTimeout(function () {
        gotoAfterAuth(result.data)
      }, 450)
    } catch (error) {
      showMessage('error', error.message || '注册失败')
    } finally {
      setButtonLoading(submitBtn, false, '')
    }
  })

  setBrandText()
  updateSendCodeButton()
  tryAutoLogin()
})()
