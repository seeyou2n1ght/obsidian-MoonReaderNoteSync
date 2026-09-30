# MoonReader Note Sync

Import Moon+ Reader highlights and annotations from WebDAV backups into Obsidian. Browse books, preview annotations, and import them into an open note. Requires Obsidian 1.11.5+ on desktop.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases). Place them in `.obsidian/plugins/obsidian-moonreader-sync/` in your vault and enable MoonReader Note Sync in Community plugins.

## Usage

Set the WebDAV backup folder, username, and password in plugin settings. Use **Test connection**, then **Save connection**. Open the library from the ribbon, select a book, check the preview and destination, then import. [Full English instructions](README.en.md) follow the same workflow as the Chinese guide below.

[English](README.en.md) | 中文

将静读天下（Moon+ Reader）WebDAV 备份中的高亮和批注导入 Obsidian，支持搜索书籍、预览内容和自定义模板。界面随 Obsidian 显示中文或英文，已有缓存可离线使用。

需要 **Obsidian 1.11.5 或更新的桌面版本**，不支持移动端。当前版本为 **0.3.1**，改动见 [CHANGELOG](CHANGELOG.md)。

## 安装

从本仓库的 [GitHub Releases](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，将三个文件放入笔记库的 `.obsidian/plugins/obsidian-moonreader-sync/`，然后在 Obsidian 的社区插件设置中启用。

GitHub 自动生成的源码压缩包不包含构建后的插件文件。若已手动安装在其他目录，请保留 `data.json` 和缓存，在上述目录更新，避免重复安装。

## 连接备份

先在静读天下中将阅读批注备份到 WebDAV，确认备份目录中有 `.an` 文件。

1. 打开插件设置，填写 WebDAV 目录地址、账号、密码或应用密码。
2. 可点击“测试连接”，确认能够读取目录。测试不会保存设置。
3. 点击“保存连接”。验证成功后，密码存入 Obsidian 原生密钥库。
4. 打开侧栏的书库按钮，或执行“浏览和导入笔记”命令。没有缓存时会自动获取书籍；之后点击右上角刷新即可更新。

连接未完成时，刷新会提示原因。书库右上角的设置按钮打开连接表单，默认写入方式和模板在完整插件设置中调整。

### 从旧版升级

0.2.0 不再使用独立 key 文件，也不迁移旧密码。升级后需重新输入一次密码并保存。服务器地址、账号、模板和缓存仍可保留；旧 key 文件不会自动删除。

## 导入笔记

打开书库后，左侧搜索或选择书籍，右侧预览前 3 条批注；底部显示目标笔记及写入位置。点击“插入 N 条”会导入该书全部批注。

- 默认插入到打开面板时记录的光标位置，不替换选中的文本。焦点在其他面板时，使用仍打开的最近 Markdown 笔记。
- 没有打开的目标笔记时，先点击“选择笔记”，选中后再点击“追加 N 条”。
- “更多”菜单可切换文末追加、更换目标或替换正文。替换需要确认，并保留文件开头的 YAML 属性。
- “调整模板”显示可用字段，点击或拖动字段可插入模板。修改只用于本次导入，点击“保存为默认模板”才会保存。
- 同一次插件运行期间，向同一笔记重复导入同一本书时，需要点击“仍然导入”。写入开始前取消或关闭面板不会写入；写入已经开始时，关闭会等待结果。

搜索框中可用上下键选书，Enter 聚焦导入按钮，Ctrl/Cmd+Enter 执行插入或追加。快捷键不能跳过替换或重复导入确认。

**插件没有跨会话去重，也不做双向同步。** 再次导入可能产生重复内容和块 ID。导入不会删除或修改服务器上的备份。

### 书库显示设置

书籍列表上方显示数量和当前排序，例如“修改时间 ↓”。点击排序按钮，在 Obsidian 原生菜单中选择修改时间或书名，以及升序或降序；选择后立即更新并自动保存，下次打开沿用。显示数量在完整插件设置中调整。默认显示全部书籍，按备份修改时间从新到旧排列。

- 显示数量填写非负整数，`0` 表示全部。限制只影响列表，不影响刷新、下载或缓存；列表显示当前可见数量与匹配总数。
- 搜索先匹配全部缓存书籍，再排序和应用数量限制，因此超过显示数量的书籍仍可通过搜索找到。
- 日期使用 **WebDAV 备份文件的修改时间**，不是阅读时间、批注时间或下载时间。日期缺失或无效时排在最后，日期相同则按标题排列。
- 切换到书名时默认升序，不区分大小写，标题中的数字按数值排列，例如 Book 2 在 Book 10 前面；字母顺序遵循系统语言区域。切换到修改时间时默认降序，两种排序均可调整方向。
- 排序保留搜索和当前选书；当前书籍被数量限制隐藏时，选中第一本并同步预览。已配置连接时不再重复显示连接提示。底部显示目标文件名，悬停可查看完整路径，替换确认仍显示完整路径。

这些功能从 0.3.0 开始提供；没有改动缺失书籍的处理方式。

本次新增功能的检查在 Node 22 和 24 通过：50 项通过、私人样本项跳过，包含数量限制、升降序、选书保留、完整搜索、下载不受限制、保存失败和旧配置默认值检查。Windows Obsidian 1.13.7 中已验证排序菜单、切换排序、选书保留和精简布局；本轮未重新验证远端刷新或笔记写入。

## 模板字段

| 字段 | 内容 |
| --- | --- |
| `{bookName}` | 书名 |
| `{chapter}` | 章节索引 |
| `{highlightText}` | 高亮文本 |
| `{note}` | 个人批注 |
| `{color}` | RGB 十六进制颜色 |
| `{timestamp}` | UTC 时间文本 |
| `{id}` | 原始批注 ID |

模板支持 Markdown 和 HTML。字段值会进行 HTML 转义，预览和导入使用相同的替换方式。

## 数据与网络

插件需要访问你配置的 WebDAV 服务，使用该服务的账号读取备份目录和 `.an` 文件。没有遥测、广告或额外的联网服务。

密码由 Obsidian 原生密钥库在本地管理，插件配置只保存凭据名称。换设备时需重新填写密码。已有密码时可留空保留；更换账号或服务器时必须重新输入。更新密码不会覆盖旧凭据，未使用的旧条目可在 Obsidian 密钥库中管理。

书籍缓存保存在当前插件目录中，按服务器目录和账号分别存储，内容为明文。插件不要求访问笔记库外的文件。

缓存使用 Node.js 文件接口在插件目录内写入临时文件并原子替换；不会扫描或访问其他系统目录。选择导入目标时通过 Obsidian API 获取库内 Markdown 文件路径，不会读取所有笔记正文。插件不使用 localStorage 或 sessionStorage 保存数据。

设置页面仍使用兼容 Obsidian 1.11.5 的接口，尚未接入 1.13 的全局设置搜索。

## 常见问题

- **找不到书籍：** 确认地址直接指向包含 `.an` 文件的 WebDAV 目录。连接成功但没有笔记文件时，也需要检查静读天下的备份位置。
- **认证或权限失败：** 检查账号、应用密码和目录读取权限。密码不可用时，重新输入并保存。
- **某本书更新失败：** 原有缓存会保留并标记失败，可再次刷新。无法读取整个目录时，所有缓存都会保留。
- **服务器删掉了一本书：** 成功刷新后，该书从缓存列表移除，已导入的 Markdown 不受影响。
- **提示原笔记已变化：** 面板打开后笔记内容发生变化时，不会继续使用旧光标；可以改为文末追加。
- **备份格式不支持：** 当前解析器支持已验证的固定 17 行记录格式。损坏或不完整的记录会报错，避免用不完整内容覆盖缓存。

## 开发与验证

使用 Node.js 22：

```sh
npm ci
npm run check
npm run dev
```

`npm run check` 执行类型检查、自动测试、生产构建和发布文件检查。测试分为解析与缓存回归、HTTP 与界面集成两部分；界面测试使用 jsdom 和 Obsidian 接口替身，不等同于真实宿主验证。私人 `.an` 样本可放在已忽略的 `.testdata/`，没有样本时对应测试会跳过。

真实宿主的手动验证可运行 `node tests/fixtures/webdav-server.mjs`。该服务仅监听 `127.0.0.1:60923`，目录为 `/dav/`，合成账号为 `native-qa`，合成密码为 `synthetic-native-password`。数据会先经过实际解析器检查。使用独立测试笔记验证连接、保存、刷新和各种写入方式，结束后恢复原连接并停止服务。

0.2.0 发布前检查在 Node 22、24 和独立安装目录中均为 44 项通过、私人样本项跳过；构建文件哈希一致，标签检查和安装压缩包核对通过，依赖审计为 0 项已知漏洞。该版本的 GitHub 构建和发布工作流均已通过。

此前在 Windows Obsidian 1.13.7 的手动验证已覆盖连接、原生密码保存与读取、刷新、插入、追加、替换、重复导入确认、模板字段和长书名，使用的是合成账号和本地服务；此前还核对了私人样本的 44 条记录。真实 WebDAV 服务、最低版本 Obsidian 1.11.5、其他操作系统和应用重启后的凭据读取尚未验证。

开发依赖中的 `obsidian` 包固定依赖旧版 moment，本项目通过 `overrides` 使用修复版本 2.31.0。它仅供开发类型检查使用，不包含在发布文件中，也不替换 Obsidian 宿主的依赖。

## 发布

1. 同步更新 `manifest.json`、`package.json`、`package-lock.json` 和 `versions.json`，在 `CHANGELOG.md` 写明改动。
2. 运行 `npm ci`、`npm run check`、`npm run check:release -- 0.3.1`，检查版本、兼容性映射、许可和构建文件。
3. 提交源码与发布配置后，推送与版本号完全相同的标签，例如 `0.3.1`，不要加 `v` 前缀。
4. 发布工作流重新检查后，为 `main.js`、`manifest.json`、`styles.css` 生成构建来源证明，并仅上传这三个插件文件。项目许可保留在仓库中，第三方许可包含在 `main.js` 中。

首次申请社区目录收录时，按 [Obsidian 官方提交说明](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) 操作。社区目录是否收录，以及 GitHub Release 是否发布，需要分别确认。

## 许可证

项目使用 [ISC](LICENSE) 许可证，保留原有版权声明。发布文件包含 [pako](https://github.com/nodeca/pako) 的解压代码，使用 MIT 和 Zlib 许可证；完整声明见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)，也会包含在 `main.js` 中。
