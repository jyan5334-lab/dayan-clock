(() => {
  const bridge = window.dayan;
  const standalone = new URLSearchParams(location.search).has('updater');
  if (standalone) document.documentElement.dataset.updateWindow = 'true';
  const modal = document.getElementById('update-modal');
  const confirm = document.getElementById('update-confirm');
  const tomorrow = document.getElementById('update-remind-tomorrow');
  const cancel = document.getElementById('update-cancel');
  const errorText = document.getElementById('update-error');
  const progressWrap = document.getElementById('update-progress-wrap');
  let progress = {}, busy = false, testOnly = false;
  const setBusy = value => {
    busy = value;
    confirm.disabled = value || testOnly;
    tomorrow.disabled = value;
    cancel.disabled = value;
  };
  const showError = error => {
    errorText.textContent = error?.message || '更新失败，请稍后重试';
    errorText.hidden = false;
    setBusy(false);
    confirm.querySelector('span').textContent = testOnly ? '测试更新不可安装' : '现在更新';
  };
  const show = info => {
    if (busy) return;
    testOnly = Boolean(info.testOnly);
    progress = { received: 0, total: info.size || 0, percent: 0 };
    document.getElementById('update-title').textContent = testOnly ? '本地更新测试 · 禁止安装' : '发现新版本';
    if (testOnly) document.title = 'DAYAN桌面 · 本地更新测试';
    document.getElementById('update-version').textContent = `当前版本 ${info.currentVersion || '—'} · 新版本 ${info.version}`;
    document.getElementById('update-notes').textContent = info.notes || '新版本已准备好，更新完成后程序会自动重新打开。';
    errorText.hidden = true;
    progressWrap.hidden = true;
    setBusy(false);
    confirm.querySelector('span').textContent = testOnly ? '测试更新不可安装' : '现在更新';
    modal.hidden = false;
    lucide.createIcons();
    (testOnly ? cancel : confirm).focus({ preventScroll:true });
    document.documentElement.dataset.updateReady = 'true';
  };
  bridge.onUpdateAvailable(show);
  bridge.onUpdateProgress(next => {
    progress = { ...progress, ...next };
    const total = Math.max(0, Number(progress.total) || 0);
    const received = Math.max(0, Math.min(Number(progress.received) || 0, total || Infinity));
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    const bar = document.getElementById('update-progress-bar');
    progressWrap.hidden = false;
    bar.style.width = `${percent}%`;
    bar.parentElement.setAttribute('aria-valuenow', String(percent));
    bar.parentElement.setAttribute('aria-valuetext', `${mb(received)} / ${total ? mb(total) : '大小获取中'}，${percent.toFixed(1)}%`);
    document.getElementById('update-downloaded').textContent = `已下载 ${mb(received)}`;
    document.getElementById('update-total').textContent = total ? `总大小 ${mb(total)}` : '总大小 获取中…';
    document.getElementById('update-percent').textContent = `${percent.toFixed(1)}%`;
    document.getElementById('update-progress-text').textContent = (next.status || '正在下载更新…').replace(/\s*·\s*[\d.]+\s*MB\/s\s*$/, '');
    document.getElementById('update-speed').textContent = percent >= 100 ? '' : `${mb(Math.max(0, Number(progress.bytesPerSecond) || 0))}/s`;
    if (busy) confirm.querySelector('span').textContent = percent >= 100 ? '正在启动安装程序…' : '正在下载更新…';
  });
  bridge.onUpdateError(showError);
  confirm.addEventListener('click', async () => {
    if (busy || testOnly) return;
    errorText.hidden = true;
    setBusy(true);
    confirm.querySelector('span').textContent = '正在准备更新…';
    try {
      const result = await bridge.updateInstall();
      if (!result?.ok) showError({ message:result?.error });
    } catch (error) { showError(error); }
  });
  const dismiss = async action => {
    if (busy) return;
    try {
      const result = await bridge.updateDismiss(action);
      if (result?.ok) { modal.hidden = true; bridge.updateClose(); }
      else showError({ message:result?.error || '无法关闭更新提示，请重试' });
    } catch (error) { showError(error); }
  };
  tomorrow.addEventListener('click', () => dismiss('today'));
  cancel.addEventListener('click', () => dismiss('cancel'));
  document.addEventListener('keydown', event => {
    if (modal.hidden || !standalone) return;
    if (event.key === 'Escape') { event.preventDefault(); dismiss('cancel'); }
    if (event.key === 'Tab') {
      const buttons = [confirm, tomorrow, cancel].filter(button => !button.disabled);
      const index = buttons.indexOf(document.activeElement);
      if (buttons.length) { event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus(); }
    }
  });
  if (standalone) bridge.updateReady().then(info => { if (info?.available) show(info); }).catch(showError);
  else addEventListener('online', () => { bridge.updateOnline().catch(error => console.error('Update retry failed:', error)); });
})();
