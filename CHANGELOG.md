# 更新记录 / Changelog

## 0.6.0

### Highlights / 主要更新

- **Preview & Library UI / 预览与书库体验**
  - Replaced the floating sticky header with a fixed reading-pane toolbar and independent scrollable preview body, and stabilized the modal height so expanding from the first 3 notes to all notes no longer jumps. / 预览区改为固定顶栏与独立滚动正文区，固定弹窗高度，彻底消除展开全部时的跳动与标题栏漂浮感。
  - Added an inline preview status indicator, a bottom "Show all notes" prompt below the first 3 notes, unified text buttons in the top bar, toned down secondary accent colors, and separated the template editor into a card with `Hide template` toggle state, modified indicator, local status feedback, `Reset to default`, and a `{#note}` quick-insert button. / 优化顶栏与模板区层次，统一文字按钮样式，底部新增顺手展开提示、模板未保存标识、恢复默认与 `{#note}` 快捷按钮。
  - Settings page: WebDAV URL now spans full width, removed the stray top border above Username in Obsidian 1.15, and removed the duplicated prefix in the collapsed connection summary. / 修复设置页长 URL 截断、`Username` 上方多余分割线及折叠标题重复前缀。
- **Templates, Rendering & Sorting / 模板渲染与排序**
  - Automatically separate adjacent notes with a blank line (`\n\n`) when a rendered entry lacks a trailing newline, fixing Markdown blockquotes (`>`) merging into the previous note. / 多条笔记拼接时缺尾换行自动补 `\n\n`，修复引用块与上一段批注粘连导致渲染失败。
  - Added `{#field}...{/field}` conditional blocks (adopted in the default template to omit empty note lines) and Moon+ Reader `<BR>` line-break decoding (preserving `>` prefixes inside blockquotes and `<br>` inside inline HTML tags). / 支持 `{#field}...{/field}` 条件块与静读天下 `<BR>` 换行还原（自动适配引用续行与内联 HTML）。
  - Preserved `offset` from `.an` records so chapter sorting orders notes accurately by reading position within each chapter (with graceful fallback for legacy cache). / 保留 `.an` 中的 `offset`，按章节排序时同章内按真实阅读位置排列。
- **Import Flow, Sync & Reliability / 导入、同步与稳定性**
  - Added direct new-note creation from the target note picker (defaulting to the selected book title, with filename sanitization and Windows reserved-name protection). / 目标笔记选择器支持直接新建笔记（默认建议书名，内置非法字符与 Windows 保留名保护）。
  - Improved keyboard & popover handling (`Esc` and outside click close the server details popover; `Ctrl/Cmd+Enter` is ignored while typing in the template editor; `Switch book` is disabled during writes) and synchronized default template saves from Settings to an open library. / 完善 `Esc`/点击外部关闭详情浮层、模板编辑区防误触导入、写入期间禁用切书按钮及设置页保存模板实时同步。
  - Upgraded WebDAV annotation downloads to bounded concurrency (4), propagated `AbortController` on unload/connection change, fixed percent-encoded Chinese book names in failure reports, suppressed late rejected `requestUrl` promises, and included HTTP status codes and parse line diagnostics. / 同步升级为有限并发下载并传导取消信号，修复失败列表中文书名解码与迟到 Promise 拒绝，补充 HTTP 状态码和解析行号诊断。
- **Engineering & Release / 工程与发版**
  - Extracted `ConnectionSection`, modernized `tsconfig`/`esbuild` to `ES2022`, added `eslint` + `eslint-plugin-obsidianmd`, split integration tests by domain, added real Markdown (`marked`) and headless Chrome CSS layout smoke tests, and extracted single-version release notes via `scripts/release-notes.mjs`. / 拆分连接表单模块，升级至 `ES2022`，接入 `eslint-plugin-obsidianmd`、真实 Markdown 与无头浏览器布局冒烟测试，发布流程仅提取当版更新说明。

## 0.5.1

- 修复排序偏好回调的返回类型告警，以及读取缓存检查时间时的类型安全告警。

## 0.5.0

- 支持默认书籍排序、笔记排序、前三条及完整预览；写入使用当前预览对应的完整顺序。
- 首次打开书库先展示缓存并后台检查。连接栏显示服务器、检查进度、更新、移除和逐本失败原因。
- 导入底栏可直接选择目标路径和写入方式；窄窗支持折叠选书，替换和重复导入使用独立确认栏。
- 已配置连接在设置中默认折叠，书库搜索和选中状态更清晰。
- 后台移除所选书籍时要求重新选择，修复空 YAML 属性区替换；减少进度通知、书单重建和无变化时的缓存写入。

## 0.4.2

- 刷新时的目录读取和批注下载均设为 30 秒请求超时，失败后可重试，迟到响应不会覆盖新缓存。
- 原编辑视图关闭后拒绝光标导入，可显式改为文末追加。
- 旧版默认替换设置在加载时归一化为光标插入，移除无调用的凭据状态方法。

## 0.4.1

- 修正社区审核指出的 DOM helper 与定时器调用，改善弹出窗口兼容性，并增加对应回归检查。
- 精简中英文使用说明，补充插件市场和手动下载安装方式，移除旧版升级、开发验证及发布流程。

## 0.4.0

- 重新设计设置页，整合 WebDAV 地址、账号和凭据，分别反馈连接、书库、导入方式和模板的保存结果。
- 支持自定义 Keychain 名称，明确区分已有条目与新建条目，统一验证和保存入口，关闭设置时清除草稿。
- 修复已有缓存无法替换的问题；写入失败可回滚，中断后可恢复。
- 连接检查支持取消及 30 秒超时；取消尚未提交的保存，已开始的提交会完成缓存切换，迟到响应不干扰新操作。
- 修复唯一 Keychain 无法重新选择、偏好保存反馈错位、导入期间书库更新未显示和重复导入记录归属错误。

## 0.3.2

- 设置接入 Obsidian 全局搜索，缓存改用库内文件接口。
- 最低 Obsidian 版本提高到 1.13.0，提供中英文说明。

## 0.3.1

- 恢复社区目录登记的插件 ID `obsidian-moonreader-sync`，修正配置校验和宿主 API 使用问题。
- 发布仅包含三个插件文件，并提供构建来源证明。

## 0.3.0

- 增加书籍展示数量、书名和备份时间排序，保留搜索及当前选书。
- 精简书库与导入目标展示，补充英文使用说明。

## 0.2.0

- 将选书、预览和导入合并为同一面板，支持键盘操作、窄窗口和模板编辑。
- 增加连接测试，密码改用 Obsidian Keychain，最低版本为桌面版 1.11.5。
- 替换正文和同一会话内重复导入均需确认；异常备份或刷新失败时保留缓存。
