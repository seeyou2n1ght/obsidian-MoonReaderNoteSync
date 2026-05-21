# MoonReader Note Sync for Obsidian

一个强大且无缝的 Obsidian 插件，旨在通过 WebDAV 直接同步、解析并将**静读天下 (Moon+ Reader)** 的阅读高亮与笔记 (`.an` 文件) 导入到您的 Vault 中。

![GitHub release (latest by date)](https://img.shields.io/github/v/release/seeyo/ob-moonreadernotesync)
![GitHub workflow status](https://img.shields.io/github/actions/workflow/status/seeyo/ob-moonreadernotesync/build.yml?branch=master)

## ✨ 核心特性

- **🚀 智能增量同步 (Smart Incremental Sync)**: 通过极速的 `PROPFIND` 请求，智能比对 WebDAV 文件的元数据（`lastModified` 和 `contentLength`）。插件只会下载并解析那些产生过新笔记的书籍，将带宽和内存消耗降至最低。
- **🛡️ 极致的安全架构**: 您的 WebDAV 密码**永远不会**以明文形式保存在 Obsidian Vault 中。插件采用**本地 AES 加密密钥**（存储在您的 Vault 之外的安全目录）对密码进行加密。即便您的 Vault 被第三方云同步（如 iCloud 或 Obsidian Sync）泄露，您的 WebDAV 凭据依然绝对安全。
- **🌐 离线优先与缓存回退**: 网络中断？服务器报 403 错误？没问题。插件在本地维护了一套完善的缓存机制，在网络不可用时将透明降级至离线模式，确保您随时都能无缝访问并导入此前同步过的阅读笔记。
- **🎨 拖拽式模板构建器 (Drag-and-Drop Template Builder)**: 内置一个强大的可视化模板配置 UI。只需将 `{bookName}`、`{highlightText}` 或 `{note}` 等变量字段拖入编辑器，底部的 **Live Preview (实时预览)** 区即可瞬间渲染出 Markdown 的最终显示效果。
- **🔍 深度还原的 .an 文件解析引擎**: 插件内置了强大的静读天下专属解析逻辑，详细机制如下：
  1. **Zlib 解压**: 自动将 `.an` 二进制文件通过 `pako` 库进行 Zlib 解压缩为纯文本。
  2. **精准定位定界符**: 自动扫描文件头部（最多前 15 行），寻找 `#` 作为元数据与正文的定界符，完美跳过 `indent:true` 等隐藏配置。
  3. **17 行区块提取**: 定位后，按每 17 行为一个记录块（Block）进行遍历。精准提取 `block[0]` (ID)、`block[1]` (书名)、`block[4]` (章节)、`block[8]` (颜色代码)、`block[9]` (时间戳)、`block[11]` (批注)、`block[12]` (高亮文本) 等关键数据，并具备防崩溃错位机制。

## 🛠️ 安装指南

### 手动安装 (Manual Installation)
1. 前往 [Releases](https://github.com/seeyo/ob-moonreadernotesync/releases) 页面。
2. 下载最新的 `moonreader-note-sync.zip` 压缩包，或者单独下载 `main.js`, `manifest.json`, 以及 `styles.css` 文件。
3. 将下载的文件解压并放入您 Vault 的插件目录中：`[Vault]/.obsidian/plugins/moonreader-note-sync/`。
4. 重启 Obsidian 并在 设置 > 第三方插件 (Community Plugins) 中启用该插件。

## ⚙️ 配置说明 (Setup Guide)

为了保证极致的安全性，插件需要进行两步配置：

### 1. 配置本地 AES 加密 (仅需一次)
因为 Obsidian Vault 经常通过第三方服务进行云同步，将密码明文存放在 `data.json` 中存在巨大的安全隐患。
1. 进入插件设置页面。
2. 在 **Security** 区域，输入一个**位于您的 Vault 之外**的安全路径（例如 `C:/Users/YourName/.moonkey` 或 `~/.moonkey`）。
3. 点击 **Generate Key**。这将在您的本地设备上生成一把与当前设备强绑定的安全 AES-256 密钥。

### 2. 配置 WebDAV
1. 填入您的 WebDAV URL，请务必指向静读天下的 Cache 备份目录。
   *例如: `https://your-server.com/dav/Books/.Moon+/Cache/`*
2. 输入您的 WebDAV Username 和 Password。
3. 密码将在输入瞬间被本地 AES 密钥加密并安全保存。

### 3. 自定义笔记模板
1. 向下滚动至 **Template Builder** 区域。
2. 将左侧提供的可用字段（如 `{bookName}`, `{chapter}`, `{highlightText}` 等）拖拽进右侧的文本编辑区。
3. 在下方的 Live Preview 区实时预览您的 Markdown 渲染效果。

## 🚀 如何使用

1. 点击左侧边栏的 **云下载 (Cloud Download) 图标**，或者唤出命令面板 (Command Palette) 执行 `Sync Notes (Smart)` 命令。
2. 插件将静默连接至 WebDAV 进行极速增量比对，随后弹出一个极简的书籍搜索面板。
3. 搜索并选中您想要导入的书籍。
4. 敲击 **Enter** 键，笔记将直接插入到您当前文档的光标位置。您也可以使用 **Shift + Enter**，在导入前临时唤出模板面板，针对这本书进行一次性的排版微调！

## 🧩 模板可用变量 (Variables)

| 变量 (Variable) | 描述 (Description) |
|---|---|
| `{bookName}` | 书籍名称 |
| `{chapter}` | 章节名称或索引数字 |
| `{highlightText}` | 实际的高亮文本划线内容 |
| `{note}` | 您的个人批注与想法 |
| `{color}` | 高亮颜色，采用 Hex 格式 (`#RRGGBB`) |
| `{timestamp}` | 生成该条高亮的精确时间戳 |
| `{id}` | 注解的唯一 ID |

## 🤝 贡献与反馈 (Contributing)

欢迎提交 Issue、功能请求或 Pull Requests！

## 📄 许可证 (License)

本项目基于 ISC 许可证开源。
