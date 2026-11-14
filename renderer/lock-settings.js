(() => {
  if (new URLSearchParams(location.search).has('updater')) return;
  const bridge = window.dayan, byId = id => document.getElementById(id);
  const modal = byId('lock-settings-modal'), form = byId('lock-password-form');
  let security = {}, method = 'current', shortcut = '', shortcutDirty = false, busy = false;
  const notice = (id, text, error = false) => { byId(id).textContent = text; byId(id).dataset.error = String(error); };
  const sync = value => {
    security = { ...security, ...value };
    const ready = security.passwordConfigured && security.recoveryConfigured;
    byId('lock-now').disabled = !ready || security.locked;
    byId('lock-setup').hidden = ready;
    byId('lock-ready-status').textContent = ready ? '锁定当前桌面，输入密码后解锁。' : '请先设置数字密码与密保问题，再使用锁屏。';
    if (!shortcutDirty) { shortcut = security.lockShortcut || ''; byId('lock-shortcut').value = shortcut.replace('Control', 'Ctrl'); }
    if (security.shortcutError) notice('lock-shortcut-status', security.shortcutError, true);
    else if (!byId('lock-shortcut-status').textContent) notice('lock-shortcut-status', security.lockShortcut ? '快捷键已启用。' : '尚未设置快捷键，可按需设置。');
    const questions = byId('lock-recovery-question');
    if (!questions.options.length) for (const item of security.recoveryQuestions || []) questions.add(new Option(item.label, item.id));
    if (security.recoveryQuestionId && !byId('lock-recovery-answer').value) questions.value = security.recoveryQuestionId;
    if (security.locked) modal.hidden = true;
  };
  bridge.onWindowState(sync);
  bridge.load().then(sync);
  bridge.onDesktopCommand(action => {
    if (action !== 'lock-settings') { modal.hidden = true; return; }
    for (const panel of document.querySelectorAll('#settings-modal,#style-menu,.background-picker')) panel.hidden = true;
    modal.hidden = false;
    bridge.load().then(sync);
    byId('lock-now').focus();
    lucide.createIcons();
  });
  byId('lock-settings-close').addEventListener('click', () => { modal.hidden = true; bridge.editorClose(); });
  byId('lock-setup').addEventListener('click', () => byId('settings-password').click());
  byId('lock-now').addEventListener('click', async () => {
    if (!await bridge.securityLock()) notice('lock-ready-status', '未能锁屏，请检查密码、密保及键盘保护状态后重试。', true);
  });
  byId('lock-shortcut').addEventListener('keydown', event => {
    if (event.key === 'Tab') return;
    event.preventDefault(); event.stopPropagation();
    if (['Backspace', 'Delete'].includes(event.key)) { shortcut = ''; shortcutDirty = true; event.target.value = ''; return; }
    const key = event.key.toUpperCase();
    if (['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) return;
    if (event.metaKey || !(event.ctrlKey || event.altKey) || !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/.test(key)) {
      notice('lock-shortcut-status', '请使用 Ctrl 或 Alt 搭配字母、数字或功能键。', true); return;
    }
    shortcut = [...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
    shortcutDirty = true; event.target.value = shortcut.replace('Control', 'Ctrl');
    notice('lock-shortcut-status', '点击保存后生效。');
  });
  byId('lock-shortcut-clear').addEventListener('click', () => { shortcut = ''; shortcutDirty = true; byId('lock-shortcut').value = ''; notice('lock-shortcut-status', '保存后停用快捷键。'); });
  byId('lock-shortcut-form').addEventListener('submit', async event => {
    event.preventDefault();
    const result = await bridge.setLockShortcut(shortcut);
    if (result.ok) { shortcutDirty = false; sync({ lockShortcut: result.shortcut, shortcutError: '' }); }
    notice('lock-shortcut-status', result.ok ? (result.shortcut ? '快捷键已保存，下次启动继续生效。' : '快捷键已停用。') : result.error, !result.ok);
  });
  document.querySelectorAll('[data-password-method]').forEach(button => button.addEventListener('click', () => {
    method = button.dataset.passwordMethod;
    document.querySelectorAll('[data-password-method]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    byId('lock-current-label').hidden = method !== 'current';
    byId('lock-current-password').required = method === 'current';
    byId('lock-recovery-fields').hidden = method !== 'recovery';
    byId('lock-recovery-answer').required = method === 'recovery';
    notice('lock-password-status', method === 'recovery' && !security.recoveryConfigured ? '尚未保存密保，请先通过原密码补设密保。' : '');
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const next = byId('lock-new-password').value;
    if (!/^\d{4,16}$/.test(next)) { notice('lock-password-status', '密码必须是 4 至 16 位数字。', true); return; }
    if (next !== byId('lock-confirm-password').value) { notice('lock-password-status', '两次输入的密码不一致。', true); return; }
    if (!security.passwordConfigured || !security.recoveryConfigured) { notice('lock-password-status', '请先点击上方“设置密码与密保”完成设置。', true); return; }
    busy = true; form.querySelector('button[type=submit]').disabled = true;
    try {
      let result;
      if (method === 'current') result = await bridge.securitySetPassword({ current: byId('lock-current-password').value, next });
      else {
        result = await bridge.recoveryVerify({ question: byId('lock-recovery-question').value, answer: byId('lock-recovery-answer').value });
        if (result.ok) result = await bridge.recoveryReset({ token: result.token, next });
      }
      notice('lock-password-status', result.ok ? '密码已更新。' : result.error || '密码修改失败，请重试。', !result.ok);
      if (result.ok) form.querySelectorAll('input').forEach(input => { input.value = ''; });
    } finally { busy = false; form.querySelector('button[type=submit]').disabled = false; }
  });
})();
