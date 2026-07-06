# MoonReader Note Sync for Obsidian

[![GitHub Release](https://img.shields.io/github/v/release/seeyou2n1ght/obsidian-MoonReaderNoteSync)](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases) [![GitHub Repo stars](https://img.shields.io/github/stars/seeyou2n1ght/obsidian-MoonReaderNoteSync)](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync)

An Obsidian plugin to synchronize and import your Moon+ Reader highlights and notes (`.an` files) into your local Vault via WebDAV.

## Features

- **Incremental Sync**: Uses PROPFIND requests to compare WebDAV metadata. Only downloads and parses files that have been modified.
- **Native Secure Storage**: Uses Obsidian's `SecretStorage` API. WebDAV passwords are kept in your OS-level keychain, not in plain text.
- **Offline Cache**: Automatically falls back to locally cached data when the network or server is unreachable.
- **Insert Modes**: Choose how notes are inserted—at the current cursor, appended to a specific file, or overwriting a specific file (preserving frontmatter).
- **Template Builder**: A drag-and-drop UI editor in the settings to customize how highlights and annotations are formatted.

## Installation

1. Download the latest `main.js`, `manifest.json`, and `styles.css` from the [GitHub Releases](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases) page.
2. Create a folder named `obsidian-moonreader-sync` under `.obsidian/plugins/` in your Vault, and place the downloaded files there.
3. Open Obsidian **Settings > Community Plugins**, disable "Safe Mode", and enable this plugin.

## Usage

1. Click the **book sync icon** in the left ribbon, or use the **`Sync Notes (Smart)`** command.
2. A search panel will appear showing your available books.
3. Select a book:
   - **Press `Enter`**: Triggers your default insert action (configurable in settings to ask, append, or overwrite).
   - **Press `Shift + Enter`**: Opens the template editor for the selected book before inserting.
   - **Hover Actions**: Use the mouse to specifically insert at the cursor, append to a file, or edit the template.

## Configuration

### 1. WebDAV Configuration
- Go to the plugin settings.
- Enter your WebDAV URL pointing to the Moon+ Reader cache folder (e.g., `https://your-server.com/dav/Books/.Moon+/Cache/`).
- Enter your username and password. Click **Test Connection** to verify.

### 2. Import Behavior
- Configure whether to show a floating preview of the notes on hover.
- Choose the **Default Insert Action** when pressing `Enter`:
  - **Ask Every Time**: Prompts you to insert at cursor, append, or overwrite.
  - **Always Append**: Directly opens a file selector to append notes.
  - **Always Overwrite**: Directly opens a file selector to overwrite notes (preserves existing YAML frontmatter).

### 3. Note Template Design
- Use the **Template Builder** in settings.
- Drag and drop variables to design the markdown layout. Click **Restore Default Template** if needed.

## Template Variables

| Variable | Description |
| :--- | :--- |
| `{bookName}` | Book name |
| `{chapter}` | Chapter name or index |
| `{highlightText}` | Highlighted text |
| `{note}` | Your personal annotation |
| `{color}` | Hex color code of the highlight |
| `{timestamp}` | Original timestamp of the note |
| `{id}` | Unique identifier for the note |

---

## 🇨🇳 中文说明

一个通过 WebDAV 协议同步、解析并将静读天下（Moon+ Reader）的高亮与笔记（`.an` 文件）导入本地 Obsidian 库的插件。

### 功能特性
- **增量同步**：通过 WebDAV 元数据对比，仅下载有更新的笔记文件。
- **原生安全存储**：调用 Obsidian 的 `SecretStorage` API，将 WebDAV 密码安全存入系统凭据管理器，不产生明文。
- **离线缓存**：无网络连接时，自动读取本地历史缓存数据。
- **灵活的插入模式**：支持插入至光标位置、追加到指定文件或覆盖指定文件（保留属性区）。
- **模板编辑器**：内置拖拽式 UI 编辑器，支持自定义笔记排版及实时预览。

### 安装
1. 从 [GitHub Releases](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases) 下载最新版的 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 Vault 目录下的 `.obsidian/plugins/` 中创建 `obsidian-moonreader-sync` 文件夹，并将下载的文件放入。
3. 在 Obsidian 设置的第三方插件页面中启用该插件。

### 使用
1. 点击左侧边栏的**书本同步图标**，或执行 `Sync Notes (Smart)` 命令。
2. 数据比对完成后，在弹出的搜索面板中选择目标书籍。
3. 操作方式：
   - **回车 (`Enter`)**：执行你在设置中配置的默认操作（每次询问 / 自动追加 / 自动覆盖）。
   - **`Shift + 回车`**：在插入前临时调整该书的模板。
   - **鼠标悬浮**：可直接点击右侧图标进行插入光标、插入文件或编辑模板。

### 配置说明
1. **WebDAV 配置**：填写静读天下同步目录的 URL（如 `.../.Moon+/Cache/`）及账密。点击 `Test Connection` 验证。
2. **导入行为**：设置默认插入动作。若设为“每次询问”，则回车后会弹出选择菜单；若设为“追加”或“覆盖”，则直接弹出文件选择器。
3. **模板设计**：在底部的编辑器中拖拽变量。如需重置，可点击恢复默认模板按钮。

### 开源许可证
ISC License
