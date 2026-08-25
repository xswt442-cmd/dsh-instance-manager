// dsh-instance-manager browser half. Classic-script client bundle: registers
// a factory with window.__ModuleLoader__; the client kernel materializes it
// and mounts the exported plugin. React comes from the platform seed
// (`require('react')`); host data comes from the same-origin JSON endpoint
// /dsh-instance-manager/api (registered by the host half on the webserver).
//
// UI language: self-contained zh/EN dictionary with a panel-header toggle,
// persisted in localStorage. First open follows navigator.language. Host
// error payloads carry machine-readable `code`s (see lib/shared.js guards);
// the client maps known codes into the active language and falls back to the
// server-provided text.
window.__ModuleLoader__.load({
  id: 'dsh-instance-manager',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const h = React.createElement

    // Style tags carry data-plugin-css exactly like shipped bundles (the
    // kernel/HMR bookkeeping keys off it); guard against double injection.
    const CSS_ID = 'dsh-instance-manager'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin-css', CSS_ID)
      styleEl.textContent =
        '.dshim-action{display:flex;align-items:center;gap:6px;padding:6px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;cursor:pointer;font:inherit;white-space:nowrap}' +
        '.dshim-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}' +
        '.dshim-action-active{color:var(--dsw-alias-brand-primary)}' +
        '.dshim-panel{position:fixed;top:64px;right:16px;width:400px;max-width:calc(100vw - 32px);max-height:min(560px,72vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:9999;pointer-events:auto;font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden}' +
        '.dshim-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}' +
        '.dshim-title{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}' +
        '.dshim-count{font-size:11px;line-height:17px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}' +
        '.dshim-spacer{flex:1}' +
        '.dshim-body{overflow:auto;padding:6px 8px}' +
        '.dshim-toolbar{display:flex;align-items:center;padding:2px 10px 8px}' +
        '.dshim-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px}' +
        '.dshim-row:hover{background:var(--dsw-alias-bg-layer-2)}' +
        '.dshim-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}' +
        '.dshim-dot-cur{background:var(--dsw-alias-brand-primary)}' +
        '.dshim-dot-other{background:var(--dsw-alias-state-warn-primary)}' +
        '.dshim-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
        '.dshim-line1{display:flex;align-items:center;gap:8px}' +
        '.dshim-port{font-weight:600;color:var(--dsw-alias-label-primary);text-decoration:none}' +
        '.dshim-port:hover{text-decoration:underline}' +
        '.dshim-badge{font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}' +
        '.dshim-badge-ok{color:var(--dsw-alias-state-success-primary)}' +
        '.dshim-badge-cur{color:var(--dsw-alias-brand-primary)}' +
        '.dshim-badge-other{color:var(--dsw-alias-state-warn-primary)}' +
        '.dshim-badge-old{color:var(--dsw-alias-state-warn-primary);border-style:dashed}' +
        '.dshim-line2{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.dshim-foot{padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;flex:none}' +
        '.dshim-iconbtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:7px;cursor:pointer;padding:0}' +
        '.dshim-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}' +
        '.dshim-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:7px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px}' +
        '.dshim-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}' +
        '.dshim-btn:disabled{opacity:.5;cursor:not-allowed}' +
        '.dshim-btn-danger{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:transparent;border-radius:7px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}' +
        '.dshim-btn-danger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-overlay)}' +
        '.dshim-btn-danger-strong{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-overlay)}' +
        '.dshim-btn-danger:disabled{opacity:.45;cursor:not-allowed}' +
        '.dshim-err{margin:4px 8px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px}' +
        '.dshim-empty{padding:22px 10px;text-align:center;color:var(--dsw-alias-label-secondary)}' +
        '.dshim-caret{width:10px;flex:none;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;text-align:center}' +
        '.dshim-drawer{margin:2px 10px 6px 28px;padding:8px 12px 10px;background:var(--dsw-alias-bg-layer-2);border-radius:10px;display:flex;flex-direction:column;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
        '.dshim-dline{display:flex;flex-wrap:wrap;gap:4px 14px}' +
        '.dshim-sparthead{display:flex;align-items:center;gap:8px}' +
        '.dshim-spark{width:100%;height:38px;display:block}' +
        '.dshim-dhead{display:flex;align-items:center;gap:6px}' +
        '.dshim-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer}' +
        '.dshim-tab:hover{color:var(--dsw-alias-label-primary)}' +
        '.dshim-tab-on{color:var(--dsw-alias-label-primary);font-weight:600;background:var(--dsw-alias-bg-overlay)}' +
        '.dshim-log{margin:0;padding:8px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-family:ui-monospace,Consolas,Menlo,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;color:var(--dsw-alias-label-primary)}'
      document.head.appendChild(styleEl)
    }

    // shared open-state store between the footer action and the overlay
    const state = { open: false, listeners: new Set() }
    const setOpen = (v) => { state.open = v; state.listeners.forEach((fn) => fn()) }
    const useOpen = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const fn = () => setTick((n) => n + 1)
        state.listeners.add(fn)
        return () => { state.listeners.delete(fn) }
      }, [])
      return state.open
    }

    // ---- UI language -------------------------------------------------------
    // Persisted preference wins over the browser default; both stores share
    // the same listener-tick pattern as `open`.
    const LANG_KEY = 'dshim-lang'
    const initialLang = () => {
      try {
        const v = localStorage.getItem(LANG_KEY)
        if (v === 'zh' || v === 'en') return v
      } catch (e) { }
      const nav = (typeof navigator !== 'undefined' && navigator.language) || ''
      return /^zh/i.test(nav) ? 'zh' : 'en'
    }
    const langStore = { lang: initialLang(), listeners: new Set() }
    const setLang = (lang) => {
      langStore.lang = lang === 'en' ? 'en' : 'zh'
      try { localStorage.setItem(LANG_KEY, langStore.lang) } catch (e) { }
      langStore.listeners.forEach((fn) => fn())
    }
    const useLang = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const fn = () => setTick((n) => n + 1)
        langStore.listeners.add(fn)
        return () => { langStore.listeners.delete(fn) }
      }, [])
      return langStore.lang
    }

    const STRINGS = {
      zh: {
        appTitle: 'dsh 管理',
        itemsCount: (n) => n + ' 个',
        stopAll: '全部结束',
        confirmAll: '确认全部结束？',
        stopAllTitle: '结束全部托管实例（含当前窗口）；会话已持久化，重启 dsh 后恢复',
        refreshTitle: '刷新',
        closeTitle: '关闭',
        startNew: '+ 启动新实例',
        starting: '启动中…',
        startNewTitle: '在第一个空闲端口启动一个新的 dsh 实例',
        loading: '加载中…',
        empty: '3080–3129 端口没有发现 dsh 实例，点上方按钮启动一个',
        foot: '4s 自动刷新 · 「停止当前」需二次确认 · 点击行看详情',
        updatedAtPrefix: '更新于 ',
        badgeCurrent: '当前会话',
        badgeRunning: '运行中',
        badgeOther: '非 dsh 服务',
        skew: '版本差异',
        skewTitle: (v, cur) => '该实例运行 v' + v + '，当前实例 v' + cur + '；全舰队版本一致后可移除旧版兼容路由',
        sessionsSuffix: (n) => n + ' 会话',
        mine: '本面板所在实例',
        uptime: (d, hh, mm) => d > 0 ? ('已运行 ' + d + ' 天 ' + hh + ' 小时') : hh > 0 ? ('已运行 ' + hh + ' 小时 ' + mm + ' 分') : ('已运行 ' + mm + ' 分钟'),
        stopBtn: '停止',
        stopCurrentBtn: '停止当前',
        confirmStop: '确认结束？',
        stoppingBtn: '停止中…',
        stoppingAll: '正在结束全部实例…',
        byeSelf: '当前实例已停止，会话已落盘——重启 DSH 后可继续原会话。本标签页可以关闭了。',
        byeAll: '全部实例已结束，本标签页可以关闭了。',
        stopTitleCurrent: '结束当前实例：界面会断开，会话已持久化，重启 dsh 后自动恢复',
        stopTitleUnmanaged: '该实例未挂载本管理面板或不是 dsh 服务，无法从这里停止（重启该实例后可管理）',
        stopTitleManaged: '停止该实例（通知其优雅退出，会话正常落盘）',
        langBtn: 'EN',
        langTitle: '切换到 English',
        startedAtLabel: '启动于',
        memTrend: '内存走势',
        noLog: '暂无日志文件（该实例可能不是从面板启动的）',
        logTitle: '日志（最近 200 行）',
        logStdout: 'stdout',
        logStderr: 'stderr',
        err: {
          cross_site: '已拒绝跨站请求',
          bad_host: 'Host 不是回环地址',
          bad_origin: 'Origin 不同源',
          need_post: (a) => a + ' 需要 POST 请求',
          no_free_port: '3080–3129 端口全部被占用',
          no_node: '未找到 node 可执行文件',
          no_dsh_bin: '未找到 dsh 启动器',
          no_port: '缺少端口参数',
          stop_unconfirmed: '目标实例没有确认停止（未挂载本管理面板或不可达）',
          unknown_action: '未知操作',
          internal: '内部错误',
          generic: '操作失败'
        }
      },
      en: {
        appTitle: 'dsh manager',
        itemsCount: (n) => n + ' running',
        stopAll: 'Stop all',
        confirmAll: 'Confirm stop all?',
        stopAllTitle: 'Stops every managed instance (including this window); sessions are persisted and resume after restart',
        refreshTitle: 'Refresh',
        closeTitle: 'Close',
        startNew: '+ New instance',
        starting: 'Starting…',
        startNewTitle: 'Start a new dsh instance on the first free port',
        loading: 'Loading…',
        empty: 'No dsh instance found on ports 3080–3129 — use the button above to launch one',
        foot: 'auto-refresh 4s · stopping the current instance asks twice · click a row for details',
        updatedAtPrefix: 'updated ',
        badgeCurrent: 'current session',
        badgeRunning: 'running',
        badgeOther: 'non-dsh service',
        skew: 'version skew',
        skewTitle: (v, cur) => 'That instance runs v' + v + ', this panel runs v' + cur + '; once the fleet matches, the legacy alias route can be retired',
        sessionsSuffix: (n) => n + ' session' + (n === 1 ? '' : 's'),
        mine: 'this panel\u2019s instance',
        uptime: (d, hh, mm) => d > 0 ? ('up ' + d + 'd ' + hh + 'h') : hh > 0 ? ('up ' + hh + 'h ' + mm + 'm') : ('up ' + mm + 'm'),
        stopBtn: 'Stop',
        stopCurrentBtn: 'Stop current',
        confirmStop: 'Confirm?',
        stoppingBtn: 'Stopping…',
        stoppingAll: 'Stopping all instances…',
        byeSelf: 'Instance stopped — sessions persisted; restart DSH to resume. You can close this tab.',
        byeAll: 'All instances stopped — you can close this tab.',
        stopTitleCurrent: 'Exits this instance: the UI disconnects, sessions stay persisted and resume on next start',
        stopTitleUnmanaged: 'This instance does not mount the panel (or is not a dsh service), so it cannot be stopped from here (restart it to manage)',
        stopTitleManaged: 'Stops the instance (graceful exit via appExit; sessions persist)',
        langBtn: '中',
        langTitle: 'Switch to 中文',
        startedAtLabel: 'started',
        memTrend: 'memory trend',
        noLog: 'No log file yet (this instance was probably not launched from the panel)',
        logTitle: 'Logs (last 200 lines)',
        logStdout: 'stdout',
        logStderr: 'stderr',
        err: {
          cross_site: 'Cross-site request rejected',
          bad_host: 'Non-loopback Host rejected',
          bad_origin: 'Foreign Origin rejected',
          need_post: (a) => a + ' requires POST',
          no_free_port: 'All ports 3080–3129 are occupied',
          no_node: 'node executable not found',
          no_dsh_bin: 'dsh launcher not found',
          no_port: 'Missing port parameter',
          stop_unconfirmed: 'Target did not acknowledge the stop (bundle not mounted there, or unreachable)',
          unknown_action: 'Unknown action',
          internal: 'Internal error',
          generic: 'Request failed'
        }
      }
    }

    // Map a host failure payload into the active language: known `code` wins,
    // raw server text is the fallback (and what old panels keep showing).
    const localizeError = (res, t) => {
      if (!res) return t.err.generic
      const mapped = res.code ? t.err[res.code] : undefined
      if (mapped !== undefined) return typeof mapped === 'function' ? mapped(res.action || '') : mapped
      return String(res.error || t.err.generic)
    }

    // Mutating actions go out as POST; the host half rejects them over GET
    // (see README "安全模型"). stop-self is only ever sent host-to-host.
    const POST_ACTIONS = { start: 1, stop: 1, 'stop-all': 1 }
    const api = async (params) => {
      const q = Object.keys(params).map((k) => k + '=' + encodeURIComponent(String(params[k]))).join('&')
      const res = await fetch('/dsh-instance-manager/api?' + q, {
        method: POST_ACTIONS[params.action] ? 'POST' : 'GET'
      })
      return await res.json()
    }

    function fmtUptime(startedAt, t) {
      if (!startedAt) return ''
      const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      return t.uptime(Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60))
    }

    // Resident memory from the instance's own self-report (process.memoryUsage().rss).
    function fmtMem(rss) {
      if (typeof rss !== 'number' || rss <= 0) return ''
      const mb = rss / 1048576
      return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB'
    }

    // Local time plus the viewer's IANA zone name. Rendered entirely
    // client-side from the epoch ms — nothing about the user's timezone is
    // ever reported or stored anywhere; it is a display detail of their own
    // browser environment, same class as locale formatting itself.
    function fmtStartAt(startedAt) {
      if (!startedAt) return ''
      const local = new Date(startedAt).toLocaleString(undefined, { hour12: false })
      try {
        return local + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')'
      } catch (e) {
        return local
      }
    }

    // Inline SVG sparkline over the panel's own rss samples (client-side
    // history: one point per 4s poll, last 60 kept — nothing persisted).
    function Spark(props) {
      const pts = (props.points || []).filter((p) => typeof p.rss === 'number' && p.rss > 0)
      if (pts.length < 2) return null
      const vals = pts.map((p) => p.rss)
      const min = Math.min.apply(null, vals)
      const max = Math.max.apply(null, vals)
      const span = Math.max(1, max - min)
      const W = 300, H = 38
      const step = W / (pts.length - 1)
      const path = pts.map((p, i) =>
        (i ? 'L' : 'M') + (i * step).toFixed(1) + ',' + (H - 3 - ((p.rss - min) / span) * (H - 6)).toFixed(1)).join(' ')
      return h('svg', { className: 'dshim-spark', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' },
        h('path', { d: path, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.5 }))
    }

    function Drawer(props) {
      const it = props.it
      const t = props.t
      const log = props.log
      const hist = props.hist || []
      let latestRss = null
      for (let i = hist.length - 1; i >= 0; i--) {
        if (typeof hist[i].rss === 'number' && hist[i].rss > 0) { latestRss = hist[i].rss; break }
      }
      return h('div', { className: 'dshim-drawer' },
        h('div', { className: 'dshim-dline' },
          typeof it.pid === 'number' ? h('span', null, 'pid ' + it.pid) : null,
          it.startedAt ? h('span', null, t.startedAtLabel + ' ' + fmtStartAt(it.startedAt)) : null,
          it.version ? h('span', null, 'v' + it.version) : null,
          typeof it.sessions === 'number' && it.sessions > 0 ? h('span', null, t.sessionsSuffix(it.sessions)) : null),
        latestRss !== null || hist.length > 0 ? [
          h('div', { className: 'dshim-sparhead', key: 'sh' },
            h('span', null, t.memTrend),
            h('span', { className: 'dshim-spacer' }),
            latestRss !== null ? h('span', null, fmtMem(latestRss)) : null),
          h(Spark, { key: 'sp', points: hist })
        ] : null,
        h('div', { className: 'dshim-dhead', key: 'lh' },
          h('span', null, t.logTitle),
          h('button', {
            className: 'dshim-tab' + (props.stream === 'out' ? ' dshim-tab-on' : ''),
            onClick: () => props.onStream('out')
          }, t.logStdout),
          h('button', {
            className: 'dshim-tab' + (props.stream === 'err' ? ' dshim-tab-on' : ''),
            onClick: () => props.onStream('err')
          }, t.logStderr)),
        log === null
          ? h('div', { key: 'lb' }, t.loading)
          : !log.exists
            ? h('div', { key: 'lb' }, t.noLog)
            : h('pre', { className: 'dshim-log', key: 'lb' },
              log.lines && log.lines.length ? log.lines.join('\n') : '—'))
    }

    const pluginIcon = h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('rect', { x: 2, y: 3, width: 20, height: 7, rx: 2 }),
      h('rect', { x: 2, y: 14, width: 20, height: 7, rx: 2 }),
      h('line', { x1: 6, y1: 6.5, x2: 6.01, y2: 6.5 }),
      h('line', { x1: 6, y1: 17.5, x2: 6.01, y2: 17.5 }))
    const refreshIcon = h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36L21 7' }),
      h('polyline', { points: '21 3 21 7 17 7' }))

    function SidebarAction(props) {
      const open = useOpen()
      const t = STRINGS[useLang()]
      const wide = !!props.wide
      return h('button', {
        className: 'dshim-action' + (open ? ' dshim-action-active' : ''),
        onClick: () => setOpen(!open),
        title: t.appTitle,
      }, wide ? [pluginIcon, ' ', t.appTitle] : pluginIcon)
    }

    function Row(props) {
      const it = props.it
      const busy = props.busy
      const confirmPort = props.confirmPort
      const onConfirm = props.onConfirm
      const t = STRINGS[useLang()]
      const dotClass = it.current ? 'dshim-dot-cur' : (it.ui ? '' : 'dshim-dot-other')
      const badgeClass = it.current ? 'dshim-badge-cur' : (it.ui ? 'dshim-badge-ok' : 'dshim-badge-other')
      const badgeText = it.current ? t.badgeCurrent : (it.ui ? t.badgeRunning : t.badgeOther)
      // Version skew: a managed instance reporting a different plugin version
      // than the one serving this panel — the visible signal of a mixed-
      // version fleet (and, once it reads clean, of alias-removal readiness).
      const skewed = !!props.selfVersion && !!it.managed && !!it.version && it.version !== props.selfVersion
      const parts = []
      if (typeof it.pid === 'number') parts.push('pid ' + it.pid)
      if (it.name) parts.push(it.name)
      const up = fmtUptime(it.startedAt, t)
      if (up) parts.push(up)
      const mem = fmtMem(it.rss)
      if (mem) parts.push(mem)
      if (it.version) parts.push('v' + it.version)
      if (typeof it.sessions === 'number' && it.sessions > 0) parts.push(t.sessionsSuffix(it.sessions))
      if (it.current) parts.push(t.mine)
      // Busy and confirm state are keyed by PORT everywhere: pid is absent on
      // unmanaged rows and never equals port, so mixing the two silently
      // killed the "stopping…" feedback and the confirm highlight.
      const confirming = it.current && confirmPort === it.port
      return h('div', {
        className: 'dshim-row',
        onClick: () => props.onToggle(it.port)
      },
        h('span', { className: 'dshim-caret' }, props.expanded ? '▾' : '▸'),
        h('span', { className: 'dshim-dot ' + dotClass }),
        h('div', { className: 'dshim-main' },
          h('div', { className: 'dshim-line1' },
            h('a', {
              className: 'dshim-port', href: it.url, target: '_blank', rel: 'noreferrer',
              onClick: (e) => e.stopPropagation()
            }, ':' + it.port),
            h('span', { className: 'dshim-badge ' + badgeClass }, badgeText),
            skewed ? h('span', {
              className: 'dshim-badge dshim-badge-old',
              title: t.skewTitle(it.version, props.selfVersion)
            }, t.skew) : null),
          h('div', { className: 'dshim-line2' }, parts.join(' · '))),
        h('button', {
          className: 'dshim-btn-danger' + (confirming ? ' dshim-btn-danger-strong' : ''),
          disabled: !!busy[it.port] || it.managed === false,
          onClick: (e) => { e.stopPropagation(); onConfirm(it) },
          title: it.current
            ? t.stopTitleCurrent
            : it.managed === false
              ? t.stopTitleUnmanaged
              : t.stopTitleManaged
        }, busy[it.port] ? t.stoppingBtn : confirming ? t.confirmStop : it.current ? t.stopCurrentBtn : t.stopBtn))
    }

    function PanelBody() {
      const t = STRINGS[useLang()]
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState({})
      const [confirmPort, setConfirmPort] = React.useState(null)
      const [confirmAll, setConfirmAll] = React.useState(false)
      const [starting, setStarting] = React.useState(false)
      const [bye, setBye] = React.useState('')
      const byeRef = React.useRef('')
      byeRef.current = bye
      const [updatedAt, setUpdatedAt] = React.useState('')
      // Detail drawer: which port is expanded, which log stream is shown, and
      // the client-side rss history (one sample per poll, last 60).
      const [expanded, setExpanded] = React.useState(null)
      const [logStream, setLogStream] = React.useState('out')
      const [logData, setLogData] = React.useState(null)
      const histRef = React.useRef({})
      const expandedRef = React.useRef(null)
      expandedRef.current = expanded
      const logStreamRef = React.useRef('out')
      logStreamRef.current = logStream
      const loadLogs = async (port, stream) => {
        try {
          const r = await api({ action: 'logs', port: port, stream: stream })
          if (r && r.ok) setLogData(r)
        } catch (err) { }
      }
      const refresh = async () => {
        try {
          const res = await api({ action: 'list' })
          setData(res)
          setError(res && res.error ? localizeError(res, t) : null)
          setUpdatedAt(new Date().toLocaleTimeString())
          // Sample the fleet for the drawer sparklines while we are here.
          if (res && Array.isArray(res.items)) {
            const hist = histRef.current
            for (const it of res.items) {
              if (!it.managed) continue
              const arr = hist[it.port] || (hist[it.port] = [])
              arr.push({
                rss: typeof it.rss === 'number' ? it.rss : null,
                sessions: typeof it.sessions === 'number' ? it.sessions : null
              })
              if (arr.length > 60) arr.splice(0, arr.length - 60)
            }
          }
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }
      React.useEffect(() => { refresh() }, [])
      // (Re)load logs whenever the expanded row or stream tab changes.
      React.useEffect(() => {
        setLogData(null)
        if (expanded === null) return
        loadLogs(expanded, logStream)
      }, [expanded, logStream])
      React.useEffect(() => {
        let alive = true
        let timerId = 0
        const tick = () => {
          if (!alive) return
          // Each poll probes up to 50 local ports — skip the sweep entirely
          // while the tab is hidden (visibilitychange refreshes on return),
          // and stop altogether once this panel's own instance said goodbye.
          if (!document.hidden && !byeRef.current) {
            refresh()
            if (expandedRef.current !== null) loadLogs(expandedRef.current, logStreamRef.current)
          }
          timerId = setTimeout(tick, 4000)
        }
        const onVisible = () => { if (alive && !document.hidden) refresh() }
        document.addEventListener('visibilitychange', onVisible)
        timerId = setTimeout(tick, 4000)
        return () => {
          alive = false
          clearTimeout(timerId)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])
      const stop = async (item) => {
        setBusy((b) => { const n = {}; n[item.port] = true; return Object.assign({}, b, n) })
        let failMsg = null
        try {
          const res = await api({ action: 'stop', port: item.port })
          if (!res || !res.ok) failMsg = localizeError(res, t)
        } catch (err) {
          if (!item.current) failMsg = String(err && err.message ? err.message : err)
        }
        setBusy((b) => { const n = {}; n[item.port] = false; return Object.assign({}, b, n) })
        if (item.current) {
          // The serving instance is going away: swap to a farewell screen and
          // halt polling instead of spinning into guaranteed-failing calls.
          setBye(t.byeSelf)
          return
        }
        // A target still booting can answer the forwarded stop slower than the
        // forward timeout yet exit gracefully right after — if the row is
        // already gone, the stop succeeded in every way that matters.
        try {
          const lst = await api({ action: 'list' })
          const stillThere = !!(lst && Array.isArray(lst.items) && lst.items.some((i) => i.port === item.port))
          if (failMsg && !stillThere) failMsg = null
        } catch (err) { }
        if (failMsg) setError(failMsg)
        refresh()
      }
      const requestStop = (item) => {
        if (item.current && confirmPort !== item.port) {
          setConfirmPort(item.port)
          setTimeout(() => setConfirmPort((p) => (p === item.port ? null : p)), 4000)
          return
        }
        setConfirmPort(null)
        stop(item)
      }
      const startNew = async () => {
        setStarting(true)
        try {
          const r = await api({ action: 'start' })
          if (!r || !r.ok) setError(localizeError(r, t))
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
        setStarting(false)
        refresh()
      }
      const stopAll = async () => {
        setBye(t.stoppingAll)
        // The serving instance exits mid-request; its response will never
        // land. Fire-and-forget, then settle on the final farewell once the
        // fleet had a moment to go down.
        api({ action: 'stop-all' }).catch(() => { })
        setTimeout(() => setBye(t.byeAll), 2600)
      }
      const requestStopAll = () => {
        if (!confirmAll) {
          setConfirmAll(true)
          setTimeout(() => setConfirmAll(false), 4000)
          return
        }
        setConfirmAll(false)
        stopAll()
      }
      const items = data ? data.items : null
      const managedCount = items ? items.filter((i) => i.managed).length : 0
      if (bye) {
        return h('div', { className: 'dshim-empty' }, bye)
      }
      return [
        h('div', { className: 'dshim-head', key: 'head' },
          pluginIcon,
          h('h3', { className: 'dshim-title' }, t.appTitle),
          items ? h('span', { className: 'dshim-count' }, t.itemsCount(items.length)) : null,
          h('span', { className: 'dshim-spacer' }),
          items && managedCount > 0 ? h('button', {
            className: 'dshim-btn dshim-btn-danger' + (confirmAll ? ' dshim-btn-danger-strong' : ''),
            onClick: requestStopAll,
            key: 'all',
            title: t.stopAllTitle
          }, confirmAll ? t.confirmAll : t.stopAll) : null,
          h('button', {
            className: 'dshim-btn', onClick: () => setLang(langStore.lang === 'zh' ? 'en' : 'zh'),
            key: 'lang', title: t.langTitle
          }, t.langBtn),
          h('button', { className: 'dshim-iconbtn', onClick: refresh, key: 'refresh', title: t.refreshTitle }, refreshIcon),
          h('button', { className: 'dshim-iconbtn', onClick: () => setOpen(false), key: 'close', title: t.closeTitle }, '×')),
        error ? h('div', { className: 'dshim-err', key: 'err' }, error) : null,
        h('div', { className: 'dshim-body', key: 'body' },
          h('div', { className: 'dshim-toolbar', key: 'toolbar' },
            h('button', { className: 'dshim-btn', onClick: startNew, disabled: starting, title: t.startNewTitle },
              starting ? t.starting : t.startNew)),
          items === null ? h('div', { className: 'dshim-empty' }, t.loading) :
            items.length === 0 ? h('div', { className: 'dshim-empty' }, t.empty) :
              [].concat.apply([], items.map((it) => [
                h(Row, {
                  key: String(it.port), it: it, busy: busy, confirmPort: confirmPort,
                  onConfirm: requestStop, selfVersion: data ? data.selfVersion : null,
                  expanded: expanded === it.port,
                  onToggle: (p) => setExpanded((cur) => (cur === p ? null : p))
                }),
                expanded === it.port
                  ? h(Drawer, {
                    key: 'd' + it.port, it: it, t: t, hist: histRef.current[it.port] || [],
                    log: logData && logData.port === it.port ? logData : null,
                    stream: logStream, onStream: setLogStream
                  })
                  : null
              ]))),
        h('div', { className: 'dshim-foot', key: 'foot' },
          h('span', null, t.foot),
          h('span', { className: 'dshim-spacer' }),
          updatedAt ? h('span', null, t.updatedAtPrefix + updatedAt) : null)
      ]
    }

    function Overlay() {
      const open = useOpen()
      if (!open) return null
      return h('div', { className: 'dshim-panel' }, h(PanelBody, null))
    }

    const plugin = {
      apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return
        slots.inject('sidebar.footer.action', () => slots.register(
          { name: 'sidebar.footer.action', id: 'instance-manager', order: -10, label: 'dsh 管理' },
          (props) => h(SidebarAction, props)))
        slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'instance-manager-panel', order: 100 },
          (props) => h(Overlay, props)))
      },
    }

    module.exports = plugin
    return module.exports
  },
})
