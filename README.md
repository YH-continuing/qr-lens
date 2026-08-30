# QR Lens — 轻量二维码识别与跳转（Chrome MV3）

一个基于 **Manifest V3**、纯前端离线运行的浏览器插件，支持**三种场景**识别二维码：

- **右键图片识别**：在任意网页图片上右键 →「识别二维码」。
- **区域截屏识别**：点插件图标（弹窗内「区域截屏识别」）或快捷键 `Alt+Shift+Q`，在网页上拉框选取区域。
- **Popup 粘贴 / 上传**：打开弹窗，拖入本地图片或 `Ctrl+V` 粘贴图。

**识别成功后的行为**：

| 结果 | 行为 |
| --- | --- |
| 合法 `http://` / `https://` URL | **直接**在新标签页打开，并在原页面弹出 Toast「已在新标签页打开链接」（无需确认） |
| 纯文本 / 非链接 | 自动复制到剪贴板，Toast 展示解析文本 +「已复制到剪贴板」 |
| 未识别到二维码 | Toast「未检测到有效二维码」 |

## 目录结构

```
qr-lens/
├── manifest.json          # MV3 清单 (最小权限)
├── background.js          # Service Worker：右键菜单 / 解码 / tabs.create / 消息调度
├── content.js             # 页面脚本：区域截屏蒙版 / Toast / 剪贴板 / 图片包围盒
├── content.css            # 蒙版与 Toast 样式（注入页面）
├── jsQR.js                # 离线解码库（需通过下方脚本引入，见「离线引入」）
├── icons/                 # 插件图标 16/48/128
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── fetch-jsqr.ps1         # 一键下载/离线打包 jsQR（Windows）
├── fetch-jsqr.sh          # 一键下载/离线打包 jsQR（macOS/Linux）
└── README.md
```

---

## 1. 离线解码库引入（一次性，真正离线）

插件解码依赖 `jsQR`（Apache-2.0），已随项目打包在 **`qr-lens/jsQR.js`**（约 250KB），因此插件**开箱即用、完全离线**，任何页面都不需要网络。若该文件在某台机器上缺失或你想刷新版本，可用下方脚本一键引入：

### 方式 A：运行脚本（推荐）

```powershell
# Windows
cd qr-lens
powershell -ExecutionPolicy Bypass -File .\fetch-jsqr.ps1
```

```bash
# macOS / Linux
cd qr-lens
chmod +x fetch-jsqr.sh && ./fetch-jsqr.sh
```

脚本会从 jsDelivr / unpkg / GitHub 等多源尝试把 `jsQR.js` 保存到扩展根目录。

### 方式 B：手动放入

1. 有网环境浏览器打开
   `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js`
2. 「另存为」到 `qr-lens/jsQR.js`。

### 方式 C：npm 引入

```bash
npm i jsqr
cp node_modules/jsqr/dist/jsQR.js  qr-lens/jsQR.js
```

> **校验**：确认 `qr-lens/jsQR.js` 存在且大于 10KB。
>
> 若未引入，插件仍能正常加载并使用区域截屏/粘贴；后台会在 Toast 提示
> 「解码库未加载：请将 jsQR.js 放入扩展根目录」。引入后点击 `chrome://extensions` 的
> **重新加载** 即可。

---

## 2. 加载到 Chrome（开箱即用）

1. 打开 `chrome://extensions`，右上角开启 **开发者模式**。
2. 点击 **加载已解压的扩展程序**，选择本 `qr-lens` 目录。
3. 右键图片 / 打开弹窗 / 按 `Alt+Shift+Q` 即可使用。

> 首次加载后，`chrome.contextMenus` 由 `onInstalled` 钩子创建，若右键菜单未出现，
> 重新加载一次扩展或重启浏览器即可。

---

## 3. 技术实现要点

### 权限控制（最小化）
```json
"permissions":     ["activeTab", "contextMenus", "scripting"],
"host_permissions": ["<all_urls>"]
```
- **无 `storage` 权限**、无历史记录、无任何持久化存储；每次识别均为纯内存、一次性。
- `host_permissions: <all_urls>` 用于实现需求中的跨域处理（见下）及
  `tabs.captureVisibleTab` 截图。若希望更严格，可移除该项，此时跨域图片将通过
  截图兜底识别（见「跨域处理」），本地图片与同域图片不受影响。

### 跨域图片（CORS）处理
1. **优先**：Background（Service Worker）用 `fetch(imgUrl, {credentials:'include'})`
   拉取原图 → `createImageBitmap` → 绘制到 **`OffscreenCanvas`** → `getImageData` → `jsQR` 解码。
   因 `<all_urls>` 主机权限，扩展上下文中的跨域请求可绕过页面 CORS。
2. **兜底**：若 fetch 失败（301/403、防盗链、需登录 Cookie 等），回退用
   `chrome.tabs.captureVisibleTab` 截取当前可视区，并按 content 传来的图片包围盒
   **裁剪**该区域后再解码。

### URL 与文本响应规则
- `isHttpUrl()` 仅匹配以 `http://` / `https://` 开头的字符串。
- URL：`chrome.tabs.create({url, active:true})` 直接新标签页打开 + Toast。
- 文本：content 脚本 `navigator.clipboard.writeText`，失败回退 `document.execCommand('copy')`，再 Toast。
- 未识别：Toast「未检测到有效二维码」。

### 区域截屏流程
`popup/快捷键 → background 注入 content → content 拉起蒙版 → 用户拉框 → content 上报
viewport 坐标 → background captureVisibleTab 裁剪 → 解码 → 分发结果`。

---

## 4. 加载 & 调试步骤

### 排查 Service Worker
1. `chrome://extensions` → 找到 **QR Lens** → 点 **Service Worker** 链接打开 DevTools。
2. 在 **Console** 查看日志：
   - `[QR Lens] jsQR.js 未加载 …` → 说明未引入解码库，见上文「离线引入」。
3. 打开后台的 **Network** 面板可查看 `fetch` 图片请求是否成功。

### 排查页面脚本
1. 在任何网页按 `F12` 打开 DevTools。
2. 若在脚本内联注入了样式与监听，消息由 `chrome.runtime.onMessage` 处理。
3. 右键图片 → 若未见 Toast，看后台 Console 是否有 `contextMenus` 报错或
   `scripting.executeScript` 被页面禁止（`chrome://` 等页面无法注入，属正常）。

### 常见问题
| 现象 | 原因 / 处理 |
| --- | --- |
| 右键菜单无「识别二维码」 | 扩展刚安装，`onInstalled` 尚未注册；重新加载扩展 |
| 区域截屏识别无反应 | `chrome://`、Web Store 等受限页面无法注入 content；换普通网页 |
| 提示「解码库未加载」 | 未引入 `jsQR.js`；执行 `fetch-jsqr.ps1` 后重新加载扩展 |
| 跨域图片识别失败 | 已自动回退截图裁剪；仍失败则图片被强防盗链，可改用区域截屏 |
| 快捷键无效 | 到 `chrome://extensions/shortcuts` 查看是否被占用，可改键 |

---

## 5. 隐私与数据

- 无 `storage`、无历史记录、无用户数据上报；图片仅在本机内存中解码后即释放。
- 唯一网络动作是「跨域图片 fetch 转 Blob」，由 `<all_urls>` 权限支撑，且仅为解码所需，
  不含任何埋点。

## 许可

- 插件代码：MIT（本项目）。
- 依赖 `jsQR`：Apache-2.0，见 https://github.com/cozmo/jsQR 。
