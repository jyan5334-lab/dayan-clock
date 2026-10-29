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
  const settingsTabs = [...document.querySelectorAll('[data-settings-tab]')];
  const settingsPanels = [...document.querySelectorAll('[data-settings-panel]')];
  const settingsFooters = [...document.querySelectorAll('[data-settings-footer]')];
  const showAlmanac = document.getElementById('show-almanac');
  const modeVisibility = [...document.querySelectorAll('[data-mode-visibility]')];
  const autoStart = document.getElementById('auto-start');
  const autoStartStatus = document.getElementById('auto-start-status');
  const aboutVersion = document.getElementById('about-version');
  const windowLayerInputs = [...document.querySelectorAll('[data-window-layer]')];
  const checkUpdate = document.getElementById('check-update');
  const updateCheckStatus = document.getElementById('update-check-status');
  const updateModal = document.getElementById('update-modal');
  const updateVersion = document.getElementById('update-version');
  const updateNotes = document.getElementById('update-notes');
  const updateProgressWrap = document.getElementById('update-progress-wrap');
  const updateProgressBar = document.getElementById('update-progress-bar');
  const updateProgressText = document.getElementById('update-progress-text');
  const updateConfirm = document.getElementById('update-confirm');
  const updateError = document.getElementById('update-error');
  let policyRequest, policyBusy = false, lastPolicy, returnToSettings = false;
  let chromeTimer;
  let style = 1, widget;
  let displaySettings = { showAlmanac: true, modes: { clock: false, watch: true, down: true, up: true } };
  let autoStartEnabled = true;
  let windowLayers = { unlocked: 'top', locked: 'top' };
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
  const revealChrome = event => {
    if (document.documentElement.dataset.fullscreen !== 'true') return;
    if ((event?.clientY ?? 0) > 84) return;
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
  const normalizeDisplaySettings = value => {
    const modes = value?.modes && typeof value.modes === 'object' ? value.modes : {};
    return { showAlmanac: value?.showAlmanac !== false, modes: { clock: modes.clock === true, watch: modes.watch !== false, down: modes.down !== false, up: modes.up !== false } };
  };
  const selectSettingsTab = name => {
    const selected = settingsTabs.some(tab => tab.dataset.settingsTab === name) ? name : 'policy';
    settingsTabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.settingsTab === selected)));
    settingsPanels.forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== selected; });
    settingsFooters.forEach(footer => { footer.hidden = footer.dataset.settingsFooter !== selected; });
  };
  const syncDisplaySettings = () => {
    window.dayanDisplaySettings = displaySettings;
    showAlmanac.checked = displaySettings.showAlmanac;
    modeVisibility.forEach(input => { input.checked = displaySettings.modes[input.dataset.modeVisibility] !== false; });
    document.getElementById('simple-timers').dispatchEvent(new CustomEvent('dayan:display-settings', { detail: displaySettings }));
  };
  const syncAutoStart = () => {
    autoStart.checked = autoStartEnabled;
    autoStartStatus.textContent = autoStartEnabled ? '当前状态：已开启' : '当前状态：已关闭';
  };
  const syncWindowLayers = () => {
    windowLayerInputs.forEach(input => { input.checked = windowLayers[input.dataset.windowLayer] === input.value; });
  };
  const openSettings = (refresh = true) => {
    if (security.locked) return;
    closeMenu();
    securityModal.hidden = true;
    settingsModal.hidden = false;
    selectSettingsTab('policy');
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
    if (!Number.isInteger(index) || index < 0 || index >= sections.length) index = 1;
    style = index;
    sections.forEach((section, i) => { section.hidden = index !== i; });
    menu.querySelectorAll('[data-style]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.style) === style)));
    document.documentElement.dataset.style = String(style);
    document.getElementById('simple-timers').dispatchEvent(new Event('dayan:refresh'));
  };
  const save = () => bridge.save({ widget, style, displaySettings, windowLayers, autoStart: autoStartEnabled });
  addEventListener('beforeunload', () => {
    document.getElementById('simple-timers').dispatchEvent(new Event('dayan:checkpoint'));
    bridge.saveSync({ widget, style, displaySettings, windowLayers, autoStart: autoStartEnabled });
  });

  const syncWindow = state => {
    document.getElementById('pin').setAttribute('aria-pressed', String(state.pinned));
    const full = document.getElementById('fullscreen');
    full.setAttribute('aria-pressed', String(state.fullscreen));
    full.setAttribute('aria-label', state.fullscreen ? '退出全屏' : '全屏');
    full.title = state.fullscreen ? '退出全屏' : '全屏';
    full.innerHTML = `<i data-lucide="${state.fullscreen ? 'minimize' : 'maximize'}"></i>`;
    document.documentElement.dataset.fullscreen = String(state.fullscreen);
    document.documentElement.dataset.desktopHosted = String(Boolean(state.desktopHosted));
    if (state.windowLayers) { windowLayers = { ...windowLayers, ...state.windowLayers }; syncWindowLayers(); }
    if (state.fullscreen) { document.documentElement.classList.remove('chrome-visible'); clearTimeout(chromeTimer); }
    else document.documentElement.classList.add('chrome-visible');
    syncSecurity(state);
    fit();
    lucide.createIcons();
  };
  bridge.onWindowState(syncWindow);
  bridge.onDesktopCommand(action => {
    if (action === 'background') document.querySelector('[data-variant]:not([hidden]) .background-toggle')?.click();
    else if (['style-toggle', 'settings-toggle', 'lock'].includes(action)) document.getElementById(action)?.click();
  });

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
  settingsTabs.forEach(tab => tab.addEventListener('click', () => { selectSettingsTab(tab.dataset.settingsTab); if (tab.dataset.settingsTab === 'policy') refreshPolicy(); }));
  showAlmanac.addEventListener('change', () => { displaySettings = { ...displaySettings, showAlmanac: showAlmanac.checked }; syncDisplaySettings(); save(); });
  modeVisibility.forEach(input => input.addEventListener('change', () => { displaySettings = { ...displaySettings, modes: { ...displaySettings.modes, [input.dataset.modeVisibility]: input.checked } }; syncDisplaySettings(); save(); }));
  windowLayerInputs.forEach(input => input.addEventListener('change', () => {
    windowLayers = { ...windowLayers, [input.dataset.windowLayer]: input.value };
    syncWindowLayers();
    save();
  }));
  autoStart.addEventListener('change', async () => {
    const requested = autoStart.checked;
    autoStart.disabled = true;
    const result = await bridge.setAutoStart(requested);
    autoStart.disabled = false;
    if (!result?.ok) { autoStart.checked = autoStartEnabled; autoStartStatus.textContent = result?.error || '开机自启动设置失败'; return; }
    autoStartEnabled = result.enabled !== false;
    syncAutoStart(); save();
  });
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
  checkUpdate.addEventListener('click', async () => {
    checkUpdate.disabled = true; updateCheckStatus.textContent = '正在检查更新…';
    const result = await bridge.updateCheck();
    checkUpdate.disabled = false;
    if (result?.available) updateCheckStatus.textContent = `发现 ${result.version}，请按提示更新`;
    else updateCheckStatus.textContent = result?.error || `当前已是最新版本（${result?.currentVersion || '未知'}）`;
  });
  const showUpdate = info => {
    updateVersion.textContent = `当前版本 ${info.currentVersion || '—'} · 新版本 ${info.version}`;
    updateNotes.textContent = info.notes || '新版本已准备好，更新完成后程序会自动重新打开。';
    updateError.hidden = true;
    updateProgressWrap.hidden = true;
    updateConfirm.disabled = false;
    updateConfirm.querySelector('span').textContent = '确定更新';
    updateModal.hidden = false;
    lucide.createIcons();
  };
  bridge.onUpdateAvailable(showUpdate);
  bridge.onUpdateProgress(progress => {
    updateProgressWrap.hidden = false;
    updateProgressBar.style.width = `${Math.round(progress.percent || 0)}%`;
    updateProgressText.textContent = progress.status || (progress.total ? `正在下载 ${Math.round(progress.percent)}%` : '正在下载更新…');
    if (updateConfirm.disabled) updateConfirm.querySelector('span').textContent = progress.percent >= 100 ? '正在启动安装程序…' : '正在下载更新…';
  });
  bridge.onUpdateError(error => {
    updateError.textContent = error?.message || '更新失败，请稍后重试';
    updateError.hidden = false;
    updateConfirm.disabled = false;
    updateConfirm.querySelector('span').textContent = '重新更新';
  });
  updateConfirm.addEventListener('click', async () => {
    updateConfirm.disabled = true;
    updateConfirm.querySelector('span').textContent = '正在准备更新…';
    let result;
    try { result = await bridge.updateInstall(); }
    catch (error) { result = { ok: false, error: error.message || '安装交接失败，请重试' }; }
    if (!result?.ok) {
      updateError.textContent = result?.error || '更新失败，请稍后重试';
      updateError.hidden = false;
      updateConfirm.disabled = false;
      updateConfirm.querySelector('span').textContent = '重新更新';
    }
  });
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
      const buttons = [...settingsModal.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(element => !element.hidden);
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
    displaySettings = normalizeDisplaySettings(saved?.displaySettings);
    windowLayers = { ...windowLayers, ...(saved?.windowLayers || {}) };
    autoStartEnabled = saved?.autoStart !== false;
    syncDisplaySettings();
    syncAutoStart();
    syncWindowLayers();
    document.getElementById('system-app-version').textContent = saved?.appVersion || '未知';
    aboutVersion.textContent = `当前版本：${saved?.appVersion || '未知'}`;
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
