(() => {
  const bridge = window.dayan;
  const sections = [...document.querySelectorAll('[data-variant]')];
  const stage = document.getElementById('desktop-stage');
  const menu = document.getElementById('style-menu');
  const styleToggle = document.getElementById('style-toggle');
  const lockButton = document.getElementById('lock');
  const lockScreen = document.getElementById('lock-screen');
  const unlockPanel = document.getElementById('unlock-panel');
  const unlockForm = document.getElementById('unlock-form');
  const unlockPassword = document.getElementById('unlock-password');
  const unlockError = document.getElementById('unlock-error');
  const securityModal = document.getElementById('security-modal');
  const securityForm = document.getElementById('security-form');
  const securityClose = document.getElementById('security-close');
  const currentPassword = document.getElementById('current-password');
  const currentPasswordLabel = document.getElementById('current-password-label');
  const newPassword = document.getElementById('new-password');
  const confirmPassword = document.getElementById('confirm-password');
  const securityError = document.getElementById('security-error');
  const policyStatus = document.getElementById('policy-status');
  const policyDescription = document.getElementById('policy-description');
  const policySupport = document.getElementById('policy-support');
  const policyEnable = document.getElementById('policy-enable');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');
  const policyRefresh = document.getElementById('policy-refresh');
  const policyRestore = document.getElementById('policy-restore');
  const policyError = document.getElementById('policy-error');
  const settingsPassword = document.getElementById('settings-password');
  let policyRequest, policyBusy = false, lastPolicy, returnToSettings = false;
  let chromeTimer;
  let style = 1, widget;
  let security = { passwordConfigured: false, locked: false };

  const fit = () => {
    if (document.documentElement.dataset.fullscreen === 'true') {
      stage.style.transform = 'none';
      stage.style.left = '0px';
      stage.style.top = '0px';
      stage.style.width = '100vw';
      stage.style.height = '100vh';
      return;
    }
    const scale = Math.min(innerWidth / 800, innerHeight / 568);
    if (scale <= 0) return;
    stage.style.width = `${innerWidth / scale}px`;
    stage.style.height = `${innerHeight / scale}px`;
    stage.style.transform = `scale(${scale})`;
    stage.style.left = '0px';
    stage.style.top = '0px';
  };
  addEventListener('resize', fit); fit();

  const closeMenu = () => { menu.hidden = true; styleToggle.setAttribute('aria-expanded', 'false'); };
  const revealChrome = () => {
    if (document.documentElement.dataset.fullscreen !== 'true') return;
    document.documentElement.classList.add('chrome-visible');
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => { document.documentElement.classList.remove('chrome-visible'); closeMenu(); }, 1800);
  };
  addEventListener('mousemove', revealChrome, { passive:true });

  const showSecurityError = (element, message) => { element.textContent = message; element.hidden = false; };
  const clearSecurityError = element => { element.textContent = ''; element.hidden = true; };
  const policyCopy = status => {
    if (status?.error) return { state: 'error', label: '检测失败', description: '无法确认系统状态，请点击“重新检测”。当前不会申请系统权限。' };
    if (!status?.supported) return { state: 'unsupported', label: '暂未适配', description: '当前系统不在一键授权适配范围，应用内密码锁仍可使用。' };
    if (status.enabled) return { state: 'enabled', label: '策略已配置', description: '已读取到全部五项限制策略。部分策略需重新登录后生效，请在专用展示账户中验证。' };
    return { state: 'pending', label: '待授权', description: '点击“一键引导授权”，在 Windows 弹窗中由管理员批准。完成后自动复检，标准账户可能需要管理员凭据。' };
  };
  const syncPolicy = status => {
    lastPolicy = status;
    const copy = policyCopy(status);
    policyStatus.textContent = copy.label;
    policyStatus.dataset.state = copy.state;
    settingsToggle.dataset.policyState = copy.state;
    settingsToggle.title = `设置 · ${copy.label}`;
    policyDescription.textContent = copy.description;
    document.getElementById('system-version').textContent = status?.productName ? `${status.productName} ${status.displayVersion || ''} · Build ${status.build || '未知'}` : '未能读取';
    document.getElementById('system-architecture').textContent = status?.architecture || '未能读取';
    document.getElementById('system-checked-at').textContent = status?.checkedAt ? new Date(status.checkedAt).toLocaleString('zh-CN', { hour12: false }) : '未完成';
    if (status?.appVersion) document.getElementById('system-app-version').textContent = status.appVersion;
    document.querySelectorAll('[data-policy]').forEach(element => {
      const item = status?.policies?.find(policy => policy.name === element.dataset.policy);
      element.textContent = item ? (item.enabled ? '已配置' : '未配置') : '未能读取';
      element.dataset.enabled = item ? String(item.enabled) : 'unknown';
    });
    policySupport.textContent = '一键授权适配范围：Windows 10 / Windows 11（x64），需管理员批准且系统策略允许。Windows 12、更高版本及其他架构暂未验证。';
    policyEnable.disabled = policyBusy || !status?.supported || Boolean(status.error) || Boolean(status.enabled);
    policyRestore.disabled = policyBusy || Boolean(status?.error) || !status?.canRestore;
    policyRefresh.disabled = policyBusy;
    settingsPassword.disabled = policyBusy;
    policyEnable.querySelector('span').textContent = status?.enabled ? '已配置授权策略' : '一键引导授权';
    if (status?.error) showSecurityError(policyError, status.error);
  };
  const refreshPolicy = () => {
    if (policyRequest) return policyRequest;
    if (policyBusy) return Promise.resolve(lastPolicy);
    policyStatus.textContent = '检测中';
    policyStatus.dataset.state = 'checking';
    settingsToggle.dataset.policyState = 'checking';
    clearSecurityError(policyError);
    policyEnable.disabled = true;
    policyRestore.disabled = true;
    policyRefresh.disabled = true;
    policyRequest = bridge.securityPolicyStatus().then(status => { syncPolicy(status); return status; })
      .catch(error => { const status = { supported: false, enabled: false, error: error.message || '检测失败' }; syncPolicy(status); return status; })
      .finally(() => { policyRequest = null; policyRefresh.disabled = false; });
    return policyRequest;
  };
  const openSettings = (refresh = true) => {
    if (security.locked) return;
    closeMenu();
    securityModal.hidden = true;
    settingsModal.hidden = false;
    settingsToggle.setAttribute('aria-expanded', 'true');
    settingsClose.focus();
    lucide.createIcons();
    if (refresh) refreshPolicy();
  };
  const closeSettings = () => {
    settingsModal.hidden = true;
    settingsToggle.setAttribute('aria-expanded', 'false');
    bridge.settingsSeen().catch(() => {});
    settingsToggle.focus();
  };
  const openSecurityModal = () => {
    if (security.locked) return;
    closeMenu();
    const hasPassword = security.passwordConfigured;
    currentPassword.hidden = !hasPassword;
    currentPasswordLabel.hidden = !hasPassword;
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    clearSecurityError(securityError);
    securityModal.hidden = false;
    (hasPassword ? currentPassword : newPassword).focus();
    lucide.createIcons();
  };
  const closeSecurityModal = () => {
    securityModal.hidden = true;
    clearSecurityError(securityError);
    if (returnToSettings) { returnToSettings = false; openSettings(false); }
  };
  const showUnlockPanel = () => {
    if (!security.locked) return;
    unlockPanel.hidden = false;
    lockScreen.classList.add('has-panel');
    clearSecurityError(unlockError);
    unlockPassword.value = '';
    unlockPassword.focus();
    revealChrome();
  };
  const hideUnlockPanel = () => {
    unlockPanel.hidden = true;
    lockScreen.classList.remove('has-panel');
    clearSecurityError(unlockError);
    unlockPassword.value = '';
  };
  const isUnlockEditingKey = event => event.target === unlockPassword && (/^\d$/.test(event.key) || ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) && !event.ctrlKey && !event.metaKey && !event.altKey;
  document.addEventListener('keydown', event => {
    if (security.locked && !isUnlockEditingKey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('keyup', event => {
    if (security.locked && !isUnlockEditingKey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('contextmenu', event => { if (security.locked) event.preventDefault(); });
  const syncSecurity = state => {
    security = { passwordConfigured: Boolean(state.passwordConfigured), locked: Boolean(state.locked) };
    document.documentElement.classList.toggle('locked', security.locked);
    lockScreen.hidden = !security.locked;
    if (!security.locked) hideUnlockPanel();
    lockButton.setAttribute('aria-pressed', String(security.locked));
    lockButton.setAttribute('aria-label', security.locked ? '输入密码解锁' : security.passwordConfigured ? '锁定' : '设置锁屏密码');
    lockButton.title = security.locked ? '输入密码解锁' : security.passwordConfigured ? '锁定' : '设置锁屏密码';
    settingsPassword.querySelector('span').textContent = security.passwordConfigured ? '修改锁屏密码' : '设置锁屏密码';
    if (security.locked) { closeMenu(); settingsModal.hidden = true; securityModal.hidden = true; }
    lucide.createIcons();
  };

  const selectStyle = index => {
    style = index;
    sections.forEach((section, i) => { section.hidden = index !== i; });
    document.querySelectorAll('[data-style]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.style) === style)));
    document.documentElement.dataset.style = String(style);
    document.getElementById('simple-timers').dispatchEvent(new Event('dayan:refresh'));
  };
  const save = () => bridge.save({ widget, style });
  addEventListener('beforeunload', () => {
    document.getElementById('simple-timers').dispatchEvent(new Event('dayan:checkpoint'));
    bridge.saveSync({ widget, style });
  });

  const syncWindow = state => {
    document.getElementById('pin').setAttribute('aria-pressed', String(state.pinned));
    const full = document.getElementById('fullscreen');
    full.setAttribute('aria-pressed', String(state.fullscreen));
    full.setAttribute('aria-label', state.fullscreen ? '退出全屏' : '全屏');
    full.title = state.fullscreen ? '退出全屏' : '全屏';
    full.innerHTML = `<i data-lucide="${state.fullscreen ? 'minimize' : 'maximize'}"></i>`;
    document.documentElement.dataset.fullscreen = String(state.fullscreen);
    if (state.fullscreen) { document.documentElement.classList.remove('chrome-visible'); clearTimeout(chromeTimer); }
    else document.documentElement.classList.add('chrome-visible');
    syncSecurity(state);
    fit();
    lucide.createIcons();
  };
  bridge.onWindowState(syncWindow);

  styleToggle.addEventListener('click', () => { if (security.locked) return; menu.hidden = !menu.hidden; styleToggle.setAttribute('aria-expanded', String(!menu.hidden)); });
  lockButton.addEventListener('click', async () => {
    if (security.locked) { showUnlockPanel(); return; }
    if (!security.passwordConfigured) { openSecurityModal(); return; }
    await bridge.securityLock();
  });
  document.querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', () => {
    if (security.locked) return;
    selectStyle(Number(button.dataset.style)); closeMenu(); save();
  }));
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#style-menu,#style-toggle')) closeMenu(); });

  securityClose.addEventListener('click', closeSecurityModal);
  settingsToggle.addEventListener('click', () => openSettings());
  settingsClose.addEventListener('click', closeSettings);
  policyRefresh.addEventListener('click', refreshPolicy);
  document.getElementById('security-open-settings').addEventListener('click', () => openSettings());
  settingsPassword.addEventListener('click', () => {
    settingsModal.hidden = true;
    returnToSettings = true;
    openSecurityModal();
  });
  const runPolicyAction = async action => {
    if (policyBusy || policyRequest || security.locked) return;
    policyBusy = true;
    policyEnable.disabled = true;
    policyRestore.disabled = true;
    policyRefresh.disabled = true;
    settingsPassword.disabled = true;
    const button = action === 'restore' ? policyRestore : policyEnable;
    button.querySelector('span').textContent = '等待 Windows 授权…';
    clearSecurityError(policyError);
    try {
      const result = await (action === 'restore' ? bridge.securityPolicyRestore() : bridge.securityPolicyEnable());
      policyBusy = false;
      syncPolicy(result?.status || { supported: false, error: '操作未返回系统状态，请重新检测' });
      if (!result?.ok) showSecurityError(policyError, result?.error || '授权未完成，请重试');
    } catch (error) {
      policyBusy = false;
      syncPolicy(lastPolicy);
      showSecurityError(policyError, error.message || '授权未完成，请重试');
    } finally {
      policyRestore.querySelector('span').textContent = '恢复原有策略';
    }
  };
  policyEnable.addEventListener('click', () => runPolicyAction('enable'));
  policyRestore.addEventListener('click', () => runPolicyAction('restore'));
  securityForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearSecurityError(securityError);
    if (!/^\d{4,16}$/.test(newPassword.value)) { showSecurityError(securityError, '密码必须是 4 至 16 位数字'); return; }
    if (newPassword.value !== confirmPassword.value) { showSecurityError(securityError, '两次输入的密码不一致'); return; }
    const result = await bridge.securitySetPassword({ current: currentPassword.value, next: newPassword.value });
    if (!result?.ok) { showSecurityError(securityError, result?.error || '密码保存失败'); return; }
    security = { ...security, passwordConfigured: true };
    closeSecurityModal();
    syncSecurity(security);
  });
  unlockForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearSecurityError(unlockError);
    if (await bridge.securityVerify(unlockPassword.value)) {
      syncSecurity({ ...security, locked: false });
      return;
    }
    showSecurityError(unlockError, '密码不正确');
    unlockPassword.select();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsModal.hidden) { closeSettings(); event.preventDefault(); return; }
    if (event.key === 'Tab' && !settingsModal.hidden) {
      const buttons = [...settingsModal.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
      return;
    }
    if (event.key === 'Escape' && !securityModal.hidden) { closeSecurityModal(); event.preventDefault(); return; }
    if (event.key === 'Escape') closeMenu();
    if (security.locked && (event.key === 'F11' || event.key === 'Escape')) { event.preventDefault(); return; }
    if (event.key === 'F11' || (event.key === 'Escape' && document.documentElement.dataset.fullscreen === 'true')) {
      event.preventDefault(); bridge.windowAction('fullscreen');
    }
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) event.preventDefault();
  });
  for (const action of ['pin', 'fullscreen', 'minimize', 'close']) document.getElementById(action).addEventListener('click', () => { if (!security.locked) bridge.windowAction(action); });
  document.querySelector('.drag-area').addEventListener('dblclick', () => { if (!security.locked) bridge.windowAction('fullscreen'); });
  for (const handle of document.querySelectorAll('[data-corner]')) {
    let dragging = false;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || security.locked) return;
      event.preventDefault(); dragging = true; handle.setPointerCapture(event.pointerId);
      bridge.resizeStart(handle.dataset.corner, { x: event.screenX, y: event.screenY });
    });
    handle.addEventListener('pointermove', event => { if (dragging) bridge.resizeMove({ x: event.screenX, y: event.screenY }); });
    const end = () => { if (dragging) { dragging = false; bridge.resizeEnd(); } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
    addEventListener('blur', end);
  }

  bridge.load().then(saved => {
    widget = saved?.widget;
    document.getElementById('system-app-version').textContent = saved?.appVersion || '未知';
    selectStyle(Number.isInteger(saved?.style) ? saved.style : 1);
    window.openai = { widgetState: widget, setWidgetState: next => { widget = next; return save(); } };
    syncWindow(saved || { pinned: false, fullscreen: false, passwordConfigured: false, locked: false });
    refreshPolicy();
    if (saved?.showSettingsOnStartup) openSettings(false);
    const script = document.createElement('script');
    script.src = 'renderer/timer.js';
    script.onload = () => {
      document.querySelectorAll('[data-tooltip]').forEach(el => { el.title = el.dataset.tooltip; });
      document.documentElement.dataset.ready = 'true';
    };
    document.head.append(script);
  }).catch(error => { console.error(error); });
})();
