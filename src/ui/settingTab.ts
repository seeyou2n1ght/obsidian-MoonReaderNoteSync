import { App, ButtonComponent, Component, PluginSettingTab, Setting, SettingGroup, type SettingDefinitionItem } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import { normalizeWebDavUrl, WebDAVClient } from '../utils/webdav';
import { NotePreview, TemplateBuilderUI } from './templateBuilder';
import { t, errorMessage, UserError } from '../i18n';

export class MoonReaderWebDAVSettingTab extends PluginSettingTab {
    private owner: Component | null = null;
    private saving = false;
    constructor(app: App, private plugin: MoonReaderSyncPlugin, private browse = () => plugin.openLibrary(), private connectionOnly = false) { super(app, plugin); }
    hide() { this.owner?.unload(); this.owner = null; }
    getSettingDefinitions(): SettingDefinitionItem[] {
        // Indexing creates definitions only. Drafts and rendering have no persistence side effects.
        let owner: Component | null = null;
        const ensureOwner = () => {
            if (!owner) { this.hide(); owner = this.owner = new Component(); owner.load(); }
            return owner;
        };
        let url = this.plugin.settings.webDavUrl;
        let username = this.plugin.settings.username;
        let password = '';
        let passwordInput: HTMLInputElement | null = null;
        let status: HTMLElement | null = null;
        const controls = new Set<HTMLInputElement | HTMLButtonElement>();
        const dirty = () => { if (status) { status.dataset.state = 'dirty'; status.setText(t('修改尚未保存，当前仍使用原连接。', 'Changes not saved; the previous connection remains in use.')); } };
        const checkConnection = async (save: boolean) => {
            if (!owner || !status || this.saving || this.plugin.connectionSaving) return;
            if (this.plugin.syncing) { status.setText(t('请等待当前刷新完成后再修改连接。', 'Wait for the current refresh before changing the connection.')); return; }
            const activeOwner = owner;
            const active = () => this.owner === activeOwner;
            this.saving = true; this.plugin.connectionSaving = true;
            controls.forEach(input => input.disabled = true);
            status.setText(t('正在验证连接…', 'Checking connection…'));
            try {
                const webDavUrl = normalizeWebDavUrl(url), account = username.trim();
                if (!account) throw new UserError(t('请填写账号。', 'Enter your username.'));
                if (!password && account !== this.plugin.settings.username) throw new UserError(t('更换账号时请重新输入密码。', 'Re-enter the password when changing accounts.'));
                if (!password && new URL(webDavUrl).origin !== new URL(this.plugin.settings.webDavUrl).origin) throw new UserError(t('更换服务器时请重新输入密码。', 'Re-enter the password when changing servers.'));
                const testPassword = password || (this.plugin.settings.secretId ? this.app.secretStorage.getSecret(this.plugin.settings.secretId) : '');
                if (!testPassword) throw new UserError(t('请填写密码。', 'Enter your password.'));
                const files = await WebDAVClient.testConnection(webDavUrl, account, testPassword);
                if (!active()) return;
                const count = files.filter(file => !file.isCollection && new URL(file.href).pathname.toLowerCase().endsWith('.an')).length;
                if (!save) {
                    status.dataset.state = 'tested';
                    status.setText(t('连接成功，发现 ', 'Connection successful; found ') + count + t(' 个笔记文件。尚未保存，请点击“保存连接”以使用此配置。', ' annotation files. Not saved — click Save connection to use this configuration.') + (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.'))); return;
                }
                if (this.plugin.syncing) throw new UserError(t('刷新正在进行，请稍后重新保存。', 'A refresh is running. Save again after it finishes.'));
                await this.plugin.saveConnection(webDavUrl, account, testPassword, active);
                if (!active()) return;
                password = ''; if (passwordInput) passwordInput.value = '';
                await this.plugin.loadCache();
                if (!active()) return;
                status.dataset.state = 'saved';
                status.setText(t('连接成功并已保存，发现 ', 'Connection saved; found ') + count + t(' 个笔记文件。', ' annotation files.') + (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.')));
            } catch (error) {
                if (active()) { status.dataset.state = 'error'; status.setText(errorMessage(error) + ' ' + t('连接配置未更改。', 'Connection settings were not changed.')); }
            } finally { this.saving = false; this.plugin.connectionSaving = false; controls.forEach(input => input.disabled = false); }
        };
        const definitions: SettingDefinitionItem[] = [{ type: 'group', cls: 'moonreader-settings', heading: t('连接备份', 'Backup connection'), items: [
            { name: t('WebDAV 目录地址', 'WebDAV folder URL'), desc: t('连接包含 .an 文件的目录，缓存后可离线导入。', 'Connect the folder containing .an files. Cached books are available offline.'), render: setting => {
                const currentOwner = ensureOwner();
                setting.addText(text => { controls.add(text.inputEl); text.setValue(url).setPlaceholder('https://…/dav/Books/.Notes/').onChange(value => { url = value; dirty(); }); });
                return () => { if (this.owner === currentOwner) this.hide(); };
            } },
            { name: t('账号', 'Username'), render: setting => setting.addText(text => { ensureOwner(); controls.add(text.inputEl); text.setValue(username).onChange(value => { username = value; dirty(); }); }) },
            { name: t('密码或应用密码', 'Password or app password'), desc: t('保存到 Obsidian 原生密钥库。已有密码时留空表示保留；测试不会保存。', 'Stored in Obsidian Keychain. Leave blank to keep the saved password; testing does not save.'), render: setting => {
                setting.addText(text => { ensureOwner(); passwordInput = text.inputEl; controls.add(text.inputEl); text.inputEl.type = 'password'; text.onChange(value => { password = value; dirty(); }); });
            } },
            { name: t('测试和保存连接', 'Test and save connection'), render: setting => {
                ensureOwner(); setting.settingEl.addClass('moonreader-connection-actions');
                setting.addButton(button => { controls.add(button.buttonEl); button.setButtonText(t('测试连接', 'Test connection')).onClick(() => { void checkConnection(false); }); })
                    .addButton(button => { controls.add(button.buttonEl); button.setCta().setButtonText(t('保存连接', 'Save connection')).onClick(() => { void checkConnection(true); }); });
                status = setting.controlEl.createDiv({ cls: 'moonreader-status', attr: { role: 'status', 'aria-live': 'polite' } }); status.setText(this.plugin.connectionStatus());
            } }
        ] }];
        if (this.connectionOnly) {
            definitions.push({ name: t('返回书库', 'Back to library'), render: setting => { setting.addButton(button => button.setButtonText(t('返回书库', 'Back to library')).onClick(() => this.browse())); } });
            return definitions;
        }
        definitions.push({ type: 'group', cls: 'moonreader-settings', heading: t('书库与导入', 'Library and import'), items: [
            { name: t('阅读笔记', 'Reading notes'), desc: t('浏览缓存书籍并插入当前笔记。', 'Browse cached books and insert into the current note.'), render: setting => { setting.addButton(button => button.setButtonText(t('浏览书籍', 'Browse books')).onClick(() => this.browse())); } },
            { name: t('显示书籍数量', 'Books shown'), desc: t('0 表示全部。先搜索和排序，再限制显示数量；不影响备份下载。', '0 shows all books. Search and sort are applied before this limit; downloads are unaffected.'), render: setting => {
                setting.addText(text => {
                    text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '1';
                    text.setValue(String(this.plugin.settings.bookListLimit)).onChange(async value => {
                        const limit = /^\d+$/.test(value) ? Number(value) : NaN;
                        if (!Number.isSafeInteger(limit)) { status?.setText(t('请输入非负整数，0 表示全部书籍。', 'Enter a non-negative integer. Use 0 for all books.')); return; }
                        try { await this.plugin.updateSettings({ bookListLimit: limit }); this.plugin.notify(); status?.setText(t('书库显示设置已保存。', 'Library display settings saved.')); }
                        catch (error) { status?.setText(errorMessage(error)); text.setValue(String(this.plugin.settings.bookListLimit)); }
                    });
                });
            } },
            { name: t('默认写入方式', 'Default import mode'), desc: t('每次导入都会展示目标。替换正文始终需要确认。', 'Every import shows its destination. Replacing the body always requires confirmation.'), render: setting => {
                setting.addDropdown(dropdown => dropdown.addOption('ask', t('当前笔记光标处', 'Current note cursor')).addOption('append', t('文末追加', 'Append')).setValue(this.plugin.settings.insertAction === 'overwrite' ? 'ask' : this.plugin.settings.insertAction).onChange(async value => {
                    if (value !== 'ask' && value !== 'append') return;
                    try { await this.plugin.updateSettings({ insertAction: value }); }
                    catch (error) { status?.setText(errorMessage(error)); dropdown.setValue(this.plugin.settings.insertAction === 'overwrite' ? 'ask' : this.plugin.settings.insertAction); }
                }));
            } },
            { name: t('默认笔记模板', 'Default note template'), render: setting => {
                const currentOwner = ensureOwner();
                setting.settingEl.addClass('moonreader-template-setting');
                const section = setting.controlEl.createEl('details', { cls: 'moonreader-settings-template' });
                section.createEl('summary', { text: t('调整模板', 'Adjust template') });
                let template = this.plugin.settings.noteTemplate;
                const editor = section.createDiv();
                section.createEl('p', { cls: 'moonreader-meta', text: t('此处使用示例内容；导入时预览所选书籍的真实笔记。', 'Sample content below; importing previews the selected book’s actual notes.') });
                const preview = currentOwner.addChild(new NotePreview(this.app, section.createDiv({ cls: 'moonreader-preview' })));
                TemplateBuilderUI.build(editor, template, value => { template = value; void preview.render(this.plugin.renderNotes(TemplateBuilderUI.sample(), template), ''); });
                void preview.render(this.plugin.renderNotes(TemplateBuilderUI.sample(), template), '');
                new ButtonComponent(section).setButtonText(t('保存默认模板', 'Save default template')).onClick(async () => {
                    try { if (!template.trim()) throw new UserError(t('模板不能为空。', 'The template cannot be empty.')); await this.plugin.updateSettings({ noteTemplate: template }); status?.setText(t('默认模板已保存。', 'Default template saved.')); }
                    catch (error) { status?.setText(errorMessage(error)); }
                });
            } }
        ] });
        return definitions;
    }
    // The connection modal shares these definitions without participating in settings navigation.
    renderConnection() {
        this.hide(); this.containerEl.empty(); this.containerEl.addClass('moonreader-settings');
        for (const definition of this.getSettingDefinitions()) {
            if ('type' in definition && definition.type === 'group') {
                const group = new SettingGroup(this.containerEl).setHeading(definition.heading || '');
                for (const item of definition.items || []) if ('render' in item && item.render) item.render(new Setting(group.listEl).setName(item.name).setDesc(item.desc || ''), group);
            } else if ('render' in definition && definition.render) {
                const group = new SettingGroup(this.containerEl);
                definition.render(new Setting(group.listEl).setName(definition.name), group);
            }
        }
    }
}
