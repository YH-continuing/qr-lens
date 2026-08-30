/**
 * QR Lens - content.js
 * 在页面上下文中运行：
 *  1. 区域截屏蒙版（拉选取框 → 上报区域坐标给 Background 用 captureVisibleTab 解码）。
 *  2. Toast 浮层（URL 打开 / 文本复制 / 未检测 / 错误）。
 *  3. 文本复制（navigator.clipboard + document.execCommand 兜底）。
 *  4. 右键菜单辅助：按 srcUrl 查找图片包围盒（作为跨域解码失败时的截图裁剪坐标）。
 *
 * 无历史记录、无本地存储。脚本幂等：重复注入不会重复注册监听。
 */
(function () {
  if (window.__QRLENS_INJECTED__) return;
  window.__QRLENS_INJECTED__ = true;

  const NS = 'qrlens';

  // # 样式辅助：注入关键 CSS（content.css 已由 background insertCSS，此处仅兜底极小内联）
  const ensureStyle = () => {
    if (document.getElementById(NS + '-base-style')) return;
    const s = document.createElement('style');
    s.id = NS + '-base-style';
    s.textContent = [
      '.' + NS + '-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);cursor:crosshair;user-select:none;-webkit-user-select:none;}',
      '.' + NS + '-hint{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;font-size:13px;padding:8px 16px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;pointer-events:none;}',
      '.' + NS + '-sel{position:fixed;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,.15);box-shadow:0 0 0 9999px rgba(0,0,0,.001);pointer-events:none;}',
      '.' + NS + '-selcore{position:absolute;inset:0;}',
      '.' + NS + '-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);z-index:2147483647;max-width:min(560px,calc(100vw - 32px));background:rgba(20,20,22,.96);color:#fff;font-size:13px;line-height:1.5;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;padding:12px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;}',
      '.' + NS + '-toast.show{opacity:1;transform:translate(-50%,0);pointer-events:auto;}',
      '.' + NS + '-toast .t-label{display:block;font-weight:600;margin-bottom:2px;color:#93c5fd;}',
      '.' + NS + '-toast a{color:#60a5fa;text-decoration:underline;word-break:break-all;}',
      '.' + NS + '-toast .t-close{position:absolute;top:6px;right:8px;background:none;border:0;color:#9ca3af;cursor:pointer;font-size:16px;line-height:1;}',
      '.' + NS + '-toast .t-copy{margin-top:6px;font-size:11px;color:#34d399;}',
      'html.' + NS + '-active,html.' + NS + '-active *{cursor:crosshair !important;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  };

  // # 剪贴板复制
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // # Toast
  let toastEl = null;
  let toastTimer = null;
  function showToast(payload) {
    hideToast();
    const p = payload || {};
    const el = document.createElement('div');
    el.className = NS + '-toast';

    let label = '';
    let body = '';
    if (p.kind === 'url') {
      label = '已在新标签页打开链接';
      body = p.url || '';
    } else if (p.kind === 'text') {
      label = p.alreadyCopied ? '文本已复制到剪贴板' : '识别结果 · 已复制到剪贴板';
      body = p.text || '';
    } else if (p.kind === 'none') {
      label = '未检测到有效二维码';
      body = '请选择清晰的二维码区域后重试';
    } else if (p.kind === 'error') {
      label = '识别失败';
      body = p.message || '未知错误';
    } else {
      label = '提示';
    }

    if (label) {
      const lt = document.createElement('span');
      lt.className = 't-label';
      lt.textContent = label;
      el.appendChild(lt);
    }
    if (p.kind === 'url') {
      const a = document.createElement('a');
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = p.url;
      el.appendChild(a);
    } else if (body) {
      const bt = document.createElement('span');
      bt.textContent = body;
      el.appendChild(bt);
    }
    if (p.kind === 'text' && p.alreadyCopied !== true) {
      const copyTip = document.createElement('span');
      copyTip.className = 't-copy';
      copyTip.textContent = '已自动复制到剪贴板';
      el.appendChild(copyTip);
    }

    const close = document.createElement('button');
    close.className = 't-close';
    close.textContent = '✕';
    close.addEventListener('click', hideToast);
    el.appendChild(close);

    (document.body || document.documentElement).appendChild(el);
    // 强制回流后加 show
    requestAnimationFrame(() => el.classList.add('show'));
    toastEl = el;
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastEl) {
      toastEl.classList.remove('show');
      const old = toastEl;
      setTimeout(() => old && old.remove(), 240);
      toastEl = null;
    }
  }
  // # 区域截屏蒙版
  let overlay = null;
  let selBox = null;
  let dragStart = null;
  let active = false;

  function buildOverlay() {
    ensureStyle();
    // 移除旧蒙版
    removeOverlay();

    active = true;
    document.documentElement.classList.add(NS + '-active');

    overlay = document.createElement('div');
    overlay.className = NS + '-overlay';

    const hint = document.createElement('div');
    hint.className = NS + '-hint';
    hint.textContent = '按住左键拖拽框选二维码区域 · Esc 取消';
    overlay.appendChild(hint);

    selBox = document.createElement('div');
    selBox.className = NS + '-sel';
    selBox.style.display = 'none';
    overlay.appendChild(selBox);

    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', onDown, { capture: true });
    document.addEventListener('mousemove', onMove, true);
    overlay.addEventListener('mouseup', onUp, { capture: true });

    const keyHandler = (e) => {
      if (e.key === 'Escape') cancelSelection();
    };
    document.addEventListener('keydown', keyHandler, true);
    overlay._keyHandler = keyHandler;
  }

  function onDown(e) {
    e.preventDefault();
    dragStart = { x: e.clientX, y: e.clientY };
    selBox.style.display = 'block';
    updateSel(dragStart.x, dragStart.y, 0, 0);
  }
  function onMove(e) {
    if (!dragStart || !active) return;
    e.preventDefault();
    updateSel(dragStart.x, dragStart.y, e.clientX, e.clientY);
  }
  async function onUp(e) {
    if (!dragStart || !active) return;
    const x1 = Math.min(dragStart.x, e.clientX);
    const y1 = Math.min(dragStart.y, e.clientY);
    const w = Math.abs(e.clientX - dragStart.x);
    const h = Math.abs(e.clientY - dragStart.y);
    dragStart = null;

    // 视为误触：区域太小
    if (w < 8 || h < 8) {
      hideSel();
      return;
    }

    const rect = { x: Math.round(x1), y: Math.round(y1), width: Math.round(w), height: Math.round(h) };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    cancelSelection();

    try {
      await chrome.runtime.sendMessage({ action: 'CAPTURE_REGION', rect, viewport });
    } catch (err) {
      showToast({ kind: 'error', message: '无法截取屏幕区域' });
    }
  }
  function updateSel(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    selBox.style.left = left + 'px';
    selBox.style.top = top + 'px';
    selBox.style.width = w + 'px';
    selBox.style.height = h + 'px';
  }
  function hideSel() {
    if (selBox) selBox.style.display = 'none';
    dragStart = null;
  }

  function cancelSelection() {
    removeOverlay();
  }
  function removeOverlay() {
    if (!overlay) return;
    active = false;
    if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler, true);
    document.removeEventListener('mousemove', onMove, true);
    document.documentElement.classList.remove(NS + '-active');
    overlay.remove();
    overlay = null;
    selBox = null;
    dragStart = null;
  }

  // # 查找图片包围盒（右键菜单跨域解码兜底）
  function findImageRect(srcUrl) {
    if (!srcUrl) return null;
    const imgs = Array.from(document.images).filter(
      (img) => img.src === srcUrl || img.currentSrc === srcUrl
    );
    const el = imgs[0];
    if (!el || el.getBoundingClientRect().width === 0) return null;
    const r = el.getBoundingClientRect();
    return {
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  }

  // # 消息入口
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    switch (msg.action) {
      case 'SHOW_SELECTION': {
        buildOverlay();
        sendResponse({ ok: true });
        break;
      }
      case 'CANCEL_SELECTION': {
        cancelSelection();
        sendResponse({ ok: true });
        break;
      }
      case 'GET_IMAGE_RECT': {
        const found = findImageRect(msg.srcUrl);
        sendResponse(found || { rect: null });
        break;
      }
      case 'SHOW_RESULT': {
        (async () => {
          const p = msg.payload || {};
          if (p.kind === 'text' && !p.alreadyCopied) {
            await copyText(p.text || '');
          }
          showToast(p);
        })();
        sendResponse({ ok: true });
        break;
      }
      default:
        break;
    }
  });
})();
