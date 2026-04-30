(function () {
  if (window.self === window.top) return

  const logs = []
  const MAX_LOGS = 500

  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  }

  function serialize(arg) {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg, function (key, value) {
          if (typeof value === 'function') return '[Function]'
          if (value instanceof Error) return value.toString()
          return value
        })
      } catch (e) {
        return '[Object]'
      }
    }
    return String(arg)
  }

  function captureLog(level, args) {
    const timestamp = new Date().toISOString()
    const message = Array.prototype.slice.call(args).map(serialize).join(' ')

    const logEntry = {
      timestamp: timestamp,
      level: level,
      message: message,
      url: window.location.href,
    }

    logs.push(logEntry)
    if (logs.length > MAX_LOGS) {
      logs.shift()
    }

    try {
      window.parent.postMessage({ type: 'console-log', log: logEntry }, '*')
    } catch (e) {}
  }

  console.log = function () {
    originalConsole.log.apply(console, arguments)
    captureLog('log', arguments)
  }
  console.warn = function () {
    originalConsole.warn.apply(console, arguments)
    captureLog('warn', arguments)
  }
  console.error = function () {
    originalConsole.error.apply(console, arguments)
    captureLog('error', arguments)
  }
  console.info = function () {
    originalConsole.info.apply(console, arguments)
    captureLog('info', arguments)
  }
  console.debug = function () {
    originalConsole.debug.apply(console, arguments)
    captureLog('debug', arguments)
  }

  window.addEventListener('error', function (event) {
    captureLog('error', [event.message + ' (at ' + event.filename + ':' + event.lineno + ')'])
  })

  window.addEventListener('unhandledrejection', function (event) {
    captureLog('error', ['Unhandled Promise Rejection: ' + String(event.reason)])
  })

  function sendRouteChange() {
    try {
      window.parent.postMessage(
        {
          type: 'route-change',
          route: {
            pathname: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash,
            href: window.location.href,
          },
          timestamp: new Date().toISOString(),
        },
        '*'
      )
    } catch (e) {}
  }

  function sendReady() {
    try {
      window.parent.postMessage(
        {
          type: 'console-capture-ready',
          url: window.location.href,
          timestamp: new Date().toISOString(),
        },
        '*'
      )
    } catch (e) {}
    sendRouteChange()
  }

  if (document.readyState === 'complete') {
    sendReady()
  } else {
    window.addEventListener('load', sendReady)
  }

  // Track SPA route changes
  var _pushState = history.pushState
  history.pushState = function () {
    _pushState.apply(history, arguments)
    sendRouteChange()
  }

  var _replaceState = history.replaceState
  history.replaceState = function () {
    _replaceState.apply(history, arguments)
    sendRouteChange()
  }

  window.addEventListener('popstate', sendRouteChange)
  window.addEventListener('hashchange', sendRouteChange)
})()