import { App, ButtonComponent, Component, PluginSettingTab, Setting } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import { normalizeWebDavUrl, WebDAVClient } from '../utils/webdav';
import { NotePreview, TemplateBuilderUI } from './templateBuilder';
import { t, errorMessage, UserError } from '../i18n';

export class MoonReaderWebDAVSettingTab extends PluginSettingTab {
    private owner: Component | null = null;
    private saving = false;
    constructor(app: App, private plugin: MoonReaderSyncPlugin, private browse = () => plugin.openLibrary(), private connectionOnly = false) { super(app, plugin); }
    hide() { this.owner?.unload(); this.owner = null; }
    display(): void {
        this.hide();
        const owner = this.owner = new Component();
        owner.load();
        const { containerEl: el } = this;
        el.empty();
        el.addClass('moonreader-settings');
        el.createEl('h3', { text: t('连接备份', 'Backup connection') });
        el.createEl('p', { cls: 'moonreader-meta', text: t('连接包含 .an 文件的 WebDAV 目录，书籍缓存后可离线导入。', 'Connect the WebDAV folder containing .an files. Cached books can be imported offline.') });
        let url = this.plugin.settings.webDavUrl;
        let username = this.plugin.settings.username;
        let password = '';
        const status = el.createDiv({ cls: 'moonreader-status', attr: { role: 'status', 'aria-live': 'polite' } });
        status.setText(this.plugin.connectionStatus());
        const dirty = () => { status.dataset.state = 'dirty'; status.setText(t('修改尚未保存，当前仍使用原连接。', 'Changes not saved; the previous connection remains in use.')); };
        const form = el.createDiv();
        new Setting(form).setName(t('WebDAV 目录地址', 'WebDAV folder URL')).addText(text => text.setValue(url).setPlaceholder('https://…/dav/Books/.Notes/').onChange(value => { url = value; dirty(); }));
        new Setting(form).setName(t('账号', 'Username')).addText(text => text.setValue(username).onChange(value => { username = value; dirty(); }));
        let passwordInput: HTMLInputElement;
        new Setting(form).setName(t('密码或应用密码', 'Password or app password')).setDesc(t('保存到 Obsidian 原生密钥库。已有密码时留空表示保留；测试不会保存。', 'Stored in Obsidian Keychain. Leave blank to keep the saved password; testing does not save.')).addText(text => {
            passwordInput = text.inputEl;
            passwordInput.type = 'password';
            text.onChange(value => { password = value; dirty(); });
        });
        const checkConnection = async (save: boolean) => {
            if (this.saving || this.plugin.connectionSaving) return;
            if (this.plugin.syncing) { status.setText(t('请等待当前刷新完成后再修改连接。', 'Wait for the current refresh before changing the connection.')); return; }
            this.saving = true;
            this.plugin.connectionSaving = true;
            form.querySelectorAll<HTMLInputElement>('input, button').forEach(input => input.disabled = true);
            status.setText(t('正在验证连接…', 'Checking connection…'));
            try {
                const webDavUrl = normalizeWebDavUrl(url);
                const account = username.trim();
                if (!account) throw new UserError(t('请填写账号。', 'Enter your username.'));
                if (!password && account !== this.plugin.settings.username) throw new UserError(t('更换账号时请重新输入密码。', 'Re-enter the password when changing accounts.'));
                if (!password && new URL(webDavUrl).origin !== new URL(this.plugin.settings.webDavUrl).origin) throw new UserError(t('更换服务器时请重新输入密码。', 'Re-enter the password when changing servers.'));
                const testPassword = password || (this.plugin.settings.secretId ? this.app.secretStorage.getSecret(this.plugin.settings.secretId) : '');
                if (!testPassword) throw new UserError(t('请填写密码。', 'Enter your password.'));
                const files = await WebDAVClient.testConnection(webDavUrl, account, testPassword);
                if (this.owner !== owner) return;
                const count = files.filter(file => !file.isCollection && new URL(file.href).pathname.toLowerCase().endsWith('.an')).length;
                if (!save) {
                    status.dataset.state = 'tested';
                    status.setText(t('连接成功，发现 ', 'Connection successful; found ') + count + t(' 个笔记文件。尚未保存，请点击“保存连接”以使用此配置。', ' annotation files. Not saved — click Save connection to use this configuration.') + (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.')));
                    return;
                }
                if (this.plugin.syncing) throw new UserError(t('刷新正在进行，请稍后重新保存。', 'A refresh is running. Save again after it finishes.'));
                await this.plugin.saveConnection(webDavUrl, account, testPassword, () => this.owner === owner);
                if (this.owner !== owner) return;
                password = '';
                passwordInput!.value = '';
                await this.plugin.loadCache();
                status.dataset.state = 'saved';
                status.setText(t('连接成功并已保存，发现 ', 'Connection saved; found ') + count + t(' 个笔记文件。', ' annotation files.') + (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.')));
            } catch (error) {
                if (this.owner === owner) { status.dataset.state = 'error'; status.setText(errorMessage(error) + ' ' + t('连接配置未更改。', 'Connection settings were not changed.')); }
            } finally {
                this.saving = false;
                this.plugin.connectionSaving = false;
                form.querySelectorAll<HTMLInputElement>('input, button').forEach(input => input.disabled = false);
            }
        };
        new Setting(form).addButton(button => button.setButtonText(t('测试连接', 'Test connection')).onClick(() => { void checkConnection(false); }))
            .addButton(button => button.setCta().setButtonText(t('保存连接', 'Save connection')).onClick(() => { void checkConnection(true); }));
        form.append(status);
        if (this.connectionOnly) {
            new ButtonComponent(el).setButtonText(t('返回书库', 'Back to library')).onClick(() => this.browse());
            return;
        }
        new Setting(el).setName(t('阅读笔记', 'Reading notes')).setDesc(t('浏览缓存书籍并插入当前笔记。', 'Browse cached books and insert into the current note.'))
            .addButton(button => button.setButtonText(t('浏览书籍', 'Browse books')).onClick(() => this.browse()));
        el.createEl('h3', { text: t('导入偏好', 'Import preferences') });
        new Setting(el).setName(t('默认写入方式', 'Default import mode')).setDesc(t('每次导入都会展示目标。替换正文始终需要确认。', 'Every import shows its destination. Replacing the body always requires confirmation.'))
            .addDropdown(dropdown => dropdown.addOption('ask', t('当前笔记光标处', 'Current note cursor')).addOption('append', t('文末追加', 'Append')).setValue(this.plugin.settings.insertAction === 'overwrite' ? 'ask' : this.plugin.settings.insertAction).onChange(async value => {
                if (value !== 'ask' && value !== 'append') return;
                try { await this.plugin.updateSettings({ insertAction: value }); }
                catch (error) { status.setText(errorMessage(error)); dropdown.setValue(this.plugin.settings.insertAction === 'overwrite' ? 'ask' : this.plugin.settings.insertAction); }
            }));
        const templateSection = el.createEl('details', { cls: 'moonreader-settings-template' });
        templateSection.createEl('summary', { text: t('默认笔记模板', 'Default note template') });
        let template = this.plugin.settings.noteTemplate;
        const editorContainer = templateSection.createDiv();
        templateSection.createEl('p', { cls: 'moonreader-meta', text: t('此处使用示例内容；导入时预览所选书籍的真实笔记。', 'Sample content below; importing previews the selected book’s actual notes.') });
        const preview = owner.addChild(new NotePreview(this.app, templateSection.createDiv({ cls: 'moonreader-preview' })));
        TemplateBuilderUI.build(editorContainer, template, value => { template = value; void preview.render(this.plugin.renderNotes(TemplateBuilderUI.sample(), template), ''); });
        void preview.render(this.plugin.renderNotes(TemplateBuilderUI.sample(), template), '');
        new ButtonComponent(templateSection).setButtonText(t('保存默认模板', 'Save default template')).onClick(async () => {
            try {
                if (!template.trim()) throw new UserError(t('模板不能为空。', 'The template cannot be empty.'));
                await this.plugin.updateSettings({ noteTemplate: template });
                status.setText(t('默认模板已保存。', 'Default template saved.'));
            } catch (error) { status.setText(errorMessage(error)); }
        });
    }
}
