// dsh-instance-manager browser half. Classic-script client bundle: registers
// a factory with window.__ModuleLoader__; the client kernel materializes it
// and mounts the exported plugin. React comes from the platform seed
// (`require('react')`); host data comes from the same-origin JSON endpoint
// /dsh-instance-manager/api (registered by the host half on the webserver).
//
// UI language: self-contained zh/EN fallback dictionary following DSH's
// global locale on RC1+. Older hosts fall back to navigator.language. Host
// error payloads carry machine-readable `code`s (see lib/shared.js guards);
// the client maps known codes into the active language and falls back to the
// server-provided text.
window.__ModuleLoader__.load({
  id: 'dsh-instance-manager',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const h = React.createElement


    // Live preferences. The host half registers this namespace on the harness
    // settings document; the browser half imports nothing by design.
    const DEFAULT_REFRESH_INTERVAL_MS = 4000
    const REFRESH_INTERVAL_MIN_MS = 1000
    const REFRESH_INTERVAL_MAX_MS = 60000

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
        '.dshim-btn-danger:disabled{opacity:.45;cursor:not-allowed}' +
        // The armed state is a warning, not an error: the stop has not happened
        // yet and the click is still reversible. Same box as the idle button with
        // only the label and border recoloured, so arming reads as the same
        // control in a different state rather than as a different button.
        '.dshim-btn-warn{background:transparent;color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:7px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}' +
        '.dshim-btn-warn:hover:not(:disabled){background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-overlay)}' +
        '.dshim-btn-warn:disabled{opacity:.45;cursor:not-allowed}' +
        '.dshim-port-input{width:66px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 8px;font:inherit;font-size:12px}' +
        '.dshim-port-input:focus{outline:none;border-color:var(--dsw-alias-border-l1)}' +
        '.dshim-port-input::placeholder{color:var(--dsw-alias-label-secondary)}' +
        '.dshim-port-field{display:inline-flex;align-items:center;gap:6px;margin-left:8px}' +
        '.dshim-port-label{font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
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

    // shared open-state store between the launcher and the overlay
    const state = { open: false, listeners: new Set() }
    const setOpen = (v) => {
      state.open = v
      state.listeners.forEach((fn) => fn())
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
    // DSH RC1 owns the durable language preference. This store is only the
    // reactive adapter used by the existing self-contained dictionaries.
    const initialLang = () => {
      const nav = (typeof navigator !== 'undefined' && navigator.language) || ''
      return /^zh/i.test(nav) ? 'zh' : 'en'
    }
    const langStore = { lang: initialLang(), listeners: new Set() }
    const setLang = (lang) => {
      langStore.lang = lang === 'en' ? 'en' : 'zh'
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
    const prefsStore = {
      refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
      listeners: new Set()
    }
    const setPrefs = (patch) => {
      let changed = false
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
        portLabel: '端口',
        portPlaceholder: '自动',
        portTitle: '留空则在托管端口段内选择第一个空闲端口',
        portInvalid: '端口需为 1–65535 的整数',
        startNewTitle: '在指定端口启动新的 dsh 实例；端口留空则取端口段内第一个空闲端口',
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
        confirmStop: '确认？',
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
        portLabel: 'Port',
        portPlaceholder: 'auto',
        portTitle: 'Leave empty to take the first free port in the managed range',
        portInvalid: 'Port must be an integer in 1–65535',
        startNewTitle: 'Start a new dsh instance on a chosen port; leave the port empty for the first free one',
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

    const API_PATH = '/dsh-instance-manager/api'

    // A row links to the redirect that authenticates it, never to the instance
    // root. DSH requires a per-process launch token on that root, so a bare root
    // URL answers 401; the token is readable only on the host running the
    // instance, so a remote row defers to its own panel, reached over the peer
    // origin it was listed from.
    function openHref(it) {
      const query = '?action=open&port=' + encodeURIComponent(String(it.port))
      if (!it.remote) return API_PATH + query
      try { return new URL(API_PATH + query, it.url).href } catch (e) { return it.url }
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
      // A local stop is confirmed for EVERY row, not only the current instance:
      // stopping any instance kills it and its sessions, and the previous rule
      // armed only the row whose port served the panel, so stopping another
      // instance ran on the first click and read as "there is no confirmation".
      // A remote row is never stoppable, so it has no confirm state either.
      const armable = !it.remote && it.managed !== false
      const confirming = armable && confirmPort === it.rowKey
      return h('div', {
        className: 'dshim-row',
        onClick: () => props.onToggle(it.rowKey)
      },
        h('span', { className: 'dshim-caret' }, props.expanded ? '▾' : '▸'),
        h('span', { className: 'dshim-dot ' + dotClass }),
        h('div', { className: 'dshim-main' },
          h('div', { className: 'dshim-line1' },
            h('a', {
              className: 'dshim-port', href: openHref(it), target: '_blank', rel: 'noreferrer',
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
          className: confirming ? 'dshim-btn-warn' : 'dshim-btn-danger',
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
      const [portInput, setPortInput] = React.useState('')
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
          // Only a FAILED list read may write the error here. Clearing it on every
          // successful refresh erased action errors: startNew sets the refusal and
          // then calls refresh(), so "port 3333 is already in use" disappeared
          // before it could be read and the panel looked like the click did
          // nothing. The error stays until a later action replaces it or succeeds.
          if (res && res.error) setError(localizeError(res, t))
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
        // Same arming rule as the row's confirm state: every stoppable local row
        // arms first, and the armed window expires so a stale confirm cannot fire
        // a stop much later.
        const armable = !item.remote && item.managed !== false
        if (armable && confirmPort !== item.rowKey) {
          setConfirmPort(item.rowKey)
          setTimeout(() => setConfirmPort((p) => (p === item.rowKey ? null : p)), 4000)
          return
        }
        setConfirmPort(null)
        stop(item)
      }
      const startNew = async () => {
        // Empty means auto: the host picks the first free port in the managed
        // range. A typed value is sent as-is and the host validates it, so an
        // out-of-range number is reported rather than silently replaced.
        const wanted = String(portInput).trim()
        if (wanted !== '' && !/^\d+$/.test(wanted)) {
          setError(t.portInvalid)
          return
        }
        setStarting(true)
        try {
          const r = await api({ action: 'start', port: wanted === '' ? undefined : wanted })
          if (!r || !r.ok) setError(localizeError(r, t))
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          // The button is disabled while `starting` is true, so the flag has to
          // come down on every path — a throw out of the refresh below would
          // otherwise leave the panel showing 启动中… forever.
          setStarting(false)
          refresh()
        }
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
            className: 'dshim-btn dshim-btn-danger' + (confirmAll ? ' dshim-btn-warn' : ''),
            onClick: requestStopAll,
            key: 'all',
            title: t.stopAllTitle
          }, confirmAll ? t.confirmAll : t.stopAll) : null,
          h('button', { className: 'dshim-iconbtn', onClick: refresh, key: 'refresh', title: t.refreshTitle }, refreshIcon),
          h('button', { className: 'dshim-iconbtn', onClick: () => setOpen(false), key: 'close', title: t.closeTitle }, '×')),
        error ? h('div', { className: 'dshim-err', key: 'err' }, error) : null,
        h('div', { className: 'dshim-body', key: 'body' },
          h('div', { className: 'dshim-toolbar', key: 'toolbar' },
            h('button', { className: 'dshim-btn', onClick: startNew, disabled: starting, title: t.startNewTitle },
              starting ? t.starting : t.startNew),
            h('label', { className: 'dshim-port-field', key: 'port', title: t.portTitle },
              h('span', { className: 'dshim-port-label' }, t.portLabel),
              h('input', {
                className: 'dshim-port-input',
                type: 'text',
                inputMode: 'numeric',
                value: portInput,
                placeholder: t.portPlaceholder,
                disabled: starting,
                title: t.portTitle,
                onChange: (e) => setPortInput(e.target.value)
              }))),
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
// <dsh-utility-launcher>
// Family utility launcher shared by the browser halves of the DSH plugins.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/launcher.js.
// DSH client artifacts are self-contained classic scripts, so the fragment is
// embedded into lib/client.js at build time by
//   npm run launcher:sync    (write it)
//   npm run launcher:check   (fail on drift)
// instead of being imported: a bare import would put a runtime dependency on the
// dock into every plugin, and the whole point of the dock is that a plugin ships
// standalone, with nothing else required.
//
// The launcher is one icon that opens a menu of family panels. It is contributed
// through slots, not through a page-local protocol: exactly one copy of this
// assembly runs per page (the first plugin to load wins the window mutex and
// declares the menu seat), and every plugin adds one row to that seat.
const UTILITY_ITEM_SLOT = 'createhelper.utility.item'
const UTILITY_MUTEX_KEY = '__CREATEHELPER_DSH_UTILITY_LAUNCHER_V1__'
const UTILITY_CSS_ID = 'createhelper-utility-launcher'
const UTILITY_FALLBACK_LEFT_PX = 80
const UTILITY_MEASURE_TRIES = 120
const UTILITY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect></svg>'

// The launcher's own chrome, injected once by whichever copy wins the mutex.
// The rows belong to other plugins, so the menu styles its own buttons by
// position instead of asking every contributor for a class name.
function ensureUtilityStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="' + UTILITY_CSS_ID + '"]') !== null) return
  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-plugin-css', UTILITY_CSS_ID)
  styleEl.textContent =
    '.createhelper-utility-anchor{position:fixed;bottom:16px;z-index:9997;pointer-events:auto}' +
    '.createhelper-utility-launcher{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22)}' +
    '.createhelper-utility-launcher:hover,.createhelper-utility-launcher[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}' +
    '.createhelper-utility-launcher svg{display:block}' +
    '.createhelper-utility-menu{display:flex;flex-direction:column;gap:2px;min-width:172px;margin-bottom:6px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 30px rgba(0,0,0,.28)}' +
    '.createhelper-utility-menu[hidden]{display:none}' +
    '.createhelper-utility-menu button{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;text-align:left;white-space:nowrap}' +
    '.createhelper-utility-menu button:hover,.createhelper-utility-menu button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}' +
    '.createhelper-utility-menu button svg{display:block;flex:none}'
  document.head.appendChild(styleEl)
}

// The position rule the retired page dock used: right of the sidebar, 16px
// in, and 80px when the shell has not laid the column out yet.
const measureUtilityLeft = () => {
  if (typeof document === 'undefined') return UTILITY_FALLBACK_LEFT_PX
  const overlay = document.querySelector('[data-shell-overlay]')
  const frame = overlay && overlay.parentElement
  const sidebar = frame && frame.firstElementChild
  const rect = sidebar && typeof sidebar.getBoundingClientRect === 'function'
    ? sidebar.getBoundingClientRect()
    : null
  if (!rect || !rect.right) return UTILITY_FALLBACK_LEFT_PX
  return Math.max(16, Math.round(rect.right + 16))
}
// The overlay layer commits before the frame's columns are laid out, so the
// first read answers the fallback; keep re-reading for ~2s and then stop.
const useUtilityLeft = () => {
  const [left, setLeft] = React.useState(UTILITY_FALLBACK_LEFT_PX)
  React.useEffect(() => {
    let stopped = false
    let tries = 0
    let frameId = 0
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    const sync = () => {
      if (stopped) return
      const next = measureUtilityLeft()
      setLeft(next)
      if (next === UTILITY_FALLBACK_LEFT_PX && raf !== null && tries < UTILITY_MEASURE_TRIES) {
        tries += 1
        frameId = raf(sync)
      }
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      stopped = true
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return left
}
// The block owns no dictionary, so its own title follows the browser
// language; each row's label comes from the plugin that contributes it.
const utilityTitle = () => {
  const nav = (typeof navigator !== 'undefined' && navigator.language) || ''
  return /^zh/i.test(nav) ? '工具面板' : 'Utility panels'
}
const utilityMenu = { open: false, listeners: new Set() }
const setUtilityMenu = (value) => {
  utilityMenu.open = !!value
  utilityMenu.listeners.forEach((listener) => listener())
}
const useUtilityMenu = () => {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const listener = () => setTick((value) => value + 1)
    utilityMenu.listeners.add(listener)
    return () => utilityMenu.listeners.delete(listener)
  }, [])
  return utilityMenu.open
}
// The launcher and its menu. The menu is always rendered - a declared child
// slot is not conditionally declared - and hidden when closed. Choosing a row
// closes the menu through the click that bubbles out of it, because the rows
// are other plugins' components.
function UtilityLauncher (props) {
  const left = useUtilityLeft()
  const open = useUtilityMenu()
  ensureUtilityStyles()
  React.useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      const target = event && event.target
      if (target && typeof target.closest === 'function' && target.closest('[data-utility-anchor]') !== null) return
      setUtilityMenu(false)
    }
    const onKey = (event) => { if (event && event.key === 'Escape') setUtilityMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return h('div', {
    'data-utility-anchor': '',
    className: 'createhelper-utility-anchor',
    style: { left: left + 'px' }
  }, [
    h('div', {
      key: 'menu',
      className: 'createhelper-utility-menu',
      hidden: !open,
      onClick: () => setUtilityMenu(false)
    }, props && typeof props.renderSlot === 'function' ? props.renderSlot(UTILITY_ITEM_SLOT, {}) : null),
    h('button', {
      key: 'icon',
      type: 'button',
      className: 'createhelper-utility-launcher',
      title: utilityTitle(),
      'aria-label': utilityTitle(),
      'aria-expanded': open ? 'true' : 'false',
      onClick: () => setUtilityMenu(!open),
      dangerouslySetInnerHTML: { __html: UTILITY_ICON }
    })
  ])
}
// Whoever loads first owns the assembly; everyone else only contributes rows.
// The child slot is declared here, so a plugin that joins later still finds it
// through slots.inject, and an install with one plugin still gets a launcher.
//
// The seat belongs to the shell, so it is reached through inject: registering
// into it directly throws while that declaration is still pending, and a
// launcher must never cost the caller the surfaces it registers afterwards.
//
// The claim lives on the page and is released with its owner. Every family
// client half carries this assembly, so without the release a hot reload of the
// owner would dispose its registration while the claim stayed taken, and the
// launcher would stay missing until the page was reloaded. A released claim
// wakes the other copies, which re-register immediately.
const utilityClaim = () => {
  if (typeof window === 'undefined') return null
  const existing = window[UTILITY_MUTEX_KEY]
  if (existing !== null && typeof existing === 'object') return existing
  const claim = { owner: null, waiters: new Set() }
  window[UTILITY_MUTEX_KEY] = claim
  return claim
}
const registerUtilityLauncher = (scope) => {
  const claim = utilityClaim()
  if (claim === null) return
  if (claim.owner !== null) {
    claim.waiters.add(() => registerUtilityLauncher(scope))
    return
  }
  claim.owner = scope
  let released = false
  const release = () => {
    if (released) return
    released = true
    if (claim.owner === scope) claim.owner = null
    if (window[UTILITY_MUTEX_KEY] !== claim) return
    const waiters = [...claim.waiters]
    claim.waiters.clear()
    for (const wake of waiters) wake()
  }
  scope.on('dispose', release)
  scope.slots.inject('shell.overlay', () => {
    try {
      scope.slots.register({
        name: 'shell.overlay',
        id: 'utility-launcher',
        order: 98,
        children: { [UTILITY_ITEM_SLOT]: { kind: 'list', scope: 'root' } }
      }, UtilityLauncher)
    } catch (error) {
      release()
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('[utility-launcher] could not register the family launcher', error)
      }
    }
  })
}
// </dsh-utility-launcher>
    // This plugin's row in the family utility menu. Choosing it opens the panel;
    // the menu closes itself because the click bubbles out of the row.
    function InstanceManagerMenuItem () {
      const t = STRINGS[useLang()]
      const open = useOpen()
      return h('button', {
        type: 'button',
        'aria-pressed': open ? 'true' : 'false',
        title: t.appTitle,
        onClick: () => setOpen(true)
      }, [
        h('span', { key: 'icon', dangerouslySetInnerHTML: { __html: INSTANCE_ICON } }),
        h('span', { key: 'label' }, t.appTitle)
      ])
    }

    const plugin = {
      apply(ctx) {
        // Disposal is owned by the plugin's own context, so it runs whether or
        // not the slot service ever arrived.
        ctx.on('dispose', () => {
          setOpen(false)
        })
        // Follow the one durable DSH locale setting. The dictionaries remain
        // embedded so pre-RC1 hosts still render without the optional service.
        ctx.inject(['locale'], (localeCtx) => {
          if (!localeCtx.locale) return
          const staticDictionary = (dictionary) => Object.fromEntries(
            Object.entries(dictionary).filter((entry) => typeof entry[1] === 'string'))
          let disposeDictionary = null
          let disposeSubscription = null
          try {
            disposeDictionary = localeCtx.locale.register('dsh-instance-manager', {
              zh: staticDictionary(STRINGS.zh),
              en: staticDictionary(STRINGS.en)
            })
          } catch (e) { }
          const syncLanguage = () => {
            let active = ''
            try { active = String(localeCtx.locale.getSnapshot().active || '') } catch (e) { }
            setLang(active.toLowerCase().startsWith('zh') ? 'zh' : 'en')
          }
          syncLanguage()
          if (typeof localeCtx.locale.subscribe === 'function') disposeSubscription = localeCtx.locale.subscribe(syncLanguage)
          if (typeof localeCtx.on === 'function') {
            localeCtx.on('dispose', () => {
              if (typeof disposeSubscription === 'function') disposeSubscription()
              if (typeof disposeDictionary === 'function') disposeDictionary()
            })
          }
        })
        // Wait for the slot service instead of probing it once. Mount order
        // between this bundle and the runtime providing `slots` is not
        // guaranteed, and a missed ctx.get('slots') left the panel silently
        // absent — no error, no boot failure, just nothing in the UI. This is
        // the shape the harness's own UI packages use.
        ctx.inject(['slots'], (scope) => {
          // This plugin contributes one row to the family menu, and claims the
          // menu itself when this plugin is the first family member to load (see
          // the utility-launcher block above). The panel and the toasts stay on
          // the overlay layer beside it.
          scope.slots.inject(UTILITY_ITEM_SLOT, () => scope.slots.register(
            {
              name: UTILITY_ITEM_SLOT,
              id: 'instance-manager',
              order: 10,
              label: () => STRINGS[langStore.lang].appTitle
            },
            () => h(InstanceManagerMenuItem, null)))
          registerUtilityLauncher(scope)
          scope.slots.inject('shell.overlay', () => scope.slots.register(
            { name: 'shell.overlay', id: 'instance-manager-panel', order: 100 },
            (props) => h(Overlay, props)))
          scope.slots.inject('shell.overlay', () => scope.slots.register(
            { name: 'shell.overlay', id: 'instance-manager-fleet-toasts', order: 101 },
            (props) => h(FleetToasts, props)))
        })
        // Settings-driven preferences (DIM-M1): bind the namespace the host
        // registered (settings-contract.ts) and mirror every ready snapshot
        // into prefsStore. A separate inject call, so a build without the
        // settings UI only loses preferences — never the panel (this callback
        // then simply never fires).
        //
        // Two names for that service, hence two inject calls: `settingsScope`
        // up to 0.1.5, `configForms` from 0.1.7-rc.1 (where `settingsScope` no
        // longer exists). Both are RUNTIME injects — a missing service leaves
        // the sub-fiber pending and this callback simply never runs, so either
        // missing name costs nothing. Do NOT hoist either into the module-level
        // `inject` list: that gates activation and would take the whole entry
        // down on the version that lacks it (exactly how third-party suites
        // died on 0.1.7 with "pending (waiting for service: settingsScope)").
        const prefsBound = { done: false }
        ctx.inject(['configForms'], (formsCtx) => {
          if (prefsBound.done) return
          const forms = formsCtx && formsCtx.configForms
          if (!forms || typeof forms.get !== 'function') return
          let scope
          try {
            scope = forms.get('dsh-instance-manager')
          } catch (e) { return }
          bindPreferences(scope)
        })
        ctx.inject(['settingsScope'], (settingsCtx) => {
          if (prefsBound.done) return
          if (!settingsCtx || typeof settingsCtx.bind !== 'function') return
          let scope
          try {
            scope = settingsCtx.bind({ namespace: 'dsh-instance-manager' })
          } catch (e) { return }
          bindPreferences(scope)
        })
        function bindPreferences (scope) {
          if (prefsBound.done || !scope || typeof scope.getSnapshot !== 'function') return
          prefsBound.done = true
          const applySnapshot = () => {
            let snap
            try { snap = scope.getSnapshot() } catch (e) { return }
            if (!snap) return
            if (snap.status === 'ready' && snap.value && typeof snap.value === 'object') {
              setPrefs({
                refreshIntervalMs: clampRefreshInterval(snap.value.refreshIntervalMs)
              })
            }
          }
          applySnapshot()
          if (typeof scope.subscribe === 'function') scope.subscribe(applySnapshot)
        }
      },
    }

    module.exports = plugin
    return module.exports
  },
})
