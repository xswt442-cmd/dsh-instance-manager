// dsh-instance-manager 浏览器侧。经典脚本形式的客户端 bundle：向
// window.__ModuleLoader__ 注册工厂，由客户端内核实例化并挂载导出的插件。React 来自
// 平台种子（`require('react')`）；宿主数据来自同源 JSON 端点
// /dsh-instance-manager/api（由宿主侧注册在 webserver 上）。
//
// 界面语言：自带 zh/EN 回退字典，RC1 及以上跟随 DSH 的全局 locale；更老的宿主退回
// navigator.language。宿主错误载荷带有机器可读的 `code`（见 lib/shared.js 的守卫），
// 客户端把已知 code 映射到当前语言，未知时显示服务端提供的文字。
window.__ModuleLoader__.load({
  id: 'dsh-instance-manager',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const h = React.createElement


    // 可实时生效的偏好。宿主侧在 harness 设置文档上注册该命名空间；浏览器侧按设计
    // 不导入任何模块。
    const DEFAULT_REFRESH_INTERVAL_MS = 4000
    const REFRESH_INTERVAL_MIN_MS = 1000
    const REFRESH_INTERVAL_MAX_MS = 60000

    // style 标签携带 data-plugin-css，与发布包的约定一致（内核/HMR 的记账依赖它）；
    // 同时防止重复注入。
    const CSS_ID = 'dsh-instance-manager'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin-css', CSS_ID)
      styleEl.textContent =
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
        // 待确认状态是警告而不是错误：停止尚未发生，点击仍可撤销。与空闲按钮相同的
        // 盒子，只改标签与边框颜色，让待确认状态读作同一个控件的另一种状态，而不是
        // 另一个按钮。
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
        '.dshim-sparhead{display:flex;align-items:center;gap:8px}' +
        '.dshim-spark{width:100%;height:38px;display:block}' +
        '.dshim-dhead{display:flex;align-items:center;gap:6px}' +
        '.dshim-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer}' +
        '.dshim-tab:hover{color:var(--dsw-alias-label-primary)}' +
        '.dshim-tab-on{color:var(--dsw-alias-label-primary);font-weight:600;background:var(--dsw-alias-bg-overlay)}' +
        '.dshim-log{margin:0;padding:8px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-family:ui-monospace,Consolas,Menlo,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;color:var(--dsw-alias-label-primary)}' +
        '.dshim-sess{max-height:110px}' +
        '.dshim-diag{max-height:150px}' +
        '.dshim-dnote{color:var(--dsw-alias-label-secondary);opacity:.85}' +
        '.dshim-toasts{position:fixed;bottom:16px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:9998;pointer-events:none;font-size:12px}' +
        '.dshim-toast{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:10px;padding:8px 12px;box-shadow:0 8px 24px rgba(0,0,0,.25)}' +
        '.dshim-badge-remote{color:var(--dsw-alias-label-secondary);border-style:dashed}' +
        // 桌面应用自己的宿主：与其他状态徽标一样使用实线边框，但用品牌色，因为它是
        // “这一个比较特殊”的标记，不是警告。
        '.dshim-badge-desktop{color:var(--dsw-alias-brand-primary)}' +
        '.dshim-note{margin:4px 8px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;word-break:break-all}'
      document.head.appendChild(styleEl)
    }

    // launcher 与 overlay 共用的展开状态存储
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

    // ---- 界面语言 ---------------------------------------------------------
    // DSH RC1 持有持久的语言偏好。这个存储只是自带字典使用的响应式适配层。
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

    // ---- 可实时生效的偏好 ------------------------------------------------
    // 轮询间隔来自宿主注册的设置命名空间，因此重装 profile 后仍然保留，也可以在
    // harness 的设置页编辑。存储仍是普通模块状态：轮询定时器每次调度都重新读取它，
    // 改动在下一个 tick 生效，无需重新挂载任何组件。浏览器侧不导入任何模块，因此这些
    // 常量必须与 lib/shared.js 保持一致。
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
    // 4000ms 显示为 "4"，7500ms 显示为 "7.5"——页脚展示面板实际运行的节奏，而不是
    // 一个可能已经漂移的常量。
    const refreshSecondsLabel = (ms) => String(Math.round(ms / 100) / 10)

    const STRINGS = {
      zh: {
        appTitle: 'DSH Instance',
        itemsCount: (n) => n + ' 个',
        stopAll: '停止全部',
        confirmAll: '确认停止全部？',
        stopAllTitle: '停止全部托管实例（含当前窗口）；会话已持久化，重启 dsh 后恢复',
        refreshTitle: '刷新',
        closeTitle: '关闭',
        startNew: '+ 启动新实例',
        starting: '启动中…',
        portLabel: '端口',
        portPlaceholder: '自动',
        portTitle: '留空则在起始端口段内选择第一个空闲端口',
        portInvalid: '端口需为 1–65535 的整数',
        startNewTitle: '在指定端口启动新的 dsh 实例；端口留空则取起始端口段内第一个空闲端口',
        loading: '加载中…',
        empty: '扫描端口内没有发现 dsh 实例，点击上方按钮启动一个',
        foot: (s) => s + ' 秒自动刷新 · 点击行查看详情',
        updatedAtPrefix: '更新于 ',
        badgeCurrent: '当前会话',
        badgeRunning: '运行中',
        badgeOther: '非 dsh 服务',
        badgeDesktop: '桌面端',
        skew: '版本差异',
        skewTitle: (v, cur) => '该实例运行 v' + v + '，当前实例 v' + cur + '；全舰队版本一致后可移除旧版兼容路由',
        sessionsSuffix: (n) => n + ' 个会话',
        mine: '本面板所在实例',
        uptime: (d, hh, mm) => d > 0 ? ('已运行 ' + d + ' 天 ' + hh + ' 小时') : hh > 0 ? ('已运行 ' + hh + ' 小时 ' + mm + ' 分钟') : ('已运行 ' + mm + ' 分钟'),
        stopBtn: '停止',
        stopCurrentBtn: '停止当前',
        confirmStop: '确认？',
        stoppingBtn: '停止中…',
        stoppingAll: '正在停止全部实例…',
        byeSelf: '当前实例已停止，请关闭对应页面。',
        byeAll: '全部实例已停止，请关闭对应页面。',
        stopTitleCurrent: '停止当前实例：界面会断开，会话已持久化，重启 dsh 后自动恢复',
        stopTitleUnmanaged: '该实例未挂载本管理面板或不是 dsh 服务，无法从这里停止（重启该实例后可管理）',
        stopTitleManaged: '停止该实例（通知其优雅退出，会话正常落盘）',
        restartBtn: '重启',
        confirmRestart: '确认重启？',
        restartingBtn: '重启中…',
        restartTitle: '在同一端口重启该实例（优雅停止后重新启动；停止与启动之间端口是空的，被抢占则重启失败并保持原端口）',
        restartTitleHandoff: '重启当前实例：先在 tmux/screen 中启动替代实例，就绪后跳转到它的新端口，当前进程随即退出',
        restartTitleCurrent: '当前实例不会从面板重启：未检测到 tmux 或 screen。请手动重启本机 dsh。',
        handoffNotice: (p) => '替代实例已在 :' + p + ' 就绪，正在跳转…',
        langBtn: 'EN',
        langTitle: '切换到 English',
        startedAtLabel: '启动于',
        memTrend: '内存走势',
        noLog: '暂无日志文件（该实例可能不是从面板启动的）',
        logUnavail: '目标未提供日志（旧版面板或不可达）',
        logTitle: '日志（最近 200 行）',
        logStdout: 'stdout',
        logStderr: 'stderr',
        diagTitle: '诊断（最近 200 行）',
        diagTab: '诊断',
        diagCrash: '崩溃黑匣子',
        diagCrashNote: '进程崩溃或未处理的 Promise 拒绝时写下的一行头加异常栈，按本实例的 pid 归属。',
        diagSelfExit: '自退出记录',
        diagSelfExitNote: '每次以本进程退出收尾的路由写一行，说明是崩溃还是被要求离开。',
        diagRequests: '写操作追踪',
        diagRequestsNote: '每个被接受的写操作一行：对端地址、准入路径、Host/Origin/Referer/User-Agent、目标端口与结果。只在本机回环可读，不经 fleet 转发。',
        diagEmpty: '没有该实例的记录',
        diagUnavail: '目标未提供诊断记录（旧版面板或不可达）',
        sessTitle: '活跃会话',
        sessEmpty: '无活跃会话',
        sessUnavail: '目标未提供会话概要（旧版面板或不可达）',
        sessMore: (n) => '… 还有 ' + n + ' 个',
        sessSub: '子代理',
        stopTitleRemote: '远程实例控制将在后续版本支持',
        stopTitleDesktop: '桌面宿主不会从这里停止：它是桌面窗口的唯一后端，停掉它会让窗口失去后端并进入错误状态',
        stoppedAllKept: (n) => '已停止 ' + n + ' 个实例；桌面宿主保留运行',
        startedWith: (port, bin, version) => '已在 :' + port + ' 启动，使用 ' + bin + (version ? '（v' + version + '）' : ''),
        toastUp: (p) => '实例上线 :' + p,
        toastDown: (p) => '实例已下线 :' + p,
        toastPeerUp: (id) => 'peer 上线 @' + id,
        toastPeerDown: (id) => 'peer 离线 @' + id,
        err: {
          cross_site: '已拒绝跨站请求',
          bad_host: 'Host 不是回环地址',
          bad_origin: 'Origin 不同源',
          need_post: (a) => a + ' 需要 POST 请求',
          no_free_port: '起始端口段已全部被占用',
          start_failed: '新实例未能启动（端口被抢占或启动失败）',
          start_unconfirmed: '实例仍在启动、暂未应答，稍后刷新列表确认状态',
          no_node: '未找到 node 可执行文件',
          no_dsh_bin: '未找到 dsh 启动器',
          no_port: '缺少端口参数',
          stop_unconfirmed: '目标实例没有确认停止（未挂载本管理面板或不可达）',
          stop_desktop_refused: '桌面宿主不会被停止：停止它会让桌面窗口失去后端',
          restart_current_refused: '当前实例无法从面板重启：未检测到 tmux 或 screen',
          port_still_in_use: '停止后端口仍未释放（15 秒），未启动新实例',
          launch_token_unavailable: '该实例的启动 token 不可得（不是本机 launcher 启动的，或日志已轮转）',
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
        portTitle: 'Leave empty to take the first free port in the start range',
        portInvalid: 'Port must be an integer in 1–65535',
        startNewTitle: 'Start a new dsh instance on a chosen port; leave the port empty for the first free one',
        loading: 'Loading…',
        empty: 'No dsh instance found on the swept ports — use the button above to launch one',
        foot: (s) => 'auto-refresh ' + s + 's · click a row for details',
        updatedAtPrefix: 'updated ',
        badgeCurrent: 'current session',
        badgeRunning: 'running',
        badgeOther: 'non-dsh service',
        badgeDesktop: 'desktop',
        skew: 'version skew',
        skewTitle: (v, cur) => 'That instance runs v' + v + ', this panel runs v' + cur + '; the fleet is mixed until these match',
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
        restartBtn: 'Restart',
        confirmRestart: 'Confirm restart?',
        restartingBtn: 'Restarting…',
        restartTitle: 'Restarts that instance on the same port (graceful stop, then a fresh launch; the port is empty in between, so a process that grabs it makes the restart fail and the port stays as it was)',
        restartTitleHandoff: 'Restarts this instance by launching a replacement in tmux/screen, then redirects you to its new port; this process exits once the replacement answers',
        restartTitleCurrent: 'The current instance is not restarted from this panel: no tmux or screen session tool was detected. Restart your local dsh instead.',
        handoffNotice: (p) => 'Replacement instance is ready on :' + p + ' — redirecting…',
        langBtn: '中',
        langTitle: 'Switch to 中文',
        startedAtLabel: 'started',
        memTrend: 'memory trend',
        noLog: 'No log file yet (this instance was probably not launched from the panel)',
        logUnavail: 'target does not expose logs (legacy or unreachable)',
        logTitle: 'Logs (last 200 lines)',
        logStdout: 'stdout',
        logStderr: 'stderr',
        diagTitle: 'Diagnostics (last 200 lines)',
        diagTab: 'Diagnostics',
        diagCrash: 'Crash black box',
        diagCrashNote: 'One header line plus the stack written on a process crash or an unhandled promise rejection, scoped to this instance by pid.',
        diagSelfExit: 'Self-exit log',
        diagSelfExitNote: 'One line per route that ends this process, saying whether it crashed or was asked to leave.',
        diagRequests: 'Mutation trace',
        diagRequestsNote: 'One line per accepted mutation: peer address, admission path, Host/Origin/Referer/User-Agent, target port and result. Loopback only — never forwarded over fleet.',
        diagEmpty: 'no records for this instance',
        diagUnavail: 'target does not expose diagnostics (legacy or unreachable)',
        sessTitle: 'live sessions',
        sessEmpty: 'no active sessions',
        sessUnavail: 'target does not expose session summaries (legacy or unreachable)',
        sessMore: (n) => '… ' + n + ' more',
        sessSub: 'subagent',
        stopTitleRemote: 'Remote control lands in a later release',
        stopTitleDesktop: 'The desktop host is not stopped from here: it is the desktop window\u2019s only backend, and stopping it leaves the window without one, in an error state',
        stoppedAllKept: (n) => 'Stopped ' + n + ' instance' + (n === 1 ? '' : 's') + '; the desktop host was kept running',
        startedWith: (port, bin, version) => 'started :' + port + ' with ' + bin + (version ? ' (v' + version + ')' : ''),
        toastUp: (p) => 'instance up :' + p,
        toastDown: (p) => 'instance down :' + p,
        toastPeerUp: (id) => 'peer up @' + id,
        toastPeerDown: (id) => 'peer down @' + id,
        err: {
          cross_site: 'Cross-site request rejected',
          bad_host: 'Non-loopback Host rejected',
          bad_origin: 'Foreign Origin rejected',
          need_post: (a) => a + ' requires POST',
          no_free_port: 'Every port in the start range is occupied',
          start_failed: 'New instance failed to start (port grabbed or crash)',
          start_unconfirmed: 'Still booting with no answer yet — refresh the list shortly',
          no_node: 'node executable not found',
          no_dsh_bin: 'dsh launcher not found',
          no_port: 'Missing port parameter',
          stop_unconfirmed: 'Target did not acknowledge the stop (bundle not mounted there, or unreachable)',
          stop_desktop_refused: 'The desktop host is never stopped: stopping it would leave the desktop window without a backend',
          restart_current_refused: 'The current instance is not restarted from this panel: no tmux or screen session tool was detected',
          port_still_in_use: 'The port was still taken 15s after the stop; no new instance was started',
          launch_token_unavailable: 'Launch token unavailable for that instance (not started by this machine\u2019s launcher, or its log rotated)',
          unknown_action: 'Unknown action',
          internal: 'Internal error',
          generic: 'Request failed'
        }
      }
    }

    // 把宿主的失败载荷映射到当前语言：已知 `code` 优先，服务端原文作为回退（旧版
    // 面板仍然显示原文）。
    const localizeError = (res, t) => {
      if (!res) return t.err.generic
      const mapped = res.code ? t.err[res.code] : undefined
      if (mapped !== undefined) return typeof mapped === 'function' ? mapped(res.action || '') : mapped
      return String(res.error || t.err.generic)
    }

    // 写操作以 POST 发出；宿主侧会拒绝 GET（见 README「安全模型」）。stop-self 只由
    // 宿主之间发送。
    const POST_ACTIONS = { start: 1, stop: 1, restart: 1, 'stop-all': 1 }
    const api = async (params) => {
      // 缺失的参数直接丢弃，绝不字符串化：`String(undefined)` 就是字面量
      // "undefined"，省略的 `peer` 会以 peer=undefined 发出——宿主只有
      // `resolvePeerParam` 的哨兵分支会读取该字符串，而本面板从不发送它。
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

    // 实例自报的常驻内存（process.memoryUsage().rss）。
    function fmtMem(rss) {
      if (typeof rss !== 'number' || rss <= 0) return ''
      const mb = rss / 1048576
      return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB'
    }

    // 本地时间加上查看者浏览器的 IANA 时区名。完全在客户端用 epoch 毫秒渲染——
    // 用户的时区不会被上报或存储，它只是浏览器环境自己的展示细节，与本地化格式属于
    // 同一类。
    function fmtStartAt(startedAt) {
      if (!startedAt) return ''
      const local = new Date(startedAt).toLocaleString(undefined, { hour12: false })
      try {
        return local + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')'
      } catch (e) {
        return local
      }
    }

    // 抽屉里的一行会话摘要：本地 HH:MM、折叠标题（没有时退回短 id）、工作目录基本名、
// 子代理标记、预设、委派深度、事件数。全部由宿主侧已经提取的标量字段渲染。
//
// 8 位短 id 没有辨识度：同一台机器上几十个会话用它无法区分。标题与谱系是可选的，
// 缺失即省略，不留占位。
function fmtSessionLine(s, t) {
      let time = ''
      try { time = new Date(s.createdAt).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' }) } catch (e) { }
      let base = ''
      if (s.cwd) { const parts = String(s.cwd).split(/[\\/]/); base = parts[parts.length - 1] }
      // 谱系只写深度与预设：父会话 id 本身没有辨识度，而深度 1 已经说明"这是一个
      // 子会话"，与"没有父会话"区分得开。
      const lineage = typeof s.delegationDepth === 'number' ? ' ↧' + s.delegationDepth : null
      return [time, s.title ? String(s.title) : String(s.id).slice(0, 8), base,
        s.subagent ? t.sessSub : null, s.agentPreset ? '[' + s.agentPreset + ']' : null,
        lineage,
        typeof s.events === 'number' ? s.events + ' ev' : null].filter(Boolean).join(' · ')
    }

    // 在面板自己的 rss 采样上绘制内联 SVG 折线图（客户端历史：每次轮询一个点，保留
    // 最近 60 个，不做持久化）。
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
          h('span', null, props.view === 'diag' ? t.diagTitle : t.logTitle),
          h('button', {
            className: 'dshim-tab' + (props.view === 'out' ? ' dshim-tab-on' : ''),
            onClick: () => props.onView('out')
          }, t.logStdout),
          h('button', {
            className: 'dshim-tab' + (props.view === 'err' ? ' dshim-tab-on' : ''),
            onClick: () => props.onView('err')
          }, t.logStderr),
          // 诊断面只读本机共享文件，因此远端行没有这个标签：给远端行挂它只会读到
          // 本机同号端口的记录。
          it.remote ? null : h('button', {
            className: 'dshim-tab' + (props.view === 'diag' ? ' dshim-tab-on' : ''),
            onClick: () => props.onView('diag')
          }, t.diagTab)),
        // null 只表示“请求进行中”。失败的读取存为 ok:false 以便说明原因——离线
        // 对端，或拒绝该端口的宿主，否则会永远停在“加载中”。
        props.view === 'diag'
          ? h(Diagnostics, { key: 'dg', diag: props.diag, t: t })
          : log === null
            ? h('div', { key: 'lb' }, t.loading)
            : !log.ok
              ? h('div', { key: 'lb' }, t.logUnavail)
              : !log.exists
                ? h('div', { key: 'lb' }, t.noLog)
                : h('pre', { className: 'dshim-log', key: 'lb' },
                  log.lines && log.lines.length ? log.lines.join('\n') : '—'))
    }

    // 诊断面：崩溃黑匣子、自退出与写操作追踪的有界尾部，三份文件由本机所有实例共用，
    // 因此每节都按这个实例的 pid / 端口归属筛选。
    //
    // 写操作追踪必须带着它的说明一起出现：每一行都含对端地址与请求携带的
    // User-Agent，读者有权在做决定之前知道这一点。
    const DIAG_SECTIONS = [
      { key: 'crash', labelKey: 'diagCrash', noteKey: 'diagCrashNote' },
      { key: 'selfExit', labelKey: 'diagSelfExit', noteKey: 'diagSelfExitNote' },
      { key: 'requests', labelKey: 'diagRequests', noteKey: 'diagRequestsNote' }
    ]
    function Diagnostics(props) {
      const d = props.diag
      const t = props.t
      if (d === null) return h('div', { key: 'dgl' }, t.loading)
      if (!d.ok) return h('div', { key: 'dgl' }, t.diagUnavail)
      return h('div', { key: 'dgs' }, [].concat.apply([], DIAG_SECTIONS.map((sec, i) => {
        const body = d[sec.key]
        const title = t[sec.labelKey]
        return [
          h('div', { className: 'dshim-dhead', key: 'dh' + sec.key },
            h('span', null, title),
            h('span', { className: 'dshim-spacer' }),
            body && typeof body.lines[0] === 'string'
              ? h('span', null, String(body.lines.length))
              : null),
          h('div', { className: 'dshim-dnote', key: 'dn' + sec.key }, t[sec.noteKey]),
          !body || !body.exists
            ? h('div', { key: 'db' + sec.key }, t.diagEmpty)
            : !body.lines.length
              ? h('div', { key: 'db' + sec.key }, t.diagEmpty)
              : h('pre', { className: 'dshim-log dshim-diag', key: 'db' + sec.key },
                (body.truncated ? '…\n' : '') + body.lines.join('\n'))
        ]
      })))
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

    const API_PATH = '/dsh-instance-manager/api'

    // 行链接指向能完成认证的重定向，绝不指向实例根地址。DSH 要求实例根 URL 携带
    // 每进程的启动 token，裸根地址会返回 401；token 只能由运行该实例的宿主读取，
    // 因此远端行改用它被列出时的 peer 来源访问对端自己的面板。
    function openHref(it) {
      const query = '?action=open&port=' + encodeURIComponent(String(it.port))
      if (!it.remote) return API_PATH + query
      try { return new URL(API_PATH + query, it.url).href } catch (e) { return it.url }
    }

    // 本面板是否由桌面应用内提供。外壳从自己的 dsh-app://app 源加载它，并拒绝所有
    // 目标不是 http(s) 的 window.open，本机行的相对 href 因此会被解析成外壳拒绝的
    // 导航。远端行不受影响——它们的 href 已经是 http(s) 对端地址，外壳正是把这种地址
    // 交给系统浏览器。
    const ON_DESKTOP = typeof globalThis !== 'undefined' && 'dshDesktop' in globalThis

    // 某个实例的绝对 token 地址，即宿主对 action=open-url 的回答。只有桌面路径需要
    // 它；网页路径保留普通相对链接，303 完成同样的工作，且不把 token 放进面板状态。
    async function openOnDesktop(it) {
      try {
        return await api({
          action: 'open-url',
          port: it.port,
          peer: it.remote ? it.source : undefined
        })
      } catch (e) {
        return { code: 'generic' }
      }
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
      // 版本差异：托管实例上报的插件版本与提供本面板的版本不同——这是混合版本
      // fleet 的可见信号。
      const skewed = !!props.selfVersion && !!it.managed && !!it.version && it.version !== props.selfVersion
      const parts = []
      if (typeof it.pid === 'number') parts.push('pid ' + it.pid)
      // 刻意省略进程名：每个实例都是 node，那只是零信息宽度的内容，却把运行时长和
      // 内存挤到截断。
      const up = fmtUptime(it.startedAt, t)
      if (up) parts.push(up)
      const mem = fmtMem(it.rss)
      if (mem) parts.push(mem)
      if (it.version) parts.push('v' + it.version)
      if (typeof it.sessions === 'number' && it.sessions > 0) parts.push(t.sessionsSuffix(it.sessions))
      if (it.current) parts.push(t.mine)
      // 忙碌与确认状态按行（source + port）索引，绝不用 pid，也绝不用单独的端口：
      // 未托管行没有 pid，且 pid 从不等于端口；混用会悄悄破坏“停止中…”反馈与确认
      // 高亮，而单用端口会与对端的行冲突。
      // 每个可停止的本机行都要确认，不只是当前实例：停止任何实例都会杀掉它及其会话，
      // 因此只要操作者选定了某一行，就为该行进入确认状态。
      // 远端行永远不可停止，因此也没有确认状态。
      const armable = !it.remote && it.managed !== false && it.runtime !== 'desktop'
      // 确认状态同时记下是哪个动作被确认的：一行上有停止与重启两个按钮，共用一个
      // 行键的状态机时，不记动作就无法分辨待确认的是哪一个。
      const armed = confirmPort && confirmPort.rowKey === it.rowKey ? confirmPort.action : null
      const confirming = armable && armed === 'stop'
      const confirmingRestart = armable && armed === 'restart'
      // 当前实例可以重启，但只能交接：宿主在持久化会话里启动替代实例，就绪后返回
      // 新端口的 token URL，浏览器整页跳转过去，旧进程随后退出。没有 tmux/screen
      // 时宿主仍会拒绝，按钮保持禁用并在悬停提示里说明原因。
      const restartable = armable && (!it.current || !!props.selfSession)
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
              onClick: (e) => {
                e.stopPropagation()
                // 桌面端本机行：相对 href 会被应用外壳拒绝，因此改为获取宿主的绝对
                // 地址。
                if (!ON_DESKTOP || it.remote) return
                e.preventDefault()
                props.onOpen(it)
              }
            }, ':' + it.port),
            h('span', { className: 'dshim-badge ' + badgeClass }, badgeText),
            it.runtime === 'desktop' ? h('span', {
              className: 'dshim-badge dshim-badge-desktop'
            }, t.badgeDesktop) : null,
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
          // 桌面宿主在这里和宿主侧都被拒绝：控件被禁用，原因放在悬停提示里，绝不
          // 隐藏，因为“这一行不能停止”是这一行应当告知读者的信息。
          disabled: !!busy[it.rowKey] || it.managed === false || !!it.remote || it.runtime === 'desktop',
          onClick: (e) => {
            e.stopPropagation()
            if (it.runtime === 'desktop') return
            onConfirm(it)
          },
          title: it.runtime === 'desktop'
            ? t.stopTitleDesktop
            : it.remote
              ? t.stopTitleRemote
              : it.current
                ? t.stopTitleCurrent
                : it.managed === false
                  ? t.stopTitleUnmanaged
                  : t.stopTitleManaged
        }, busy[it.rowKey] === 'stop' ? t.stoppingBtn : confirming ? t.confirmStop : it.current ? t.stopCurrentBtn : t.stopBtn),
        h('button', {
          className: confirmingRestart ? 'dshim-btn-warn' : 'dshim-btn',
          disabled: !restartable || !!busy[it.rowKey],
          onClick: (e) => {
            e.stopPropagation()
            if (!restartable) return
            props.onConfirmRestart(it)
          },
          // 端口窗口期是这次操作的真实性质，因此它出现在确认之前的悬停提示里。
          // 当前实例改用交接：新实例先在新端口就绪，浏览器再跳过去。
          title: it.current
            ? (props.selfSession ? t.restartTitleHandoff : t.restartTitleCurrent)
            : t.restartTitle
        }, busy[it.rowKey] === 'restart'
          ? t.restartingBtn
          : confirmingRestart ? t.confirmRestart : t.restartBtn))
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
      // 上一次成功操作的结果（启动用了哪个 launcher，桌面端保留运行的 stop-all
      // 跳过了什么）。与 `error` 分开，后者只留给失败。
      const [notice, setNotice] = React.useState('')
      const byeRef = React.useRef('')
      byeRef.current = bye
      const [updatedAt, setUpdatedAt] = React.useState('')
      // 详情抽屉：展开的行、抽屉下方面板选中的标签，以及客户端 rss 历史（每次轮询一个
      // 样本，最近 60 个）。标签是 `out` / `err` 两个启动器日志流与 `diag` 诊断面。
      const [expanded, setExpanded] = React.useState(null)
      const [drawerView, setDrawerView] = React.useState('out')
      const [logData, setLogData] = React.useState(null)
      const [diagData, setDiagData] = React.useState(null)
      const [sessData, setSessData] = React.useState(null)
      const histRef = React.useRef({})
      const expandedRef = React.useRef(null)
      expandedRef.current = expanded
      const logStreamRef = React.useRef('out')
      logStreamRef.current = drawerView
      // 行身份。端口不是身份：对端行与本机行同处一个列表，两台机器可以同时运行
      // :3080。按端口索引抽屉会让这些行共用一个展开标记，并争抢同一份日志/会话
      // 缓冲——最后加载的覆盖先前的；轮询定时器是一个依赖为 [] 的 effect，其闭包在
      // 首次渲染时冻结，若通过仍为 null 的 `data` 解析 peer id，之后每次远端读取都会
      // 落到本机实例而不是对端。
      //
      // 行在进入面板时一次性打上标记，ref 在每次渲染时重新赋值，冻结的轮询闭包因此
      // 仍能看到当前表格。
      const rowKeyOf = (it) => (it.remote ? (it.source || 'peer') : 'local') + ':' + it.port
      const withRowKeys = (list) => (list || []).map((it) => Object.assign({}, it, { rowKey: rowKeyOf(it) }))
      const rowsRef = React.useRef([])
      rowsRef.current = withRowKeys(data && data.items)
      const findRow = (key) => rowsRef.current.find((it) => it.rowKey === key) || null
      // 两个加载器都接收行键而不是端口：它们先查出该行以取得端口，对远端行还要
      // 取得路由用的 peer id。失败会被记录而不是吞掉——只看得到 `null` 的抽屉无法
      // 区分“仍在加载”和“永远不会加载”，离线对端会因此一直转圈。
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
      const loadDiagnostics = async (key) => {
        const row = findRow(key)
        if (!row) return
        try {
          const r = await api({ action: 'diagnostics', port: row.port, pid: row.pid })
          if (expandedRef.current !== key) return
          setDiagData(r && r.ok
            ? Object.assign({}, r, { rowKey: key })
            : { ok: false, rowKey: key, code: (r && r.code) || null, error: (r && r.error) || null })
        } catch (err) {
          if (expandedRef.current === key) {
            setDiagData({ ok: false, rowKey: key, code: null, error: String(err && err.message ? err.message : err) })
          }
        }
      }
      const refresh = async () => {
        try {
          const res = await api({ action: 'list' })
          setData(res)
          // 只有失败的列表读取才能写这里的 error。每次成功刷新都清空它会抹掉操作
          // 错误：startNew 设置拒绝原因后调用 refresh()，“端口 3333 已被占用”在
          // 被读到之前就消失了，面板看起来像点击没有生效。错误会保留到后续操作替换
          // 它或成功为止。
          if (res && res.error) setError(localizeError(res, t))
          setUpdatedAt(new Date().toLocaleTimeString())
          // 顺便采样 fleet，供抽屉折线图使用。
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
      // 展开的行或抽屉标签变化时（重新）加载对应内容；会话摘要只跟随展开的行。
      React.useEffect(() => {
        setLogData(null)
        setDiagData(null)
        if (expanded === null) return
        if (drawerView === 'diag') loadDiagnostics(expanded)
        else loadLogs(expanded, drawerView)
      }, [expanded, drawerView])
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
          // 每次轮询要探测最多 50 个本机端口——标签页隐藏时完全跳过扫描
          // （visibilitychange 在返回时刷新），本面板所在实例告别后也不再继续。
          if (!document.hidden && !byeRef.current) {
            refresh()
            if (expandedRef.current !== null) {
              // 诊断面同样跟随轮询：崩溃记录往往正是在用户盯着面板时写入的。
              if (logStreamRef.current === 'diag') loadDiagnostics(expandedRef.current)
              else loadLogs(expandedRef.current, logStreamRef.current)
              loadSessions(expandedRef.current)
            }
          }
          // 每次调度都重新读取存储：effect 只挂载一次，间隔必须来自模块状态而不是
          // 闭包。
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
      // 忙碌标记存的是动作名而不是布尔值：一行的两个按钮共用一个忙碌键，只用布尔值时
      // 「停止中…」会同时出现在重启按钮上，而两个动作其实互斥（确认状态一次只武装
      // 一个）。
      const stop = async (item) => {
        // 桌面宿主永不停止，因此也没有告别页面：宿主用拒绝 code 回答，原因进入
        // `error`。
        if (item.runtime === 'desktop') return
        setNotice('')
        setBusy((b) => { const n = {}; n[item.rowKey] = 'stop'; return Object.assign({}, b, n) })
        let failMsg = null
        try {
          const res = await api({ action: 'stop', port: item.port })
          if (!res || !res.ok) failMsg = localizeError(res, t)
        } catch (err) {
          if (!item.current) failMsg = String(err && err.message ? err.message : err)
        }
        setBusy((b) => { const n = {}; n[item.rowKey] = false; return Object.assign({}, b, n) })
        if (item.current) {
          // 提供服务的实例即将离开：换成告别页面并停止轮询，而不是不断发起注定失败
          // 的请求。
          setBye(t.byeSelf)
          return
        }
        // 仍在启动的目标可能比转发超时更晚应答，随后又正常退出——如果该行已经消失，
        // 这次停止在所有有意义的方面都成功了。
        try {
          const lst = await api({ action: 'list' })
          // 排除对端行：只有本机才会停止 `item`，同一端口上的远端行否则会被读成
          // “仍然存在”。
          const stillThere = !!(lst && Array.isArray(lst.items) && lst.items.some((i) => !i.remote && i.port === item.port))
          if (failMsg && !stillThere) failMsg = null
        } catch (err) { }
        if (failMsg) setError(failMsg)
        refresh()
      }
      const requestStop = (item) => armThen(item, 'stop', stop)
      // 重启的待确认状态复用停止的那一套：同一行、同一个 4 秒窗口、同一个按钮形状。
      // 区别只在动作名——按钮的待确认标签与提示都随它变。
      const armThen = (item, action, run) => {
        // 与行的确认状态相同的规则：每个可停止的本机行都先进入确认，确认窗口会
        // 过期，避免过期的确认在很久之后触发操作。
        const armable = !item.remote && item.managed !== false && item.runtime !== 'desktop'
        if (armable && !(confirmPort && confirmPort.rowKey === item.rowKey && confirmPort.action === action)) {
          const armed = { rowKey: item.rowKey, action }
          setConfirmPort(armed)
          setTimeout(() => setConfirmPort((p) => (p === armed ? null : p)), 4000)
          return
        }
        setConfirmPort(null)
        run(item)
      }
      const restart = async (item) => {
        setNotice('')
        setBusy((b) => { const n = {}; n[item.rowKey] = 'restart'; return Object.assign({}, b, n) })
        let failMsg = null
        try {
          const res = await api({ action: 'restart', port: item.port })
          if (res && res.ok && res.url) {
            // 当前实例的交接：替代实例已经在**别的端口**应答，整页跳转过去，旧进程
            // 按宿主的安排退出。绝不能 refresh()——这个面板很快就会消失。
            setBusy((b) => { const n = {}; n[item.rowKey] = false; return Object.assign({}, b, n) })
            setNotice(t.handoffNotice(res.port))
            if (typeof window !== 'undefined' && window.location &&
              typeof window.location.replace === 'function') {
              window.location.replace(res.url)
            }
            return
          }
          if (!res || !res.ok) failMsg = localizeError(res, t)
        } catch (err) {
          failMsg = String(err && err.message ? err.message : err)
        }
        setBusy((b) => { const n = {}; n[item.rowKey] = false; return Object.assign({}, b, n) })
        // 端口没换，因此这一行仍然是同一行；重新读列表让 pid、启动时间与版本跟着更新。
        if (failMsg) setError(failMsg)
        refresh()
      }
      const requestRestart = (item) => armThen(item, 'restart', restart)
      const startNew = async () => {
        // 留空表示自动：宿主在托管区间内选择第一个空闲端口。输入的值原样发送，由
        // 宿主校验，越界数字会被报告，而不是悄悄替换。
        const wanted = String(portInput).trim()
        if (wanted !== '' && !/^\d+$/.test(wanted)) {
          setError(t.portInvalid)
          return
        }
        setStarting(true)
        setNotice('')
        try {
          const r = await api({ action: 'start', port: wanted === '' ? undefined : wanted })
          if (!r || !r.ok) {
            setError(localizeError(r, t))
          } else {
            // 实际运行的是哪个启动器无法猜测，也不是装饰性信息：桌面宿主可能解析到
            // 与应用自带不同的 dsh 检出，因此宿主上报所用的 bin 及其版本，面板直接
            // 写出它们，而不是让读者自行假定。
            setError(null)
            setNotice(r.bin ? t.startedWith(r.port, r.bin, r.binVersion) : '')
          }
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          // `starting` 为 true 时按钮被禁用，因此标志必须在每条路径上复位——下面
          // refresh 抛出的异常否则会让面板永远显示“启动中…”。
          setStarting(false)
          refresh()
        }
      }
      const stopAll = async () => {
        setNotice('')
        setBye(t.stoppingAll)
        // 提供服务的实例通常在请求处理中退出，因此这个应答永远到不了，读者只看到
        // 告别页面。桌面宿主是例外：它永远不是停止目标，会继续运行，其应答也会被
        // 等待——在仍然活着的面板上显示告别会误报发生的事，并藏起它刻意保留的行。
        let res = null
        try {
          res = await api({ action: 'stop-all' })
        } catch (err) { /* 宿主在处理请求时已经离开：继续走告别页面 */ }
        if (res && res.stoppedSelf === false) {
          setBye('')
          setNotice(t.stoppedAllKept(typeof res.skippedDesktop === 'number' ? res.skippedDesktop : 0))
          refresh()
          return
        }
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
      // 桌面行无法跟随相对 href。应用外壳只把 http(s) 的 window-open 交给系统
      // 浏览器，同窗口导航也不是替代方案：它走 will-navigate/will-redirect 路径，
      // 外壳不会把这些路径交给浏览器。因此获取宿主的绝对 token 地址并交给
      // window.open，外壳会将其识别为外部地址。
      const openInstance = async (it) => {
        setNotice('')
        const r = await openOnDesktop(it)
        if (r && r.ok && r.url) {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            window.open(r.url, '_blank', 'noreferrer')
          }
          return
        }
        // 把宿主的 code（launch_token_unavailable、no_port、generic…）映射到面板
        // 自己的措辞，而不是显示服务端原文。
        setError(localizeError(r, t))
      }
      // 已打标的行（见 rowKeyOf）：首次列表返回前 `items` 保持 null，面板因此显示
      // “加载中”而不是“空”。
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
          // 停止全部是面板上最具破坏性的操作：只有除当前实例之外还有可停止的实例时，
          // 才让它独占整个标题行。
          items && managedCount > 1 ? h('button', {
            className: 'dshim-btn dshim-btn-danger' + (confirmAll ? ' dshim-btn-warn' : ''),
            onClick: requestStopAll,
            key: 'all',
            title: t.stopAllTitle
          }, confirmAll ? t.confirmAll : t.stopAll) : null,
          h('button', { className: 'dshim-iconbtn', onClick: refresh, key: 'refresh', title: t.refreshTitle }, refreshIcon),
          h('button', { className: 'dshim-iconbtn', onClick: () => setOpen(false), key: 'close', title: t.closeTitle }, '×')),
        error ? h('div', { className: 'dshim-err', key: 'err' }, error) : null,
        notice ? h('div', { className: 'dshim-note', key: 'note' }, notice) : null,
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
                  onConfirm: requestStop, onConfirmRestart: requestRestart,
                  onOpen: openInstance, selfVersion: data ? data.selfVersion : null,
                  selfSession: data ? data.selfSession : null,
                  expanded: expanded === it.rowKey,
                  onToggle: (k) => setExpanded((cur) => (cur === k ? null : k))
                }),
                expanded === it.rowKey
                  ? h(Drawer, {
                    key: 'd' + it.rowKey, it: it, t: t, hist: histRef.current[it.rowKey] || [],
                    // 用加载器在自己应答上打的键匹配，之前展开行的慢应答因此不会落进
                    // 这一行的抽屉。
                    log: logData && logData.rowKey === it.rowKey ? logData : null,
                    sess: sessData && sessData.rowKey === it.rowKey ? sessData : null,
                    diag: diagData && diagData.rowKey === it.rowKey ? diagData : null,
                    view: drawerView, onView: setDrawerView
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

    // 始终运行的 fleet 上线/下线提示，走 SSE。连接独立于面板：任何托管实例加入或
    // 离开都会在右下角弹出短暂提示。连接时的基线帧只播种成员关系，不弹提示，因此
    // 打开页面不会把当前 fleet 刷成一串通知。
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
// The shared launcher assembly: one icon plus the menu of panels it opens, for a
// plugin's browser half.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/launcher.js.
// DSH client artifacts are self-contained classic scripts, so the fragment is
// embedded into lib/client.js at build time by
//   npm run launcher:sync    (write it)
//   npm run launcher:check   (fail on drift)
// instead of being imported: a bare import would put a runtime dependency on
// this package into the bundle that embeds it, and an embedding plugin ships
// standalone, with nothing else required.
//
// The launcher is one icon that opens a menu of utility panels. It is contributed
// through slots, not through a page-local protocol: exactly one copy of this
// assembly runs per page — the first to load wins the window mutex, registers the
// launcher, and declares the menu seat — while the other copies register nothing
// here and only wait to take the claim over once their owner is disposed.
const UTILITY_ITEM_SLOT = 'createhelper.utility.item'
const UTILITY_MUTEX_KEY = '__CREATEHELPER_DSH_UTILITY_LAUNCHER_V1__'
const UTILITY_CSS_ID = 'createhelper-utility-launcher'
const UTILITY_FALLBACK_LEFT_PX = 80
const UTILITY_MEASURE_TRIES = 120
const UTILITY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect></svg>'

// The launcher's own chrome, injected once by whichever copy wins the mutex.
// The rows are other plugins' components, so the menu styles its buttons by
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

// The launcher tracks the shell's sidebar column rather than a fixed offset: its
// left edge sits 16px right of the sidebar's edge, and 80px while the shell has
// not laid that column out yet.
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
// belong to other plugins, not to this block.
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
// The claim lives on the page and is released with its owner. Any plugin that
// embeds this block may win the claim, so without the release a hot reload of
// the owner would dispose its registration while the claim stayed taken, and the
// launcher would stay missing until the page was reloaded. A released claim wakes
// the other copies on the page, which re-register immediately.
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
        console.error('[utility-launcher] could not register the launcher', error)
      }
    }
  })
}
// </dsh-utility-launcher>
    // 本插件在 launcher 菜单中的一行。选择它打开面板；菜单会因点击向上冒泡而自行
    // 关闭。
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
        // 释放由插件自己的上下文负责，因此无论 slots 服务是否到达都会执行。
        ctx.on('dispose', () => {
          setOpen(false)
        })
        // 跟随 DSH 唯一的持久语言设置。字典仍内嵌，RC1 之前的宿主缺少可选服务时
        // 也能渲染。
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
        // 等待 slots 服务，而不是只探测一次。本 bundle 与提供 `slots` 的运行时之间
        // 的挂载顺序没有保证，只调用一次 ctx.get('slots') 失败会让面板静默消失——
        // 没有错误、没有启动失败，界面上什么都没有。harness 自己的 UI 包也使用这种
        // 写法。
        ctx.inject(['slots'], (scope) => {
          // 本插件向 launcher 菜单贡献一行，并在自己是页面上第一个携带 launcher 的
          // 插件时声明拥有该菜单（见上面的 utility-launcher 块）。面板与提示仍留在
          // 旁边的 overlay 层。
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
        // 由设置驱动的偏好：绑定宿主注册的命名空间，并把每个 ready 状态的快照镜像到
        // prefsStore。单独的 inject 调用让没有设置界面的构建只失去偏好，绝不失去面板
        // （此时这个回调根本不会触发）。
        //
        // 该服务有两个名字，因此有两次 inject 调用：0.1.5 及以前是 `settingsScope`，
        // 0.1.7-rc.1 起是 `configForms`（该版本不再提供 `settingsScope`）。两者都是
        // 运行时 inject——缺少服务时子 fiber 保持 pending，回调根本不会运行，因此缺少
        // 任一名字都不付出代价。不要把任一个提升到模块级 `inject` 列表：那会门控激活，
        // 缺该服务的版本上整个条目都会停摆。
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
