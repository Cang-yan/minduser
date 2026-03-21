(function () {
  function getServiceFromPath() {
    var seg = window.location.pathname.split('/').filter(Boolean)[0] || 'mindplus'
    return seg === 'asloga' ? 'asloga' : 'mindplus'
  }

  var serviceKey = getServiceFromPath()
  var runtimeConfig = window.__MINDUSER_RUNTIME__ || {}
  var defaultFeatureHomeMap = {
    mindplus: 'http://127.0.0.1:5173/slide/',
    asloga: '',
  }

  var brandMap = {
    mindplus: {
      short: 'MindPlus',
      full: 'MindPlus',
      slogan: '论文写作助手 · 科研PPT制作助手',
      intro: 'MindPlus 聚焦科研创作场景，提供论文写作助手与科研PPT制作助手能力。',
      feature1: '论文写作助手：选题梳理、结构建议、内容润色',
      feature2: '科研PPT制作助手：从研究内容到演示文稿快速落地',
      feature3: '统一账号与 credits 钱包，支持后续卡密充值',
    },
    asloga: {
      short: 'Asloga',
      full: 'Asloga',
      slogan: '智能视频',
      intro: 'Asloga 是智能视频服务，聚焦脚本生成、素材组织与视频生产流程。',
      feature1: '智能视频创作：从创意到成片的高效流程支持',
      feature2: '独立账号体系与后台，数据与 MindPlus 完全隔离',
      feature3: '统一鉴权与 credits 钱包，便于多服务协同接入',
    },
  }

  function normalizeHttpUrl(raw) {
    var value = String(raw || '').trim()
    if (!value) return ''
    try {
      var url = new URL(value, window.location.origin)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
      return url.toString()
    } catch {
      return ''
    }
  }

  function storageKey(name) {
    return 'minduser_' + serviceKey + '_' + name
  }

  function getFeatureHomeMap() {
    var rawMap = runtimeConfig.featureHomeMap || {}
    return {
      mindplus: normalizeHttpUrl(rawMap.mindplus) || defaultFeatureHomeMap.mindplus,
      asloga: normalizeHttpUrl(rawMap.asloga) || defaultFeatureHomeMap.asloga,
    }
  }

  function setFeatureHomeUrl(raw) {
    var normalized = normalizeHttpUrl(raw)
    if (normalized) {
      window.localStorage.setItem(storageKey('feature_home_url'), normalized)
    } else {
      window.localStorage.removeItem(storageKey('feature_home_url'))
    }
  }

  function getFeatureHomeUrl(options) {
    var opts = options || {}
    var queryParams = opts.queryParams instanceof URLSearchParams
      ? opts.queryParams
      : new URLSearchParams(window.location.search || '')

    var fromQuery = normalizeHttpUrl(queryParams.get('app') || queryParams.get('featureHome'))
    if (fromQuery) {
      setFeatureHomeUrl(fromQuery)
      return fromQuery
    }

    var fromStorage = normalizeHttpUrl(window.localStorage.getItem(storageKey('feature_home_url')))
    if (fromStorage) return fromStorage

    var map = getFeatureHomeMap()
    return normalizeHttpUrl(map[serviceKey] || '')
  }

  function getToken() {
    return window.localStorage.getItem(storageKey('jwt_token')) || ''
  }

  function getUid() {
    return window.localStorage.getItem(storageKey('uid')) || ''
  }

  function setAuth(payload) {
    var user = payload && (payload.user || payload.user_info) ? (payload.user || payload.user_info) : null
    if (!payload || !payload.token || !user) {
      throw new Error('登录返回数据不完整')
    }

    window.localStorage.setItem(storageKey('jwt_token'), payload.token)
    window.localStorage.setItem(storageKey('uid'), user.id || user.uid || '')
    window.localStorage.setItem(storageKey('username'), user.username || '')
    window.localStorage.setItem(storageKey('role'), user.role || 'user')
  }

  function clearAuth() {
    window.localStorage.removeItem(storageKey('jwt_token'))
    window.localStorage.removeItem(storageKey('uid'))
    window.localStorage.removeItem(storageKey('username'))
    window.localStorage.removeItem(storageKey('role'))
  }

  async function apiRequest(path, options) {
    var opts = options || {}
    var headers = {
      'Content-Type': 'application/json',
    }
    if (opts.auth) {
      var token = getToken()
      if (token) headers.Authorization = 'Bearer ' + token
    }

    var resp = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })

    var data = await resp.json().catch(function () {
      return { code: resp.status, message: '返回数据解析失败', data: null }
    })

    if (!resp.ok) {
      var err = new Error((data && data.message) || '请求失败')
      err.status = resp.status
      err.payload = data
      throw err
    }

    return data
  }

  function ensureAuthOrRedirect(isAdmin) {
    if (!getToken() || !getUid()) {
      window.location.href = '/' + serviceKey + (isAdmin ? '/admin/login' : '/login')
      return false
    }
    return true
  }

  function formatNumber(num) {
    var n = Number(num || 0)
    if (!Number.isFinite(n)) return '0'
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  }

  window.MindUser = {
    serviceKey: serviceKey,
    brand: brandMap[serviceKey],
    brandMap: brandMap,
    runtimeConfig: runtimeConfig,
    storageKey: storageKey,
    getToken: getToken,
    getUid: getUid,
    setAuth: setAuth,
    clearAuth: clearAuth,
    normalizeHttpUrl: normalizeHttpUrl,
    getFeatureHomeMap: getFeatureHomeMap,
    getFeatureHomeUrl: getFeatureHomeUrl,
    setFeatureHomeUrl: setFeatureHomeUrl,
    apiRequest: apiRequest,
    ensureAuthOrRedirect: ensureAuthOrRedirect,
    formatNumber: formatNumber,
  }
})()
