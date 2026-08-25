// dsh-instance-manager browser half. Classic-script client bundle: registers
// a factory with window.__ModuleLoader__; the client kernel materializes it
// and mounts the exported plugin. React comes from the platform seed
// (`require('react')`); host data comes from the same-origin JSON endpoint
// /dsh-instance-manager/api (registered by the host half on the webserver).
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
        '.dshim-empty{padding:22px 10px;text-align:center;color:var(--dsw-alias-label-secondary)}'
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

    function fmtUptime(startedAt) {
      if (!startedAt) return ''
      const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      const d = Math.floor(s / 86400)
      const hh = Math.floor((s % 86400) / 3600)
      const mm = Math.floor((s % 3600) / 60)
      if (d > 0) return '已运行 ' + d + ' 天 ' + hh + ' 小时'
      if (hh > 0) return '已运行 ' + hh + ' 小时 ' + mm + ' 分'
      return '已运行 ' + mm + ' 分钟'
    }

    // Resident memory from the instance's own self-report (process.memoryUsage().rss).
    function fmtMem(rss) {
      if (typeof rss !== 'number' || rss <= 0) return ''
      const mb = rss / 1048576
      return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB'
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
      const wide = !!props.wide
      return h('button', {
        className: 'dshim-action' + (open ? ' dshim-action-active' : ''),
        onClick: () => setOpen(!open),
        title: 'dsh 管理',
      }, wide ? [pluginIcon, ' ', 'dsh 管理'] : pluginIcon)
    }

    function Row(props) {
      const it = props.it
      const busy = props.busy
      const confirmPort = props.confirmPort
      const onConfirm = props.onConfirm
      const dotClass = it.current ? 'dshim-dot-cur' : (it.ui ? '' : 'dshim-dot-other')
      const badgeClass = it.current ? 'dshim-badge-cur' : (it.ui ? 'dshim-badge-ok' : 'dshim-badge-other')
      const badgeText = it.current ? '当前会话' : (it.ui ? '运行中' : '非 dsh 服务')
      // Version skew: a managed instance reporting a different plugin version
      // than the one serving this panel — the visible signal of a mixed-
      // version fleet (and, once it reads clean, of alias-removal readiness).
      const skewed = !!props.selfVersion && !!it.managed && !!it.version && it.version !== props.selfVersion
      const parts = []
      if (typeof it.pid === 'number') parts.push('pid ' + it.pid)
      if (it.name) parts.push(it.name)
      const up = fmtUptime(it.startedAt)
      if (up) parts.push(up)
      const mem = fmtMem(it.rss)
      if (mem) parts.push(mem)
      if (it.version) parts.push('v' + it.version)
      if (typeof it.sessions === 'number' && it.sessions > 0) parts.push(it.sessions + ' 会话')
      if (it.current) parts.push('本面板所在实例')
      // Busy and confirm state are keyed by PORT everywhere: pid is absent on
      // unmanaged rows and never equals port, so mixing the two silently
      // killed the "stopping…" feedback and the confirm highlight.
      const confirming = it.current && confirmPort === it.port
      return h('div', { className: 'dshim-row' },
        h('span', { className: 'dshim-dot ' + dotClass }),
        h('div', { className: 'dshim-main' },
          h('div', { className: 'dshim-line1' },
            h('a', { className: 'dshim-port', href: it.url, target: '_blank', rel: 'noreferrer' }, ':' + it.port),
            h('span', { className: 'dshim-badge ' + badgeClass }, badgeText),
            skewed ? h('span', {
              className: 'dshim-badge dshim-badge-old',
              title: '该实例运行 v' + it.version + '，当前实例 v' + props.selfVersion + '；全舰队版本一致后可移除旧版兼容路由'
            }, '版本差异') : null),
          h('div', { className: 'dshim-line2' }, parts.join(' · '))),
        h('button', {
          className: 'dshim-btn-danger' + (confirming ? ' dshim-btn-danger-strong' : ''),
          disabled: !!busy[it.port] || it.managed === false,
          onClick: () => onConfirm(it),
          title: it.current
            ? '结束当前实例：界面会断开，会话已持久化，重启 dsh 后自动恢复'
            : it.managed === false
              ? '该实例未挂载本管理面板或不是 dsh 服务，无法从这里停止（重启该实例后可管理）'
              : '停止该实例（通知其优雅退出，会话正常落盘）'
        }, busy[it.port] ? '停止中…' : confirming ? '确认结束？' : it.current ? '停止当前' : '停止'))
    }

    function PanelBody() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState({})
      const [confirmPort, setConfirmPort] = React.useState(null)
      const [confirmAll, setConfirmAll] = React.useState(false)
      const [starting, setStarting] = React.useState(false)
      const [bye, setBye] = React.useState('')
      const [updatedAt, setUpdatedAt] = React.useState('')
      const refresh = async () => {
        try {
          const res = await api({ action: 'list' })
          setData(res)
          setError(res && res.error ? res.error : null)
          setUpdatedAt(new Date().toLocaleTimeString())
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }
      React.useEffect(() => { refresh() }, [])
      React.useEffect(() => {
        let alive = true
        let timerId = 0
        const tick = () => {
          if (!alive) return
          // Each poll probes up to 50 local ports — skip the sweep entirely
          // while the tab is hidden; visibilitychange refreshes on return.
          if (!document.hidden) refresh()
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
        try {
          const res = await api({ action: 'stop', port: item.port })
          if (!res || !res.ok) setError(String(res && res.error ? res.error : 'stop failed'))
        } catch (err) {
          if (!item.current) setError(String(err && err.message ? err.message : err))
        }
        setBusy((b) => { const n = {}; n[item.port] = false; return Object.assign({}, b, n) })
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
          if (!r || !r.ok) setError(String(r && r.error ? r.error : 'start failed'))
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
        setStarting(false)
        refresh()
      }
      const stopAll = async () => {
        setBye('正在结束全部实例…')
        try { await api({ action: 'stop-all' }) } catch (err) { }
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
          h('h3', { className: 'dshim-title' }, 'dsh 管理'),
          items ? h('span', { className: 'dshim-count' }, items.length + ' 个') : null,
          h('span', { className: 'dshim-spacer' }),
          items && managedCount > 0 ? h('button', {
            className: 'dshim-btn dshim-btn-danger' + (confirmAll ? ' dshim-btn-danger-strong' : ''),
            onClick: requestStopAll,
            key: 'all',
            title: '结束全部托管实例（含当前窗口）；会话已持久化，重启 dsh 后恢复'
          }, confirmAll ? '确认全部结束？' : '全部结束') : null,
          h('button', { className: 'dshim-iconbtn', onClick: refresh, key: 'refresh', title: '刷新' }, refreshIcon),
          h('button', { className: 'dshim-iconbtn', onClick: () => setOpen(false), key: 'close', title: '关闭' }, '×')),
        error ? h('div', { className: 'dshim-err', key: 'err' }, error) : null,
        h('div', { className: 'dshim-body', key: 'body' },
          h('div', { className: 'dshim-toolbar', key: 'toolbar' },
            h('button', { className: 'dshim-btn', onClick: startNew, disabled: starting, title: '在第一个空闲端口启动一个新的 dsh 实例' },
              starting ? '启动中…' : '+ 启动新实例')),
          items === null ? h('div', { className: 'dshim-empty' }, '加载中…') :
            items.length === 0 ? h('div', { className: 'dshim-empty' }, '3080–3129 端口没有发现 dsh 实例，点上方按钮启动一个') :
              items.map((it) => h(Row, { key: String(it.port), it: it, busy: busy, confirmPort: confirmPort, onConfirm: requestStop, selfVersion: data ? data.selfVersion : null }))),
        h('div', { className: 'dshim-foot', key: 'foot' },
          h('span', null, '4s 自动刷新 · 「停止当前」需二次确认'),
          h('span', { className: 'dshim-spacer' }),
          updatedAt ? h('span', null, '更新于 ' + updatedAt) : null)
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
