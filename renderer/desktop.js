(() => {
  if (new URLSearchParams(location.search).has('updater')) return;
  const bridge = window.dayan;
  const editorMode = new URLSearchParams(location.search).has('editor');
  if (editorMode) document.documentElement.classList.add('presentation-editor');
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
  const securityQuestion = document.getElementById('security-question');
  const securityAnswer = document.getElementById('security-answer');
  const securityAnswerConfirm = document.getElementById('security-answer-confirm');
  const recoveryForm = document.getElementById('recovery-form');
  const recoveryAnswer = document.getElementById('recovery-answer');
  const resetForm = document.getElementById('recovery-reset-form');
  const resetPassword = document.getElementById('recovery-new-password');
  const resetConfirm = document.getElementById('recovery-confirm-password');
  const recoveryKeyboard = document.getElementById('recovery-keyboard');
  let recoveryToken = '', recoveryTarget = recoveryAnswer;
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
  const showClockDate = document.getElementById('show-clock-date');
  const modeVisibility = [...document.querySelectorAll('[data-mode-visibility]')];
  const autoStart = document.getElementById('auto-start');
  const autoStartStatus = document.getElementById('auto-start-status');
  const aboutVersion = document.getElementById('about-version');
  const windowLayerInputs = [...document.querySelectorAll('[data-window-layer],[data-window-scope]')];
  const checkUpdate = document.getElementById('check-update');
  const updateCheckStatus = document.getElementById('update-check-status');
  let policyRequest, policyBusy = false, lastPolicy, returnToSettings = false;
  let chromeTimer;
  let style = 1, widget;
  let displaySettings = { showAlmanac: true, showClockDate: true, modes: { clock: false, watch: true, down: true, up: true } };
  let autoStartEnabled = true;
  let windowLayers = { unlocked: 'top', locked: 'top', displayScope: 'current' };
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
    if (status?.restored) return { state: 'restored', label: '已恢复原有策略', description: '恢复成功，已核对五项用户策略的原值。需要锁屏限制时可重新授权；如原有策略本身含限制，会保留并标记。部分系统快捷键需要注销并重新登录后恢复。' };
    if (!status?.supported) return { state: 'unsupported', label: '暂未适配', description: '当前系统不在一键授权适配范围，应用内密码锁仍可使用。' };
    if (status.restartRequired) return { state: 'partial', label: '等待重启', description: 'Windows Keyboard Filter 组件正在等待重启。请保存工作、重启电脑后回到此处继续授权，当前尚未生效。' };
    if (status.enabled && status.keyboardFilterEnabled && status.administratorFiltering) return { state: 'enabled', label: '安全序列规则已配置', description: '五项用户策略及 Ctrl+Alt+Delete 筛选规则已读取。修改管理员筛选范围后需重新登录，请在目标展示账户用实体键盘验收。' };
    if (status.enabled) return { state: 'partial', label: '基础策略已配置', description: status.fullProtectionSupported ? '五项用户策略已配置，可继续授权开启 Keyboard Filter 组件并配置安全序列规则。首次开启需要重启电脑。' : '当前系统不提供 Keyboard Filter。基础策略已配置，但管理员授权不能让此版本拦截 Ctrl+Alt+Delete；需要支持该组件的企业版、教育版或 IoT 版本。' };
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
      element.textContent = element.dataset.policy === 'KeyboardFilter_CtrlAltDelete' && !status?.fullProtectionSupported ? '当前版本不支持' : item ? (status.restored ? (item.enabled ? '已恢复（原有配置）' : '已恢复（未限制）') : item.enabled ? '已配置' : status.restartRequired && element.dataset.policy === 'KeyboardFilter_CtrlAltDelete' ? '等待重启' : '未配置') : '未能读取';
      element.dataset.enabled = item ? String(item.enabled) : 'unknown';
    });
    policySupport.textContent = 'Windows 10/11 x64；系统安全序列需企业/教育/IoT 版与管理员授权。其他版本未验证。';
    policyEnable.disabled = policyBusy || !status?.supported || Boolean(status.error) || Boolean(status.restartRequired) || Boolean(!status.restored && status.enabled && (status.keyboardFilterEnabled && status.administratorFiltering || !status.fullProtectionSupported));
    policyRestore.disabled = policyBusy || Boolean(status?.error) || !status?.canRestore;
    policyRefresh.disabled = policyBusy;
    settingsPassword.disabled = policyBusy;
    policyEnable.querySelector('span').textContent = status?.restored ? '重新授权' : status?.restartRequired ? '请重启后继续' : status?.enabled && status?.keyboardFilterEnabled && status?.administratorFiltering ? '规则已配置' : status?.enabled ? status?.fullProtectionSupported ? '补充系统级防护' : '当前系统仅支持基础策略' : '一键引导授权';
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
    return { showAlmanac: value?.showAlmanac !== false, showClockDate: value?.showClockDate !== false, modes: { clock: modes.clock === true, watch: modes.watch !== false, down: modes.down !== false, up: modes.up !== false } };
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
    showClockDate.checked = displaySettings.showClockDate;
    modeVisibility.forEach(input => { input.checked = displaySettings.modes[input.dataset.modeVisibility] !== false; });
    document.getElementById('simple-timers').dispatchEvent(new CustomEvent('dayan:display-settings', { detail: displaySettings }));
  };
  const syncAutoStart = () => {
    autoStart.checked = autoStartEnabled;
    autoStartStatus.textContent = autoStartEnabled ? '当前状态：已开启' : '当前状态：已关闭';
  };
  const syncWindowLayers = () => {
    windowLayerInputs.forEach(input => { const key = input.dataset.windowLayer || 'displayScope'; input.checked = windowLayers[key] === input.value; });
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
    if (editorMode) bridge.editorClose();
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
    securityAnswer.value = ''; securityAnswerConfirm.value = '';
    securityAnswer.required = !security.recoveryConfigured;
    securityAnswerConfirm.required = !security.recoveryConfigured;
    securityAnswer.placeholder = security.recoveryConfigured ? '留空保留原密保，填写则更新答案' : '填写不易忘记的密保答案';
    if (security.recoveryQuestionId) securityQuestion.value = security.recoveryQuestionId;
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
    unlockForm.hidden = false; recoveryForm.hidden = true; resetForm.hidden = true; recoveryKeyboard.hidden = true;
    recoveryToken = ''; bridge.recoveryInput(false);
    unlockPassword.focus();
    bridge.securityUnlockInput(true);
    revealChrome();
  };
  document.getElementById('simple-timers').addEventListener('dayan:show-unlock', showUnlockPanel);
  const hideUnlockPanel = () => {
    bridge.securityUnlockInput(false);
    unlockPanel.hidden = true;
    lockScreen.classList.remove('has-panel');
    clearSecurityError(unlockError);
    unlockPassword.value = '';
    recoveryAnswer.value = ''; resetPassword.value = ''; resetConfirm.value = ''; recoveryToken = '';
    bridge.recoveryInput(false);
  };
  const isUnlockEditingKey = event => [unlockPassword, resetPassword, resetConfirm, recoveryAnswer].includes(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey && (event.target === recoveryAnswer ? event.key.length === 1 || ['Backspace', 'Enter', 'Shift', 'Process', 'Unidentified'].includes(event.key) : !event.shiftKey && (/^\d$/.test(event.key) || ['Backspace', 'Enter'].includes(event.key)));
  const enableUnlockInput = () => { if (security.locked && !unlockPanel.hidden) bridge.securityUnlockInput(true); };
  unlockPassword.addEventListener('focus', enableUnlockInput);
  unlockPassword.addEventListener('pointerdown', enableUnlockInput);
  const applyUnlockKey = key => {
    if (!security.locked || unlockPanel.hidden) return;
    const input = !recoveryForm.hidden ? recoveryAnswer : !resetForm.hidden ? (recoveryTarget === resetConfirm ? resetConfirm : resetPassword) : unlockPassword;
    input.focus({ preventScroll: true });
    const start = input.selectionStart, end = input.selectionEnd;
    if (/^\d$/.test(key) || (input === recoveryAnswer && key.length === 1)) {
      if (input.value.length - (end - start) < input.maxLength) input.setRangeText(key, start, end, 'end');
    } else if (key === 'Backspace') {
      input.setRangeText('', start === end ? Math.max(0, start - 1) : start, end, 'end');
    } else if (key === 'Enter') input.form.requestSubmit();
  };
  bridge.onUnlockKey(applyUnlockKey);
  document.getElementById('unlock-keypad').addEventListener('pointerdown', event => event.preventDefault());
  document.getElementById('unlock-keypad').addEventListener('click', event => {
    const key = event.target.closest('[data-unlock-key]')?.dataset.unlockKey;
    if (key) applyUnlockKey(key);
  });
  document.getElementById('unlock-system-keyboard').addEventListener('click', async () => {
    const result = await bridge.securityKeyboard();
    if (!result?.ok) showSecurityError(unlockError, '系统键盘暂不可用，请使用上方数字键盘');
  });
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
    security = { ...state, passwordConfigured: Boolean(state.passwordConfigured), locked: Boolean(state.locked) };
    if (!securityQuestion.options.length && state.recoveryQuestions) for (const question of state.recoveryQuestions) securityQuestion.add(new Option(question.label, question.id));
    document.documentElement.classList.toggle('locked', security.locked);
    lockScreen.hidden = !security.locked;
    document.getElementById('keyboard-protection-error').hidden = !security.locked || state.keyboardGuardActive !== false;
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
    if (editorMode) return;
    document.getElementById('simple-timers').dispatchEvent(new Event('dayan:checkpoint'));
    bridge.saveSync({ widget, style, displaySettings, windowLayers, autoStart: autoStartEnabled });
  });

  const syncWindow = state => {
    const presentationLayout = state.fullscreen ? state.presentationLayout : null;
    window.dayanPresentationLayout = presentationLayout;
    const content = presentationLayout?.content;
    const area = presentationLayout?.area;
    const primary = content && area ? { x: content.x - area.x, y: content.y - area.y, width: content.width, height: content.height } : { x: 0, y: 0, width: innerWidth, height: innerHeight };
    for (const [name, value] of Object.entries(primary)) document.documentElement.style.setProperty(`--unlock-${name}`, `${value}px`);
    document.getElementById('simple-timers').dispatchEvent(new CustomEvent('dayan:presentation-layout', { detail: presentationLayout }));
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
    if (action === 'background') {
      closeMenu();
      settingsModal.hidden = true;
      const section = document.querySelector('[data-variant]:not([hidden])');
      if (section?.querySelector('.background-picker')?.hidden) section.querySelector('.background-toggle')?.click();
    } else if (action === 'style-toggle') {
      settingsModal.hidden = true;
      menu.hidden = false; styleToggle.setAttribute('aria-expanded', 'true');
    } else if (action === 'settings-toggle') {
      closeMenu();
      if (settingsModal.hidden) settingsToggle.click();
    } else if (action === 'lock') lockButton.click();
  });

  styleToggle.addEventListener('click', () => { if (security.locked) return; menu.hidden = !menu.hidden; styleToggle.setAttribute('aria-expanded', String(!menu.hidden)); });
  lockButton.addEventListener('click', async () => {
    if (security.locked) { showUnlockPanel(); return; }
    if (!security.passwordConfigured || !security.recoveryConfigured) { openSecurityModal(); if (security.passwordConfigured) showSecurityError(securityError, '请验证当前密码并补设密保问题，再使用锁屏'); return; }
    await bridge.securityLock();
  });
  document.querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', () => {
    if (security.locked) return;
    selectStyle(Number(button.dataset.style)); closeMenu(); save().then(() => { if (editorMode) bridge.editorClose(); });
  }));
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#style-menu,#style-toggle')) closeMenu(); });

  securityClose.addEventListener('click', closeSecurityModal);
  settingsToggle.addEventListener('click', () => openSettings());
  settingsClose.addEventListener('click', closeSettings);
  settingsTabs.forEach(tab => tab.addEventListener('click', () => { selectSettingsTab(tab.dataset.settingsTab); if (tab.dataset.settingsTab === 'policy') refreshPolicy(); }));
  showAlmanac.addEventListener('change', () => { displaySettings = { ...displaySettings, showAlmanac: showAlmanac.checked }; syncDisplaySettings(); save(); });
  showClockDate.addEventListener('change', () => { displaySettings = { ...displaySettings, showClockDate: showClockDate.checked }; syncDisplaySettings(); save(); });
  modeVisibility.forEach(input => input.addEventListener('change', () => { displaySettings = { ...displaySettings, modes: { ...displaySettings.modes, [input.dataset.modeVisibility]: input.checked } }; syncDisplaySettings(); save(); }));
  windowLayerInputs.forEach(input => input.addEventListener('change', () => {
    windowLayers = { ...windowLayers, [input.dataset.windowLayer || 'displayScope']: input.value };
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
    button.querySelector('span').textContent = action === 'restore' ? '等待 Windows 恢复…' : '等待 Windows 授权…';
    clearSecurityError(policyError);
    try {
      const result = await (action === 'restore' ? bridge.securityPolicyRestore() : bridge.securityPolicyEnable());
      policyBusy = false;
      syncPolicy(result?.status || { supported: false, error: '操作未返回系统状态，请重新检测' });
      const notice = document.getElementById('policy-operation-notice');
      notice.textContent = result?.notice || '';
      notice.hidden = !result?.notice;
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
  securityForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearSecurityError(securityError);
    if (!/^\d{4,16}$/.test(newPassword.value)) { showSecurityError(securityError, '密码必须是 4 至 16 位数字'); return; }
    if (newPassword.value !== confirmPassword.value) { showSecurityError(securityError, '两次输入的密码不一致'); return; }
    if (securityAnswer.value !== securityAnswerConfirm.value) { showSecurityError(securityError, '两次输入的密保答案不一致'); return; }
    const result = await bridge.securitySetPassword({ current: currentPassword.value, next: newPassword.value, recovery: { question: securityQuestion.value, answer: securityAnswer.value } });
    if (!result?.ok) { showSecurityError(securityError, result?.error || '密码保存失败'); return; }
    security = { ...security, ...result };
    closeSecurityModal();
    syncSecurity(security);
  });
  unlockForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (unlockForm.dataset.busy === 'true') return;
    unlockForm.dataset.busy = 'true';
    clearSecurityError(unlockError);
    try {
      if (await bridge.securityVerify(unlockPassword.value)) {
        syncSecurity({ ...security, locked: false });
        return;
      }
      showSecurityError(unlockError, '密码不正确');
      unlockPassword.select();
    } finally {
      unlockForm.dataset.busy = 'false';
    }
  });
  document.getElementById('forgot-password').addEventListener('click', () => {
    clearSecurityError(unlockError);
    if (!security.recoveryConfigured) { showSecurityError(unlockError, '此设备尚未设置密保问题。请使用原密码解锁后，在设置中补设密保。'); return; }
    recoveryToken = ''; recoveryAnswer.value = '';
    document.getElementById('recovery-question').textContent = security.recoveryQuestion;
    unlockForm.hidden = true; recoveryForm.hidden = false; resetForm.hidden = true; recoveryKeyboard.hidden = false;
    recoveryKeyboard.dataset.numeric = 'false';
    bridge.securityUnlockInput(true); bridge.recoveryInput(true); recoveryAnswer.focus();
  });
  const returnToPassword = () => { showUnlockPanel(); };
  document.getElementById('recovery-back').addEventListener('click', returnToPassword);
  document.getElementById('recovery-reset-back').addEventListener('click', returnToPassword);
  recoveryForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (recoveryForm.dataset.busy === 'true') return;
    recoveryForm.dataset.busy = 'true';
    try {
      const result = await bridge.recoveryVerify(recoveryAnswer.value);
      recoveryAnswer.value = '';
      if (!result?.ok) { showSecurityError(unlockError, result?.error || '密保验证失败'); return; }
      clearSecurityError(unlockError); recoveryToken = result.token;
      recoveryForm.hidden = true; resetForm.hidden = false; recoveryKeyboard.dataset.numeric = 'true';
      resetPassword.value = ''; resetConfirm.value = ''; recoveryTarget = resetPassword;
      bridge.recoveryInput(false); resetPassword.focus();
    } finally { recoveryForm.dataset.busy = 'false'; }
  });
  for (const input of [recoveryAnswer, resetPassword, resetConfirm]) input.addEventListener('focus', () => { recoveryTarget = input; bridge.securityUnlockInput(true); bridge.recoveryInput(input === recoveryAnswer); });
  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (resetForm.dataset.busy === 'true') return;
    if (!/^\d{4,16}$/.test(resetPassword.value)) { showSecurityError(unlockError, '密码必须是 4 至 16 位数字'); return; }
    if (resetPassword.value !== resetConfirm.value) { showSecurityError(unlockError, '两次输入的密码不一致'); return; }
    resetForm.dataset.busy = 'true';
    try {
      const result = await bridge.recoveryReset({ token: recoveryToken, next: resetPassword.value });
      if (!result?.ok) { showSecurityError(unlockError, result?.error || '密码重置失败'); return; }
      const password = resetPassword.value;
      recoveryToken = ''; resetPassword.value = ''; resetConfirm.value = '';
      if (await bridge.securityVerify(password)) syncSecurity({ ...security, locked: false });
      else { showUnlockPanel(); showSecurityError(unlockError, '新密码已保存，请输入新密码解锁'); }
    } finally { resetForm.dataset.busy = 'false'; }
  });
  for (const key of '1234567890abcdefghijklmnopqrstuvwxyz-./') {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.recoveryKey = key; button.textContent = key;
    if (!/^\d$/.test(key)) button.className = 'recovery-letter';
    document.getElementById('recovery-letters').append(button);
  }
  recoveryKeyboard.addEventListener('pointerdown', event => event.preventDefault());
  recoveryKeyboard.addEventListener('click', event => {
    const key = event.target.closest('[data-recovery-key]')?.dataset.recoveryKey;
    if (key) applyUnlockKey(key);
  });
  document.getElementById('recovery-system-keyboard').addEventListener('click', async () => {
    const result = await bridge.securityKeyboard();
    if (!result?.ok) showSecurityError(unlockError, '系统键盘暂不可用，请使用屏幕键盘或实体键盘');
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

  bridge.onPreferences(saved => {
    widget = saved.widget; displaySettings = normalizeDisplaySettings(saved.displaySettings);
    windowLayers = { ...windowLayers, ...saved.windowLayers }; autoStartEnabled = saved.autoStart !== false;
    syncDisplaySettings(); syncWindowLayers(); syncAutoStart(); selectStyle(saved.style);
    if (window.openai) window.openai.widgetState = widget;
    dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: widget } } }));
  });
  if (editorMode) {
    const close = document.createElement('button'); close.id = 'editor-close'; close.type = 'button'; close.setAttribute('aria-label', '关闭菜单'); close.innerHTML = '<i data-lucide="x"></i>';
    close.addEventListener('click', () => bridge.editorClose()); document.body.append(close);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') bridge.editorClose(); });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-background]')) save().then(() => bridge.editorClose());
      if (event.target.closest('[data-background-close]')) bridge.editorClose();
    });
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
    syncWindow(editorMode ? { ...saved, fullscreen: false } : saved || { pinned: false, fullscreen: false, passwordConfigured: false, locked: false });
    refreshPolicy();
    if (saved?.showSettingsOnStartup && !editorMode) openSettings(false);
    const script = document.createElement('script');
    script.src = 'renderer/timer.js';
    script.onload = () => {
      document.querySelectorAll('[data-tooltip]').forEach(el => { el.title = el.dataset.tooltip; });
      document.documentElement.dataset.ready = 'true';
      (editorMode ? bridge.editorReady() : bridge.updateReady()).catch(error => console.error('Startup failed:', error));
    };
    document.head.append(script);
  }).catch(error => { console.error(error); });
})();
