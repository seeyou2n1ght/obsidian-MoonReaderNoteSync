# MoonReader Note Sync for Obsidian

This is an Obsidian plugin to synchronize, parse, and import your Moon+ Reader highlights and notes (`.an` binary files) into your local Vault via the WebDAV protocol.

## Core Features

* **Incremental Sync:** Uses PROPFIND requests to compare WebDAV metadata, only downloading and parsing files that have new notes, reducing network and memory overhead.
* **Secure Local Storage:** Encrypts WebDAV passwords using AES-256. The encryption key is securely stored in a local directory outside your Vault.
* **Offline Cache Fallback:** Automatically reads local historical cache data when the network is down or the server is unreachable, ensuring continuous data imports.
* **Structured Parsing Engine:** Integrates a decompression library to parse `.an` binary files, extracting book metadata, highlighted text, and personal annotations.
* **Visual Template Builder:** Provides an intuitive drag-and-drop UI editor to design your markdown templates using placeholder variables, with real-time preview support.

## Installation

You can install this plugin manually via the following steps:
1. Download the latest release `moonreader-note-sync.zip` from the GitHub Releases page, or manually download `main.js`, `manifest.json`, and `styles.css`.
2. Create a folder named `obsidian-moonreader-sync` under your local Vault's `.obsidian/plugins/` directory, and extract/move the files into it.
3. Open the Obsidian client, go to **Settings > Community Plugins**, disable "Safe Mode" if enabled, and toggle on this plugin to enable it.

*(Note: It will be available in the Obsidian Community Plugin store once the review is passed.)*

## Usage

1. Click the **sync icon** (Cloud Download) in the Obsidian left ribbon, or execute the **`Sync Notes (Smart)`** command in the command palette.
2. After the incremental sync is completed, a search panel will pop up listing your available books.
3. Search and select your target book. 
   - **Press `Enter`** to insert the formatted notes directly at your current cursor position in the active editor.
   - **Press `Shift + Enter`** to open the template editor for the selected book.
   - You can also click the dedicated action buttons when hovering over a book item to insert it into a specific note.

## Configuration Guide

### 1. Security & WebDAV
- Open the plugin settings panel.
- Specify a local path **outside** your Vault for the AES key (e.g., `C:/Users/name/.moonreader_key`) and click **Generate Key**.
- Enter your WebDAV server endpoint pointing to the Moon+ Reader backup directory (e.g. `https://your-server.com/dav/Books/.Moon+/Cache/`).
- Enter your WebDAV username and password (the password will be safely encrypted).

### 2. Template Configuration
- Navigate to the **Template Builder** section in settings.
- Drag and drop available fields from the left panel into the text area to design your note format.
- Preview the markdown rendering result in real-time at the bottom.

## Template Variables

| Placeholder | Description |
| :--- | :--- |
| `{bookName}` | Book name |
| `{chapter}` | Chapter name or index |
| `{highlightText}` | Highlighted text content |
| `{note}` | User's personal note/annotation |
| `{color}` | Hex color code of the highlight |
| `{timestamp}` | Original timestamp of the note |
| `{id}` | Unique identifier for the note |

---

## 🇨🇳 中文说明 (Chinese Description)

这是一个 Obsidian 插件，用于通过 WebDAV 协议同步、解析并将静读天下（Moon+ Reader）的阅读高亮与笔记（`.an` 二进制文件）导入到本地 Vault 库中。

### 核心特性
* **增量数据同步**：通过 PROPFIND 请求对比 WebDAV 元数据，仅下载并解析产生新笔记的书籍文件，降低网络和内存开销。
* **本地安全存储**：使用 AES-256 算法加密 WebDAV 账户密码，加密密钥存储在当前 Vault 路径之外的本地安全目录。
* **离线缓存降级**：在网络故障或服务器不可达时，自动读取本地历史缓存数据，维持数据导入的连续性。
* **结构化解析引擎**：集成解压库将二进制文件解压，定位提取书籍元数据、高亮文本及个人批注。
* **可视化模板配置**：提供直观的拖拽式 UI 编辑器，支持通过占位变量进行排版并在界面中实时预览渲染的文本。

### 安装指南
1. 下载最新版本的压缩包，或获取 `main.js`、`manifest.json` 与 `styles.css` 文件。
2. 在本地 Vault 的插件存放路径 (`.obsidian/plugins/`) 下创建 `obsidian-moonreader-sync` 目录，并将解压后的文件移入其中。
3. 打开 Obsidian 客户端，在第三方插件的系统设置面板中启用本插件。

### 使用方法
1. 点击 Obsidian 左侧边栏的同步操作图标，或在系统命令面板中执行 `Sync Notes` 关联指令。
2. 系统在执行完增量同步比对后，会自动弹出可供检索的书籍列表面板。
3. 搜索并选择目标书籍后按下回车键，对应的格式化笔记将直接插入至当前编辑器的光标位置。
4. 可选：按住 `Shift + 回车`，可以在插入前临时编辑该书籍的模板。

### 开源许可证
本项目基于 ISC 许可证开源。
