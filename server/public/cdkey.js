(function () {
  var MU = window.MindUser
  var service = MU.serviceKey
  var brand = MU.brand
  var query = new URLSearchParams(window.location.search || '')

  var pageMessage = document.getElementById('page-message')
  var uidInput = document.getElementById('redeem-uid')
  var cardInput = document.getElementById('card-input')
  var validateBtn = document.getElementById('validate-btn')
  var redeemBtn = document.getElementById('redeem-btn')

  var validationError = document.getElementById('validation-error')
  var validationSuccess = document.getElementById('validation-success')
  var validationResult = document.getElementById('validation-result')
  var redeemError = document.getElementById('redeem-error')
  var redeemSuccess = document.getElementById('redeem-success')
  var redeemResult = document.getElementById('redeem-result')

  var state = {
    validating: false,
    redeeming: false,
    me: null,
    validationData: null,
  }

  function showPageMessage(type, text) {
    if (!pageMessage) return
    pageMessage.className = 'message ' + type
    pageMessage.textContent = text
    pageMessage.style.display = 'block'
  }

  function hidePageMessage() {
    if (!pageMessage) return
    pageMessage.className = 'message'
    pageMessage.textContent = ''
    pageMessage.style.display = 'none'
  }

  function setNotice(el, text, visible) {
    if (!el) return
    el.textContent = text || ''
    el.style.display = visible ? 'block' : 'none'
  }

  function hideNotices() {
    setNotice(validationError, '', false)
    setNotice(validationSuccess, '', false)
    setNotice(redeemError, '', false)
    setNotice(redeemSuccess, '', false)
  }

  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return
    if (!btn.dataset.defaultText) btn.dataset.defaultText = btn.textContent
    btn.disabled = !!loading
    btn.textContent = loading ? loadingText : btn.dataset.defaultText
  }

  function setBasicInfo() {
    document.title = brand.short + ' CDKey 充值'
    document.getElementById('service-tag').textContent = service.toUpperCase()
    document.getElementById('brand-tag').textContent = brand.short
    document.getElementById('cdkey-page-title').textContent = brand.short + ' CDKey 充值中心'
    document.getElementById('cdkey-page-subtitle').textContent = brand.slogan
    document.getElementById('back-user-center').href = '/' + service + '/app'
  }

  function formatCardInput(value) {
    var raw = String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 16)
    var parts = raw.match(/.{1,4}/g)
    return parts ? parts.join('-') : ''
  }

  function getCardRaw16(value) {
    return String(value || '').toUpperCase().replace(/-/g, '').trim()
  }

  function formatAmount(value) {
    var n = Number(value)
    if (!Number.isFinite(n)) return ''
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  }

  function formatRedeemAmount(data) {
    if (!data) return '-'
    var yuan = Number(data.redeemable_yuan)
    var credits = Number(data.redeemable_credits)
    if (!Number.isFinite(yuan) || !Number.isFinite(credits)) {
      return '以批次配置为准'
    }
    return formatAmount(yuan) + '元（' + formatAmount(credits) + ' credits）'
  }

  function clearValidationState() {
    state.validationData = null
    if (validationResult) validationResult.style.display = 'none'
    updateRedeemButtonState()
  }

  function updateRedeemButtonState() {
    var data = state.validationData
    var sameCard =
      data &&
      getCardRaw16(data.card || '') &&
      getCardRaw16(data.card || '') === getCardRaw16(cardInput.value || '')
    var canRedeem = Boolean(data && data.can_redeem && sameCard && !state.redeeming)
    redeemBtn.disabled = !canRedeem
  }

  function renderValidationResult(data) {
    state.validationData = data || null
    if (!data) {
      if (validationResult) validationResult.style.display = 'none'
      updateRedeemButtonState()
      return
    }

    document.getElementById('result-card').textContent = data.card || '-'
    document.getElementById('result-status').textContent = data.can_redeem ? '可兑换' : '不可兑换'
    document.getElementById('result-used').textContent = data.is_used ? '是' : '否'
    document.getElementById('result-expired').textContent = data.is_expired ? '是' : '否'
    document.getElementById('result-face').textContent = data.face_value || '-'
    document.getElementById('result-credits').textContent = formatRedeemAmount(data)
    document.getElementById('result-valid-period').textContent =
      (data.start_date || '-') + ' ~ ' + (data.expire_at || '-') + '（' + (data.valid_days || '-') + '天）'

    validationResult.style.display = 'block'
    updateRedeemButtonState()
  }

  function renderRedeemResult(data) {
    if (!data) {
      redeemResult.style.display = 'none'
      return
    }
    document.getElementById('redeem-result-uid').textContent = data.uid || data.account || '-'
    document.getElementById('redeem-result-username').textContent = data.username || '-'
    document.getElementById('redeem-result-card').textContent = data.card || '-'
    document.getElementById('redeem-result-batch').textContent = data.batch_no || '-'
    document.getElementById('redeem-result-face').textContent = data.face_value || '-'
    document.getElementById('redeem-result-credits').textContent = MU.formatNumber(data.redeemable_credits || 0)
    document.getElementById('redeem-result-balance').textContent = MU.formatNumber(data.credits_balance || 0)
    document.getElementById('redeem-result-time').textContent = data.redeemed_at || '-'
    redeemResult.style.display = 'block'
  }

  async function loadMeAndFillUid() {
    hidePageMessage()
    try {
      var meResp = await MU.apiRequest('/api/' + service + '/auth/me', { auth: true })
      var me = (meResp && meResp.data) || {}
      state.me = me
      var uid = me.uid || me.id || MU.getUid() || ''
      uidInput.value = uid
      document.getElementById('back-user-center').href =
        '/' + service + '/app' + (uid ? ('?uid=' + encodeURIComponent(uid)) : '')

      var queryUid = String(query.get('uid') || '').trim()
      if (queryUid && queryUid !== uid) {
        showPageMessage('success', '已自动切换为当前登录账号 UID：' + uid)
      }
    } catch (error) {
      if (error.status === 401) {
        MU.clearAuth()
        window.location.href = '/' + service + '/login'
        return
      }
      showPageMessage('error', error.message || '用户信息加载失败')
    }
  }

  async function doValidate() {
    hidePageMessage()
    setNotice(redeemError, '', false)
    setNotice(redeemSuccess, '', false)
    renderRedeemResult(null)

    var card = String(cardInput.value || '').trim().toUpperCase()
    if (!card) {
      setNotice(validationError, '请先输入卡密', true)
      setNotice(validationSuccess, '', false)
      clearValidationState()
      return
    }

    state.validating = true
    setButtonLoading(validateBtn, true, '校验中...')
    try {
      var resp = await MU.apiRequest('/api/' + service + '/credits/validate', {
        method: 'POST',
        auth: true,
        body: {
          card: card,
        },
      })
      var data = resp.data || null
      renderValidationResult(data)
      if (data && data.can_redeem) {
        setNotice(validationSuccess, data.message || '卡密可兑换', true)
        setNotice(validationError, '', false)
      } else {
        setNotice(validationError, (data && data.message) || '卡密不可兑换', true)
        setNotice(validationSuccess, '', false)
      }
    } catch (error) {
      if (error.status === 401) {
        MU.clearAuth()
        window.location.href = '/' + service + '/login'
        return
      }
      clearValidationState()
      setNotice(validationError, error.message || '卡密校验失败', true)
      setNotice(validationSuccess, '', false)
    } finally {
      state.validating = false
      setButtonLoading(validateBtn, false, '')
      updateRedeemButtonState()
    }
  }

  async function doRedeem() {
    setNotice(redeemError, '', false)
    setNotice(redeemSuccess, '', false)
    hidePageMessage()

    var data = state.validationData
    var card = String(cardInput.value || '').trim().toUpperCase()
    var validatedCard = data ? String(data.card || '').trim().toUpperCase() : ''
    if (!data || !data.can_redeem || getCardRaw16(card) !== getCardRaw16(validatedCard)) {
      setNotice(redeemError, '请先校验卡密并确认可兑换。', true)
      return
    }

    var uid = String(uidInput.value || '').trim()
    if (!uid) {
      setNotice(redeemError, 'UID 不能为空，请刷新页面后重试。', true)
      return
    }

    state.redeeming = true
    setButtonLoading(redeemBtn, true, '兑换中...')
    try {
      var resp = await MU.apiRequest('/api/' + service + '/credits/redeem', {
        method: 'POST',
        auth: true,
        body: {
          uid: uid,
          card: card,
        },
      })
      var redeemData = resp.data || null
      setNotice(redeemSuccess, resp.message || '兑换成功', true)
      renderRedeemResult(redeemData)
      cardInput.value = ''
      clearValidationState()
      setNotice(validationError, '', false)
      setNotice(validationSuccess, '', false)
    } catch (error) {
      if (error.status === 401) {
        MU.clearAuth()
        window.location.href = '/' + service + '/login'
        return
      }
      setNotice(redeemError, error.message || '兑换失败', true)
    } finally {
      state.redeeming = false
      setButtonLoading(redeemBtn, false, '')
      updateRedeemButtonState()
    }
  }

  function bindActions() {
    document.getElementById('logout-btn').addEventListener('click', function () {
      MU.clearAuth()
      window.location.href = '/' + service + '/login'
    })

    cardInput.addEventListener('input', function (event) {
      cardInput.value = formatCardInput(event.target.value)
      setNotice(validationError, '', false)
      setNotice(validationSuccess, '', false)
      clearValidationState()
    })

    validateBtn.addEventListener('click', function () {
      doValidate()
    })

    redeemBtn.addEventListener('click', function () {
      doRedeem()
    })
  }

  if (!MU.ensureAuthOrRedirect(false)) return
  setBasicInfo()
  bindActions()
  hideNotices()
  loadMeAndFillUid()
})()
