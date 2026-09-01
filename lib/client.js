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

    // Mini Utility Dock registry. Each plugin owns its panel; the dock only
    // aggregates explicit launchers and follows the live sidebar edge.
    // Keeping the versioned protocol on window makes load order irrelevant.
    const DOCK_KEY = '__CREATEHELPER_DSH_UTILITY_DOCK_V1__'
    const DOCK_PROTOCOL = 'createhelper.dsh.utility-dock'
    const DOCK_VERSION = 1
    const DOCK_PLACEMENT_KEY = 'createhelper.utilityDock.placement'
    // Live preferences. The host half registers this namespace on the harness
    // settings document (see lib/shared.js) and these four constants must stay
    // in lockstep with it — the browser half imports nothing, by design.
    const SETTINGS_NAMESPACE = 'dsh-instance-manager'
    const DOCK_PLACEMENTS = ['main-bottom-left', 'main-bottom-right', 'hidden']
    const DEFAULT_DOCK_PLACEMENT = 'main-bottom-left'
    const DEFAULT_REFRESH_INTERVAL_MS = 4000
    const REFRESH_INTERVAL_MIN_MS = 1000
    const REFRESH_INTERVAL_MAX_MS = 60000
    const isCompatibleDock = (value) => !!value &&
      typeof value.register === 'function' &&
      typeof value.setPlacement === 'function' &&
      typeof value.getPlacement === 'function' &&
      // Builds before the protocol metadata shipped already implemented v1.
      (value.protocol === undefined ||
        (value.protocol === DOCK_PROTOCOL && value.version === DOCK_VERSION))
    function getUtilityDock() {
      if (isCompatibleDock(window[DOCK_KEY])) return window[DOCK_KEY]
      const items = new Map()
      let root = null
      let resizeObserver = null
      let mutationObserver = null
      const readPlacement = () => {
        try {
          const value = localStorage.getItem(DOCK_PLACEMENT_KEY)
          if (value === 'main-bottom-right' || value === 'hidden') return value
        } catch (e) { }
        return 'main-bottom-left'
      }
      let placement = readPlacement()
      const updateGeometry = () => {
        if (!root) return
        root.hidden = placement === 'hidden'
        root.dataset.placement = placement
        document.documentElement.dataset.createhelperUtilityDockPlacement = placement
        root.style.right = ''
        root.style.left = ''
        if (placement === 'main-bottom-right') {
          root.style.right = '16px'
          return
        }
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay && overlay.parentElement
        const sidebar = frame && frame.firstElementChild
        const frameRect = frame && frame.getBoundingClientRect()
        const sidebarRect = sidebar && sidebar.getBoundingClientRect()
        const left = frameRect && sidebarRect
          ? Math.max(16, Math.round(sidebarRect.right - frameRect.left + frameRect.left + 16))
          : 80
        root.style.left = left + 'px'
        document.documentElement.style.setProperty('--createhelper-utility-dock-left', left + 'px')
      }
      const render = () => {
        if (!root) {
          root = document.createElement('nav')
          root.className = 'createhelper-utility-dock'
          root.setAttribute('aria-label', 'DSH utilities')
          document.body.appendChild(root)
          window.addEventListener('resize', updateGeometry)
          const observeLayout = () => {
            const overlay = document.querySelector('[data-shell-overlay]')
            const frame = overlay && overlay.parentElement
            if (!frame) return false
            mutationObserver?.disconnect()
            mutationObserver = null
            if (typeof ResizeObserver === 'function' && !resizeObserver) {
              resizeObserver = new ResizeObserver(updateGeometry)
              resizeObserver.observe(frame)
              if (frame.firstElementChild) resizeObserver.observe(frame.firstElementChild)
            }
            updateGeometry()
            return true
          }
          if (!observeLayout() && typeof MutationObserver === 'function') {
            mutationObserver = new MutationObserver(() => { observeLayout() })
            mutationObserver.observe(document.body, { childList: true, subtree: true })
          }
        }
        root.replaceChildren()
        Array.from(items.values()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).forEach((item) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'createhelper-utility-dock-item'
          button.dataset.createhelperDockItem = item.id
          button.title = item.label
          button.setAttribute('aria-label', item.label)
          button.setAttribute('aria-pressed', item.active ? 'true' : 'false')
          button.innerHTML = item.icon
          button.addEventListener('click', () => {
            if (!item.active) {
              for (const other of items.values()) {
                if (other.id !== item.id && other.active && typeof other.onDeactivate === 'function') {
                  other.onDeactivate()
                }
              }
            }
            item.onActivate()
          })
          root.appendChild(button)
        })
        updateGeometry()
      }
      const api = {
        protocol: DOCK_PROTOCOL,
        version: DOCK_VERSION,
        register(item) {
          if (!item || typeof item.id !== 'string' || !item.id || typeof item.onActivate !== 'function') {
            throw new TypeError('Mini Utility Dock item requires a non-empty id and onActivate()')
          }
          const registration = Object.freeze({})
          items.set(item.id, { ...item, registration, order: Number(item.order) || 0, active: !!item.active })
          render()
          return {
            update(patch) {
              const current = items.get(item.id)
              if (!current || current.registration !== registration) return
              items.set(item.id, { ...current, ...patch })
              render()
            },
            dispose() {
              const current = items.get(item.id)
              if (!current || current.registration !== registration) return
              items.delete(item.id)
              if (items.size) { render(); return }
              resizeObserver?.disconnect()
              resizeObserver = null
              mutationObserver?.disconnect()
              mutationObserver = null
              window.removeEventListener('resize', updateGeometry)
              root?.remove()
              root = null
            }
          }
        },
        setPlacement(next) {
          placement = next === 'main-bottom-right' || next === 'hidden' ? next : 'main-bottom-left'
          try { localStorage.setItem(DOCK_PLACEMENT_KEY, placement) } catch (e) { }
          updateGeometry()
        },
        getPlacement() { return placement }
      }
      window[DOCK_KEY] = api
      return api
    }

    // Style tags carry data-plugin-css exactly like shipped bundles (the
    // kernel/HMR bookkeeping keys off it); guard against double injection.
    const CSS_ID = 'dsh-instance-manager'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin-css', CSS_ID)
      styleEl.textContent =
        '.createhelper-utility-dock{position:fixed;bottom:16px;z-index:9997;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 6px 22px rgba(0,0,0,.24);pointer-events:auto}' +
        '.createhelper-utility-dock[hidden]{display:none}' +
        '.createhelper-utility-dock-item{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}' +
        '.createhelper-utility-dock-item:hover,.createhelper-utility-dock-item[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}' +
        '.createhelper-utility-dock-item svg{display:block}' +
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
        '.dshim-log{margin:0;padding:8px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-family:ui-monospace,Consolas,Menlo,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;color:var(--dsw-alias-label-primary)}' +
        '.dshim-sess{max-height:110px}' +
        '.dshim-toasts{position:fixed;bottom:16px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:9998;pointer-events:none;font-size:12px}' +
        '.dshim-toast{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:10px;padding:8px 12px;box-shadow:0 8px 24px rgba(0,0,0,.25)}' +
        '.dshim-badge-remote{color:var(--dsw-alias-label-secondary);border-style:dashed}'
      document.head.appendChild(styleEl)
    }

    // shared open-state store between the footer action and the overlay
    const state = { open: false, listeners: new Set() }
    let dockItem = null
    const setOpen = (v) => {
      state.open = v
      state.listeners.forEach((fn) => fn())
      dockItem?.update({ active: state.open })
    }
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

    // ---- live preferences ------------------------------------------------
    // Dock placement and poll interval moved from localStorage / a hardcoded
    // 4s to the host-registered settings namespace, so they survive a profile
    // reinstall and are editable from the harness settings page. The store is
    // still plain module state: the poll timer re-reads it on every schedule,
    // so a change lands on the next tick without remounting anything. The
    // browser half imports nothing, so these constants must stay in lockstep
    // with lib/shared.js.
    const clampRefreshInterval = (raw) => {
      const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(String(raw).trim()) ? Number(String(raw).trim()) : NaN)
      if (!Number.isFinite(n)) return DEFAULT_REFRESH_INTERVAL_MS
      return Math.min(REFRESH_INTERVAL_MAX_MS, Math.max(REFRESH_INTERVAL_MIN_MS, Math.round(n)))
    }
    const normalizePlacement = (raw) => (DOCK_PLACEMENTS.indexOf(raw) === -1 ? DEFAULT_DOCK_PLACEMENT : raw)
    const prefsStore = {
      dockPlacement: DEFAULT_DOCK_PLACEMENT,
      refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
      listeners: new Set()
    }
    const readLegacyPlacement = () => {
      try {
        return normalizePlacement(localStorage.getItem(DOCK_PLACEMENT_KEY))
      } catch (e) {
        return DEFAULT_DOCK_PLACEMENT
      }
    }
    const setPrefs = (patch) => {
      let changed = false
      if (patch.dockPlacement !== undefined && patch.dockPlacement !== prefsStore.dockPlacement) {
        prefsStore.dockPlacement = patch.dockPlacement
        changed = true
        // Written through the dock (never a bare DOM poke) so the versioned
        // protocol stays authoritative: whichever plugin owns the dock keeps
        // its localStorage mirror, which is what dsh-treekeeper reads.
        if (isCompatibleDock(window[DOCK_KEY])) window[DOCK_KEY].setPlacement(patch.dockPlacement)
      }
      if (patch.refreshIntervalMs !== undefined && patch.refreshIntervalMs !== prefsStore.refreshIntervalMs) {
        prefsStore.refreshIntervalMs = patch.refreshIntervalMs
        changed = true
      }
      if (changed) prefsStore.listeners.forEach((fn) => fn())
      return changed
    }
    const usePrefs = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const fn = () => setTick((n) => n + 1)
        prefsStore.listeners.add(fn)
        return () => { prefsStore.listeners.delete(fn) }
      }, [])
      return prefsStore
    }
    // "4" for 4000ms, "7.5" for 7500ms — the footer states the cadence the
    // panel actually runs at, not a constant that drifted away from it.
    const refreshSecondsLabel = (ms) => String(Math.round(ms / 100) / 10)

    const STRINGS = {
      zh: {
        appTitle: 'DSH Instance',
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
        empty: '本机托管端口段没有发现 dsh 实例，点上方按钮启动一个',
        foot: (s) => s + 's 自动刷新 · 点击行看详情',
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
        byeSelf: '当前实例已停止，请关闭对应页面。',
        byeAll: '全部实例已结束，请关闭对应页面。',
        stopTitleCurrent: '结束当前实例：界面会断开，会话已持久化，重启 dsh 后自动恢复',
        stopTitleUnmanaged: '该实例未挂载本管理面板或不是 dsh 服务，无法从这里停止（重启该实例后可管理）',
        stopTitleManaged: '停止该实例（通知其优雅退出，会话正常落盘）',
        langBtn: 'EN',
        langTitle: '切换到 English',
        startedAtLabel: '启动于',
        memTrend: '内存走势',
        noLog: '暂无日志文件（该实例可能不是从面板启动的）',
        logUnavail: '目标未提供日志（旧版面板或不可达）',
        logTitle: '日志（最近 200 行）',
        logStdout: 'stdout',
        logStderr: 'stderr',
        sessTitle: '活跃会话',
        sessEmpty: '无活跃会话',
        sessUnavail: '目标未提供会话概要（旧版面板或不可达）',
        sessMore: (n) => '… 还有 ' + n + ' 个',
        sessSub: '子代理',
        stopTitleRemote: '远程实例控制将在后续版本支持',
        toastUp: (p) => '实例上线 :' + p,
        toastDown: (p) => '实例已下线 :' + p,
        toastPeerUp: (id) => 'peer 上线 @' + id,
        toastPeerDown: (id) => 'peer 离线 @' + id,
        err: {
          cross_site: '已拒绝跨站请求',
          bad_host: 'Host 不是回环地址',
          bad_origin: 'Origin 不同源',
          need_post: (a) => a + ' 需要 POST 请求',
          no_free_port: '托管端口段已全部被占用',
          start_failed: '新实例未能启动（端口被抢占或启动失败）',
          start_unconfirmed: '实例仍在启动、暂未应答，稍后刷新列表确认',
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
        appTitle: 'DSH Instance',
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
        empty: 'No dsh instance found in the managed port band — use the button above to launch one',
        foot: (s) => 'auto-refresh ' + s + 's · click a row for details',
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
        byeSelf: 'Instance stopped. Please close the tab(s).',
        byeAll: 'All instances stopped. Please close the tab(s).',
        stopTitleCurrent: 'Exits this instance: the UI disconnects, sessions stay persisted and resume on next start',
        stopTitleUnmanaged: 'This instance does not mount the panel (or is not a dsh service), so it cannot be stopped from here (restart it to manage)',
        stopTitleManaged: 'Stops the instance (graceful exit via appExit; sessions persist)',
        langBtn: '中',
        langTitle: 'Switch to 中文',
        startedAtLabel: 'started',
        memTrend: 'memory trend',
        noLog: 'No log file yet (this instance was probably not launched from the panel)',
        logUnavail: 'target does not expose logs (legacy or unreachable)',
        logTitle: 'Logs (last 200 lines)',
        logStdout: 'stdout',
        logStderr: 'stderr',
        sessTitle: 'live sessions',
        sessEmpty: 'no active sessions',
        sessUnavail: 'target does not expose session summaries (legacy or unreachable)',
        sessMore: (n) => '… ' + n + ' more',
        sessSub: 'subagent',
        stopTitleRemote: 'Remote control lands in a later release',
        toastUp: (p) => 'instance up :' + p,
        toastDown: (p) => 'instance down :' + p,
        toastPeerUp: (id) => 'peer up @' + id,
        toastPeerDown: (id) => 'peer down @' + id,
        err: {
          cross_site: 'Cross-site request rejected',
          bad_host: 'Non-loopback Host rejected',
          bad_origin: 'Foreign Origin rejected',
          need_post: (a) => a + ' requires POST',
          no_free_port: 'Every port in the managed band is occupied',
          start_failed: 'New instance failed to start (port grabbed or crash)',
          start_unconfirmed: 'Still booting with no answer yet — refresh the list shortly',
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
      // Absent params are dropped, never stringified: `String(undefined)` is
      // the literal "undefined", so an omitted `peer` used to reach the host
      // as peer=undefined — a perfectly well-formed unknown peer id, which
      // routed every LOCAL log/session read through the peer path and failed.
      const q = Object.keys(params)
        .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
        .map((k) => k + '=' + encodeURIComponent(String(params[k]))).join('&')
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

    // One drawer line for a summarized session: local HH:MM, short id,
    // working-directory basename, subagent marker, event count. Rendered
    // entirely from scalar fields the host half already extracted.
    function fmtSessionLine(s, t) {
      let time = ''
      try { time = new Date(s.createdAt).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' }) } catch (e) { }
      let base = ''
      if (s.cwd) { const parts = String(s.cwd).split(/[\\/]/); base = parts[parts.length - 1] }
      return [time, String(s.id).slice(0, 8), base, s.subagent ? t.sessSub : null,
        typeof s.events === 'number' ? s.events + ' ev' : null].filter(Boolean).join(' · ')
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
      const sess = props.sess || null
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
        it.managed ? [
          h('div', { className: 'dshim-dhead', key: 'ssh' },
            h('span', null, t.sessTitle),
            h('span', { className: 'dshim-spacer' }),
            sess && typeof sess.total === 'number' ? h('span', null, String(sess.total)) : null),
          sess === null
            ? h('div', { key: 'ssb' }, t.loading)
            : !sess.ok
              ? h('div', { key: 'ssb' }, t.sessUnavail)
              : !sess.sessions || sess.sessions.length === 0
                ? h('div', { key: 'ssb' }, t.sessEmpty)
                : h('pre', { className: 'dshim-log dshim-sess', key: 'ssb' },
                  sess.sessions.slice(0, 6).map((s) => fmtSessionLine(s, t)).join('\n') +
                  (sess.sessions.length > 6 ? '\n' + t.sessMore(sess.sessions.length - 6) : ''))
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
        // null only ever means "request in flight". A rejected read is stored
        // as ok:false so it can say so — an offline peer, or a host that
        // refused the port, otherwise spun on "loading" indefinitely.
        log === null
          ? h('div', { key: 'lb' }, t.loading)
          : !log.ok
            ? h('div', { key: 'lb' }, t.logUnavail)
            : !log.exists
              ? h('div', { key: 'lb' }, t.noLog)
              : h('pre', { className: 'dshim-log', key: 'lb' },
                log.lines && log.lines.length ? log.lines.join('\n') : '—'))
    }

    const INSTANCE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="7" rx="2"></rect><rect x="2" y="14" width="20" height="7" rx="2"></rect><line x1="6" y1="6.5" x2="6.01" y2="6.5"></line><line x1="6" y1="17.5" x2="6.01" y2="17.5"></line></svg>'
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
      // Process name deliberately omitted: every instance is node, so it was
      // zero-information width that pushed uptime/memory into truncation.
      const up = fmtUptime(it.startedAt, t)
      if (up) parts.push(up)
      const mem = fmtMem(it.rss)
      if (mem) parts.push(mem)
      if (it.version) parts.push('v' + it.version)
      if (typeof it.sessions === 'number' && it.sessions > 0) parts.push(t.sessionsSuffix(it.sessions))
      if (it.current) parts.push(t.mine)
      // Busy and confirm are keyed by ROW (source + port), never by pid and
      // never by port alone: pid is absent on unmanaged rows and never equals
      // port, so mixing those in silently killed the "stopping…" feedback and
      // the confirm highlight; port alone collides with a peer's rows.
      const confirming = it.current && confirmPort === it.rowKey
      return h('div', {
        className: 'dshim-row',
        onClick: () => props.onToggle(it.rowKey)
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
            it.remote ? h('span', {
              className: 'dshim-badge dshim-badge-remote'
            }, '@' + (it.source || 'peer')) : null,
            skewed ? h('span', {
              className: 'dshim-badge dshim-badge-old',
              title: t.skewTitle(it.version, props.selfVersion)
            }, t.skew) : null),
          h('div', { className: 'dshim-line2' }, parts.join(' · '))),
        h('button', {
          className: 'dshim-btn-danger' + (confirming ? ' dshim-btn-danger-strong' : ''),
          disabled: !!busy[it.rowKey] || it.managed === false || !!it.remote,
          onClick: (e) => { e.stopPropagation(); onConfirm(it) },
          title: it.remote
            ? t.stopTitleRemote
            : it.current
              ? t.stopTitleCurrent
              : it.managed === false
                ? t.stopTitleUnmanaged
                : t.stopTitleManaged
        }, busy[it.rowKey] ? t.stoppingBtn : confirming ? t.confirmStop : it.current ? t.stopCurrentBtn : t.stopBtn))
    }

    function PanelBody() {
      const t = STRINGS[useLang()]
      const prefs = usePrefs()
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
      // Detail drawer: which row is expanded, which log stream is shown, and
      // the client-side rss history (one sample per poll, last 60).
      const [expanded, setExpanded] = React.useState(null)
      const [logStream, setLogStream] = React.useState('out')
      const [logData, setLogData] = React.useState(null)
      const [sessData, setSessData] = React.useState(null)
      const histRef = React.useRef({})
      const expandedRef = React.useRef(null)
      expandedRef.current = expanded
      const logStreamRef = React.useRef('out')
      logStreamRef.current = logStream
      // Row identity. A port is NOT one: ever since peer rows joined the same
      // list, two machines can both be running :3080. Keying the drawer by
      // port made those rows share one expanded flag and fight over a single
      // log/session buffer — whoever loaded last won — and the poll timer, an
      // effect with [] deps whose closure is frozen at first render, resolved
      // the peer id through a `data` that was still null, so every later
      // remote read went to the LOCAL instance instead of the peer.
      //
      // Rows are stamped once, at the point items enter the panel, and the
      // ref is re-assigned on every render so the frozen polling closure
      // still sees the current table.
      const rowKeyOf = (it) => (it.remote ? (it.source || 'peer') : 'local') + ':' + it.port
      const withRowKeys = (list) => (list || []).map((it) => Object.assign({}, it, { rowKey: rowKeyOf(it) }))
      const rowsRef = React.useRef([])
      rowsRef.current = withRowKeys(data && data.items)
      const findRow = (key) => rowsRef.current.find((it) => it.rowKey === key) || null
      // Both loaders take a ROW KEY, not a port: they look the row up to get
      // its port and, for peer rows, the peer id to route through (F3).
      // Failures are recorded rather than swallowed — a drawer that only ever
      // sees `null` cannot tell "still loading" from "this will never load",
      // which is how an offline peer used to end up spinning forever.
      const loadLogs = async (key, stream) => {
        const row = findRow(key)
        if (!row) return
        try {
          const r = await api({ action: 'logs', port: row.port, stream: stream, peer: row.remote ? row.source : undefined })
          if (expandedRef.current !== key) return
          setLogData(r && r.ok
            ? Object.assign({}, r, { rowKey: key })
            : { ok: false, rowKey: key, code: (r && r.code) || null, error: (r && r.error) || null })
        } catch (err) {
          if (expandedRef.current === key) {
            setLogData({ ok: false, rowKey: key, code: null, error: String(err && err.message ? err.message : err) })
          }
        }
      }
      const loadSessions = async (key) => {
        const row = findRow(key)
        if (!row) return
        try {
          const r = await api({ action: 'sessions', port: row.port, peer: row.remote ? row.source : undefined })
          if (expandedRef.current !== key) return
          setSessData(r
            ? Object.assign({}, r, { rowKey: key })
            : { ok: false, rowKey: key, code: null, error: null })
        } catch (err) {
          if (expandedRef.current === key) {
            setSessData({ ok: false, rowKey: key, code: null, error: String(err && err.message ? err.message : err) })
          }
        }
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
            for (const it of withRowKeys(res.items)) {
              if (!it.managed) continue
              const arr = hist[it.rowKey] || (hist[it.rowKey] = [])
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
      // (Re)load logs whenever the expanded row or stream tab changes; the
      // session summary follows the expanded row only.
      React.useEffect(() => {
        setLogData(null)
        if (expanded === null) return
        loadLogs(expanded, logStream)
      }, [expanded, logStream])
      React.useEffect(() => {
        setSessData(null)
        if (expanded === null) return
        loadSessions(expanded)
      }, [expanded])
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
            if (expandedRef.current !== null) {
              loadLogs(expandedRef.current, logStreamRef.current)
              loadSessions(expandedRef.current)
            }
          }
          // Re-read the store on every schedule: the effect mounts once, so
          // the interval has to come from module state, not from a closure.
          timerId = setTimeout(tick, prefsStore.refreshIntervalMs)
        }
        const onVisible = () => { if (alive && !document.hidden) refresh() }
        document.addEventListener('visibilitychange', onVisible)
        timerId = setTimeout(tick, prefsStore.refreshIntervalMs)
        return () => {
          alive = false
          clearTimeout(timerId)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])
      const stop = async (item) => {
        setBusy((b) => { const n = {}; n[item.rowKey] = true; return Object.assign({}, b, n) })
        let failMsg = null
        try {
          const res = await api({ action: 'stop', port: item.port })
          if (!res || !res.ok) failMsg = localizeError(res, t)
        } catch (err) {
          if (!item.current) failMsg = String(err && err.message ? err.message : err)
        }
        setBusy((b) => { const n = {}; n[item.rowKey] = false; return Object.assign({}, b, n) })
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
          // Exclude peer rows: only this machine can be stopping `item`, and a
          // remote row on the same port would otherwise read as "survived".
          const stillThere = !!(lst && Array.isArray(lst.items) && lst.items.some((i) => !i.remote && i.port === item.port))
          if (failMsg && !stillThere) failMsg = null
        } catch (err) { }
        if (failMsg) setError(failMsg)
        refresh()
      }
      const requestStop = (item) => {
        if (item.current && confirmPort !== item.rowKey) {
          setConfirmPort(item.rowKey)
          setTimeout(() => setConfirmPort((p) => (p === item.rowKey ? null : p)), 4000)
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
      // Stamped rows (see rowKeyOf): `items` stays null until the first list
      // lands so the panel can say "loading" rather than "empty".
      const items = data ? rowsRef.current : null
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
          // Stop-all is the most destructive affordance on the panel: give it
          // the whole header line to itself only when there is something to
          // stop BESIDES the current instance.
          items && managedCount > 1 ? h('button', {
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
                  key: it.rowKey, it: it, busy: busy, confirmPort: confirmPort,
                  onConfirm: requestStop, selfVersion: data ? data.selfVersion : null,
                  expanded: expanded === it.rowKey,
                  onToggle: (k) => setExpanded((cur) => (cur === k ? null : k))
                }),
                expanded === it.rowKey
                  ? h(Drawer, {
                    key: 'd' + it.rowKey, it: it, t: t, hist: histRef.current[it.rowKey] || [],
                    // Matched by the key the loader stamped on its own answer,
                    // so a slow reply for the previously expanded row cannot
                    // land in this row's drawer.
                    log: logData && logData.rowKey === it.rowKey ? logData : null,
                    sess: sessData && sessData.rowKey === it.rowKey ? sessData : null,
                    stream: logStream, onStream: setLogStream
                  })
                  : null
              ]))),
        h('div', { className: 'dshim-foot', key: 'foot' },
          h('span', null, t.foot(refreshSecondsLabel(prefs.refreshIntervalMs))),
          h('span', { className: 'dshim-spacer' }),
          updatedAt ? h('span', null, t.updatedAtPrefix + updatedAt) : null)
      ]
    }

    function Overlay() {
      const open = useOpen()
      if (!open) return null
      return h('div', { className: 'dshim-panel' }, h(PanelBody, null))
    }

    // Always-on fleet up/down toasts over SSE. The connection is independent
    // of the panel: any managed instance joining/leaving pops a short-lived
    // toast bottom-right. A baseline frame on connect seeds membership
    // WITHOUT toasting, so opening a page never spams the current fleet.
    function FleetToasts() {
      const t = STRINGS[useLang()]
      const [toasts, setToasts] = React.useState([])
      React.useEffect(() => {
        let alive = true
        const timers = []
        let es
        try { es = new EventSource('/dsh-instance-manager/events') } catch (e) { return }
        let baselined = false
        const push = (msg) => {
          const item = { msg, id: Math.random() }
          setToasts((ts) => ts.concat(item).slice(-3))
          timers.push(setTimeout(() => {
            if (alive) setToasts((ts) => ts.filter((x) => x.id !== item.id))
          }, 6000))
        }
        es.addEventListener('fleet', (ev) => {
          let d
          try { d = JSON.parse(ev.data) } catch (e) { return }
          if (d.baseline) { baselined = true; return }
          if (!baselined || !alive) return
          for (const p of d.added || []) push(t.toastUp(p))
          for (const p of d.removed || []) push(t.toastDown(p))
          for (const id of d.peerUp || []) push(t.toastPeerUp(id))
          for (const id of d.peerDown || []) push(t.toastPeerDown(id))
        })
        return () => {
          alive = false
          timers.forEach(clearTimeout)
          try { es.close() } catch (e) { }
        }
      }, [langStore.lang])
      if (!toasts.length) return null
      return h('div', { className: 'dshim-toasts' },
        toasts.map((x) => h('div', { className: 'dshim-toast', key: x.id }, x.msg)))
    }

    const plugin = {
      apply(ctx) {
        // Disposal is owned by the plugin's own context, so it runs whether or
        // not the slot service ever arrived.
        ctx.on('dispose', () => {
          dockItem?.dispose()
          dockItem = null
          setOpen(false)
        })
        // Wait for the slot service instead of probing it once. Mount order
        // between this bundle and the runtime providing `slots` is not
        // guaranteed, and a missed ctx.get('slots') left the panel silently
        // absent — no error, no boot failure, just nothing in the UI. This is
        // the shape the harness's own UI packages use.
        ctx.inject(['slots'], (scope) => {
          const dock = getUtilityDock()
          dockItem = dock.register({
            id: 'instance-manager',
            order: 10,
            label: 'DSH Instance',
            icon: INSTANCE_ICON,
            active: state.open,
            onDeactivate: () => setOpen(false),
            onActivate: () => setOpen(!state.open)
          })
          scope.slots.inject('shell.overlay', () => scope.slots.register(
            { name: 'shell.overlay', id: 'instance-manager-panel', order: 100 },
            (props) => h(Overlay, props)))
          scope.slots.inject('shell.overlay', () => scope.slots.register(
            { name: 'shell.overlay', id: 'instance-manager-fleet-toasts', order: 101 },
            (props) => h(FleetToasts, props)))
        })
        // Settings-driven preferences (DIM-M1): bind the namespace the host
        // registered (settings-contract.ts) and mirror every ready snapshot
        // into prefsStore. A pre-settings localStorage placement migrates
        // ONCE into the user layer; after that settings is authoritative and
        // localStorage survives only as the dock's cross-plugin mirror (what
        // dsh-treekeeper's geometry reads follow). A separate inject call, so
        // a build without the settings UI only loses preferences — never the
        // panel (this callback then simply never fires).
        ctx.inject(['settingsScope'], (settingsCtx) => {
          if (!settingsCtx || typeof settingsCtx.bind !== 'function') return
          let scope
          try {
            scope = settingsCtx.bind({ namespace: 'dsh-instance-manager' })
          } catch (e) { return }
          const legacy = readLegacyPlacement()
          let migrated = false
          // Legacy value kept authoritative until the host commit lands (the
          // user layer then carries dockPlacement and this clears) — the
          // write-only round-trip must not snap the dock back to the default
          // in between.
          let pendingPlacement = null
          const applySnapshot = () => {
            let snap
            try { snap = scope.getSnapshot() } catch (e) { return }
            if (!snap) return
            if (snap.status === 'ready' && snap.value && typeof snap.value === 'object') {
              if (!migrated) {
                migrated = true
                const user = snap.user && typeof snap.user === 'object' ? snap.user : {}
                if (user.dockPlacement === undefined && legacy !== DEFAULT_DOCK_PLACEMENT &&
                  typeof scope.set === 'function') {
                  try { scope.set('dockPlacement', legacy).catch(() => { }) } catch (e) { }
                  pendingPlacement = legacy
                }
              }
              if (snap.user && typeof snap.user === 'object' && snap.user.dockPlacement !== undefined) {
                pendingPlacement = null
              }
              setPrefs({
                dockPlacement: normalizePlacement(
                  pendingPlacement !== null ? pendingPlacement : snap.value.dockPlacement),
                refreshIntervalMs: clampRefreshInterval(snap.value.refreshIntervalMs)
              })
            } else if (snap.status === 'unavailable') {
              // Memory mode, or the namespace is not exposed to this client:
              // keep the localStorage value instead of snapping to defaults.
              setPrefs({ dockPlacement: legacy })
            }
          }
          applySnapshot()
          if (typeof scope.subscribe === 'function') scope.subscribe(applySnapshot)
        })
      },
    }

    module.exports = plugin
    return module.exports
  },
})
