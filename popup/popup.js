/**
 * QR Lens - popup.js
 * 粘贴 / 上传 / 拖拽本地图片识别。识别统一交给 Background（OffscreenCanvas + jsQR），
 * 本弹窗负责采集图片、展示结果、复制文本。无任何本地存储。
 */
(function () {
  const $ = (s) => document.querySelector(s);

  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');
  const btnPick = $('#btnPick');
  const btnScreen = $('#btnScreen');
  const result = $('#result');
  const resultStatus = $('#resultStatus');
  const resultBody = $('#resultBody');
  const btnCopy = $('#btnCopy');
  const btnOpen = $('#btnOpen');
  const btnClose = $('#btnClose');
  const dzSub = $('#dzSub');

  let lastResult = null;

  // ----- 采集图片 -----
  function isImage(file) {
    return file && (file.type === 'image/png' || file.type === 'image/jpeg' ||
      file.type === 'image/webp' || file.type === 'image/gif' || file.type === 'image/bmp' ||
      String(file.type).startsWith('image/'));
  }

  function readAndDecode(file) {
    if (!file) return;
    if (!isImage(file)) {
      showError('请选择图片文件（PNG/JPG/WebP/GIF）');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => sendDecode(reader.result); // dataURL
    reader.onerror = () => showError('读取图片失败');
    reader.readAsDataURL(file);
  }

  function processPasteItems(items) {
    if (!items) return false;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && isImage(file)) {
        readAndDecode(file);
        return true;
      }
    }
    return false;
  }

  async function sendDecode(dataUrl) {
    setBusy(true);
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'DECODE_IMAGE', imageUrl: dataUrl, source: 'popup' });
      if (!resp || !resp.ok) {
        showError((resp && resp.error) || '识别请求失败');
        return;
      }
      showResult(resp.result);
    } catch (e) {
      showError('与后台通信失败：' + (e && e.message));
    } finally {
      setBusy(false);
    }
  }

  // ----- 展示 -----
  function setBusy(busy) {
    result.hidden = false;
    if (busy) {
      resultStatus.textContent = '';
      resultStatus.className = 'badge';
      resultBody.innerHTML = '<span class="spin"></span> 正在识别二维码…';
      resultBody.classList.add('busy');
      btnCopy.hidden = true;
      btnOpen.hidden = true;
    }
  }

  function showResult(res) {
    res = res || { kind: 'none' };
    lastResult = res;
    btnCopy.hidden = true;
    btnOpen.hidden = true;
    resultBody.classList.remove('busy');
    resultBody.innerHTML = '';
    resultBody.querySelectorAll('a').forEach(() => {});

    if (res.kind === 'url') {
      resultStatus.textContent = '已在新标签页打开链接';
      resultStatus.className = 'badge ok';
      const a = document.createElement('a');
      a.href = res.url; a.target = '_blank'; a.rel = 'noreferrer noopener';
      a.textContent = res.url;
      resultBody.appendChild(a);
    } else if (res.kind === 'text') {
      resultStatus.textContent = '识别结果 · 已复制到剪贴板';
      resultStatus.className = 'badge ok';
      const span = document.createElement('span');
      span.textContent = res.text;
      resultBody.appendChild(span);
      copyText(res.text || '');
      btnCopy.hidden = false;
    } else if (res.kind === 'none') {
      resultStatus.textContent = '未检测到有效二维码';
      resultStatus.className = 'badge warn';
      resultBody.textContent = '请换一张更清晰的二维码或调整区域后重试';
    } else if (res.kind === 'error') {
      showError(res.message || '识别失败');
    } else {
      resultStatus.textContent = '提示';
      resultStatus.className = 'badge';
      resultBody.textContent = '';
    }
  }

  function showError(msg) {
    lastResult = null;
    result.hidden = false;
    resultStatus.textContent = '识别失败';
    resultStatus.className = 'badge err';
    resultBody.textContent = msg || '识别失败';
    btnCopy.hidden = true;
    btnOpen.hidden = true;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      resultStatus.textContent = '识别结果 · 已复制到剪贴板';
      resultStatus.className = 'badge ok';
    } catch (e) {
      resultStatus.textContent = '识别结果 · 复制失败（请手动复制）';
      resultStatus.className = 'badge warn';
    }
  }

  // ----- 交互绑定 -----
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readAndDecode(f);
  });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) readAndDecode(f);
    fileInput.value = '';
  });

  btnPick.addEventListener('click', () => fileInput.click());

  // 粘贴：监听 paste 与 Ctrl+V
  document.addEventListener('paste', (e) => {
    if (processPasteItems(e.clipboardData && e.clipboardData.items)) {
      e.preventDefault();
    }
  });


  btnCopy.addEventListener('click', () => {
    if (lastResult && lastResult.kind === 'text') copyText(lastResult.text || '');
  });
  btnOpen.addEventListener('click', () => {
    if (lastResult && lastResult.kind === 'url') {
      chrome.tabs.create({ url: lastResult.url, active: true });
    }
  });
  btnClose.addEventListener('click', () => {
    result.hidden = true;
  });

  // 区域截屏识别：关闭弹窗，让 Background 在活动页挂蒙版
  btnScreen.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'START_SELECTION' });
    } catch (e) { /* ignore */ }
    window.close();
  });

  // 打开弹窗即聚焦，便于立即粘贴
  window.addEventListener('DOMContentLoaded', () => dropZone.focus());
})();
