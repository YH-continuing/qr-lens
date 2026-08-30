/**
 * QR Lens - background.js (MV3 Service Worker)
 *
 * 职责：
 *  1. 右键菜单「识别二维码」(图片)。
 *  2. 区域截屏识别（响应 popup/快捷键 START_SELECTION → content 出蒙版 → CAPTURE_REGION）。
 *  3. 统一解码入口：跨域图片走 Background fetch → OffscreenCanvas → jsQR；
 *     跨域受限时回退 chrome.tabs.captureVisibleTab 截图裁剪。
 *  4. 结果分发：URL → chrome.tabs.create 直接新开标签页；文本 → 通知 content 复制+Toast；
 *     未识别 → Toast 提示。无任何历史记录 / 持久化存储。
 *
 * 最小权限：activeTab + contextMenus + scripting (+ <all_urls> 用于跨域 fetch 与截图)。
 */

// ---------- 离线解码库加载 ----------
// jsQR.js 需放在扩展根目录。通过 try/catch 包裹 importScripts，
// 防止库缺失时整颗 Service Worker 注册失败（扩展仍可启动并给出友好提示）。
try {
  // eslint-disable-next-line no-undef
  importScripts('jsQR.js');
} catch (e) {
  console.warn('[QR Lens] jsQR.js 未加载，二维码解码暂不可用。请运行 tools/fetch-jsqr.ps1 下载后重新加载扩展。', e);
}
// eslint-disable-next-line no-undef
const jsqrAvailable = typeof jsQR === 'function';

const MENU_IMAGE_ID = 'qr-lens-scan-image';

// 记住已注入过 content 的 tab，避免重复 insertCSS（SW 重启后重新注入即可，幂等）。
const injectedTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: MENU_IMAGE_ID,
      title: '识别二维码',
      contexts: ['image'],
      documentUrlPatterns: ['<all_urls>']
    },
    () => void chrome.runtime.lastError
  );
});

// ---------- 工具函数 ----------

function isHttpUrl(t) {
  return /^https?:\/\//i.test(String(t || '').trim());
}

function buildImageData(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

async function loadBitmap(source) {
  const res = await fetch(source, { credentials: 'include' });
  if (!res.ok) throw new Error('图片加载失败 HTTP ' + res.status);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  return bitmap;
}

/** 用 jsQR 解码 ImageData（OffscreenCanvas.getImageData） */
function decodeImageData(imageData) {
  if (!jsqrAvailable) {
    return { kind: 'error', message: '解码库未加载：请将 jsQR.js 放入扩展根目录（python tools/fetch-jsqr.ps1）' };
  }
  try {
    // eslint-disable-next-line no-undef
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    });
    if (!code || !code.data) return { kind: 'none' };
    const text = code.data;
    const url = isHttpUrl(text) ? text : null;
    return url ? { kind: 'url', url, text } : { kind: 'text', text };
  } catch (e) {
    return { kind: 'error', message: '二维码解码异常：' + (e && e.message) };
  }
}

/** captureVisibleTab 裁剪指定区域并解码 */
async function captureAndDecodeRegion(windowId, rect, viewport) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await loadBitmap(dataUrl);
  try {
    const scaleX = bitmap.width / viewport.width;
    const scaleY = bitmap.height / viewport.height;
    const sx = Math.max(0, Math.round(rect.x * scaleX));
    const sy = Math.max(0, Math.round(rect.y * scaleY));
    const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(rect.width * scaleX)));
    const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(rect.height * scaleY)));

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const imageData = ctx.getImageData(0, 0, sw, sh);
    return decodeImageData(imageData);
  } finally {
    bitmap.close && bitmap.close();
  }
}

/** 优先 fetch 解码图片 URL，失败时回退截图裁剪（fallback 坐标来自 content 的 img 包围盒） */
async function decodeByUrl(imageUrl, windowId, fallback) {
  try {
    const bitmap = await loadBitmap(imageUrl);
    const data = buildImageData(bitmap);
    bitmap.close && bitmap.close();
    return decodeImageData(data);
  } catch (err) {
    if (fallback && fallback.rect && fallback.viewport && windowId != null) {
      return captureAndDecodeRegion(windowId, fallback.rect, fallback.viewport);
    }
    return { kind: 'error', message: '图片加载失败：' + (err && err.message) };
  }
}

// ---------- content 脚本注入 ----------

async function ensureContentScript(tabId) {
  try {
    if (!injectedTabs.has(tabId)) {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      injectedTabs.add(tabId);
    }
  } catch (e) { /* 某些页面（chrome:// 等）不允许注入，忽略 */ }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) { /* 同上 */ }
}

async function sendToast(tabId, payload) {
  if (tabId == null) return;
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, { action: 'SHOW_RESULT', payload });
  } catch (e) { /* 页面不允许脚本注入或已关闭，静默 */ }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

async function getImageRect(tabId, srcUrl) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: 'GET_IMAGE_RECT', srcUrl });
    if (resp && resp.rect) return resp;
  } catch (e) { /* content 未就绪或页面受限 */ }
  return null;
}

// ---------- 结果分发 ----------

async function dispatchResult(result, sender, origin) {
  let tabId = sender.tab ? sender.tab.id : null;

  if (result.kind === 'url') {
    // 直接新标签页打开，无需确认
    await chrome.tabs.create({ url: result.url, active: true });
    if (tabId == null) {
      const active = await getActiveTab();
      tabId = active ? active.id : null;
    }
    await sendToast(tabId, { kind: 'url', url: result.url });
  } else if (result.kind === 'text') {
    if (tabId == null) {
      const active = await getActiveTab();
      tabId = active ? active.id : null;
    }
    // 非 popup 触发时由 content 负责复制（document.execCommand 兜底）；popup 触发时 popup 已复制
    await sendToast(tabId, { kind: 'text', text: result.text, alreadyCopied: origin === 'popup' });
  } else if (result.kind === 'none') {
    if (tabId == null) {
      const active = await getActiveTab();
      tabId = active ? active.id : null;
    }
    await sendToast(tabId, { kind: 'none' });
  } else if (result.kind === 'error') {
    if (tabId == null) {
      const active = await getActiveTab();
      tabId = active ? active.id : null;
    }
    await sendToast(tabId, { kind: 'error', message: result.message });
  }
  return result;
}

// ---------- 消息调度 ----------

async function handleMessage(msg, sender) {
  switch (msg && msg.action) {
    // content / popup 上传或粘贴的图片（URL 或 dataURL）
    case 'DECODE_IMAGE': {
      if (!msg.imageUrl) return { ok: false, error: '缺少图片数据' };
      const origin = msg.source === 'popup' ? 'popup' : 'content';
      const windowId = sender.tab ? sender.tab.windowId : null;
      const result = await decodeByUrl(msg.imageUrl, windowId, msg.fallback || null);
      await dispatchResult(result, sender, origin);
      return { ok: true, result };
    }

    // content 蒙版拉框完成后提交区域坐标（viewport CSS 像素）
    case 'CAPTURE_REGION': {
      const tab = sender.tab;
      if (!tab || !msg.rect || !msg.viewport) return { ok: false, error: '缺少区域数据' };
      const result = await captureAndDecodeRegion(tab.windowId, msg.rect, msg.viewport);
      await dispatchResult(result, sender, 'content');
      return { ok: true, result };
    }

    // popup「区域截屏识别」按钮 / 快捷键 → 在活动页蒙版
    case 'START_SELECTION': {
      const tab = await getActiveTab();
      if (!tab || tab.id == null) return { ok: false, error: '无活动标签页' };
      // 普通页面注入 content 蒙版；chrome:// 等受限页面会静默失败
      await ensureContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { action: 'SHOW_SELECTION' });
      return { ok: true, tabId: tab.id };
    }

    default:
      return { ok: false, error: 'unknown action' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: (e && e.message) || '未知错误' }));
  return true; // 保持异步响应通道
});

// ---------- 右键菜单：图片识别 ----------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_IMAGE_ID || !info.srcUrl || !tab) return;
  try {
    await ensureContentScript(tab.id);
    const fallback = await getImageRect(tab.id, info.srcUrl); // { rect, viewport } | null
    const result = await decodeByUrl(info.srcUrl, tab.windowId, fallback);
    await dispatchResult(result, { tab }, 'content');
  } catch (e) {
    await sendToast(tab.id, { kind: 'error', message: '识别失败：' + (e && e.message) });
  }
});

// ---------- 快捷键：区域截屏识别 ----------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'trigger-scan') return;
  try {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) return;
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { action: 'SHOW_SELECTION' });
  } catch (e) { /* 静默 */ }
});
