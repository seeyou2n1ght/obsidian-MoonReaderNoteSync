import { App, ButtonComponent, Component, DropdownComponent, PluginSettingTab, Setting, SettingGroup, TextComponent, type SettingDefinitionItem } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import { normalizeWebDavUrl, WebDAVClient } from '../utils/webdav';
import { NotePreview, TemplateBuilderUI } from './templateBuilder';
import { t, errorMessage, UserError } from '../i18n';

export class MoonReaderWebDAVSettingTab extends PluginSettingTab {
    private owner: Component | null = null;
    private saving = false;
    private committing = false;
    private cancelOperation: (() => void) | null = null;
    private resetDraft: (() => void) | null = null;
    constructor(app: App, private plugin: MoonReaderSyncPlugin, private browse = () => plugin.openLibrary(), private connectionOnly = false) { super(app, plugin); }
    hide() { this.cancelOperation?.(); this.owner?.unload(); this.owner = null; this.resetDraft?.(); }
    getSettingDefinitions(): SettingDefinitionItem[] {
        // Indexing creates definitions only. Drafts and rendering have no persistence side effects.
        let owner: Component | null = null;
        const ensureOwner = () => {
            // Declarative settings can reuse rendered controls after hide().
            // All definition callbacks share the currently active tab owner.
            this.resetDraft = resetDraft;
            if (!this.owner) { this.owner = new Component(); this.owner.load(); }
            owner = this.owner;
            return owner;
        };
        let url = this.plugin.settings.webDavUrl;
        let username = this.plugin.settings.username;
        let urlInput: HTMLInputElement | null = null;
        let usernameInput: HTMLInputElement | null = null;
        let password = '';
        let useNewPassword = false;
        let newCredentialName = '';
        let nameInput: HTMLInputElement | null = null;
        let nameFeedback: HTMLElement | null = null;
        const updateNameFeedback = () => {
            if (!useNewPassword) return;
            try {
                this.plugin.validateNewCredentialName(newCredentialName);
                nameFeedback?.setText(''); nameInput?.setAttribute('aria-invalid', 'false');
            } catch (error) {
                nameFeedback?.setText(errorMessage(error)); nameInput?.setAttribute('aria-invalid', 'true');
            }
        };
        let selectedSecretId = this.plugin.settings.secretId;
        let secretPicker: DropdownComponent | null = null;
        let saveConnectionButton: ButtonComponent | null = null;
        let cancelCheckButton: ButtonComponent | null = null;
        let savedLabel: HTMLElement | null = null;
        let selectionHint: HTMLElement | null = null;
        let credentialWarning: HTMLElement | null = null;
        const refreshCredentialOptions = () => {
            if (!secretPicker) return;
            secretPicker.selectEl.empty();
            let ids: string[] = [];
            try { ids = this.app.secretStorage.listSecrets(); } catch { /* unavailable entries remain visible */ }
            if (selectedSecretId && !ids.includes(selectedSecretId)) ids.push(selectedSecretId);
            for (const id of ids.sort((a, b) => a.localeCompare(b))) secretPicker.addOption(id, id);
            // A first-time connection must explicitly choose an entry, never bind the first option.
            secretPicker.setValue(selectedSecretId);
            secretPicker.selectEl.title = selectedSecretId;
            secretPicker.selectEl.hidden = !ids.length;
            if (savedLabel) savedLabel.hidden = !ids.length;
            if (selectionHint) {
                selectionHint.dataset.empty = String(!ids.length);
                selectionHint.setText(ids.length ? t('请选择已有 Keychain', 'Choose a saved Keychain') : t('尚无已保存的 Keychain', 'No saved Keychains yet'));
                selectionHint.hidden = !!selectedSecretId;
            }
        };
        let passwordInput: HTMLInputElement | null = null;
        let existingControls: HTMLElement | null = null;
        let passwordControls: HTMLElement | null = null;
        let credentialDetails: HTMLElement | null = null;
        let credentialName: HTMLElement | null = null;
        const updateCredentialDetails = () => {
            const id = this.plugin.settings.secretId;
            const changing = !!id && (useNewPassword || selectedSecretId !== id);
            if (credentialDetails) credentialDetails.hidden = !changing;
            if (credentialName) { credentialName.setText(id); credentialName.hidden = !changing; }
            let available = false;
            try { available = !!selectedSecretId && !!this.app.secretStorage.getSecret(selectedSecretId); } catch { /* show actionable error */ }
            if (credentialWarning) {
                credentialWarning.hidden = useNewPassword || !selectedSecretId || available;
                credentialWarning.setText(t('此 Keychain 的密码不可用。请选择其他已保存的 Keychain，或新建 Keychain。', 'Password unavailable for this Keychain. Choose another saved Keychain or create a new one.'));
            }
            if (selectionHint) selectionHint.hidden = !!selectedSecretId;
        };
        const updateCredentialControls = () => {
            controls.forEach(input => input.disabled = this.saving);
            if (existingControls) existingControls.hidden = useNewPassword;
            if (passwordControls) passwordControls.hidden = !useNewPassword;
            if (passwordInput) passwordInput.disabled = !useNewPassword || this.saving;
            if (nameInput) nameInput.disabled = !useNewPassword || this.saving;
            secretPicker?.setDisabled(useNewPassword || this.saving);
            if (cancelCheckButton) cancelCheckButton.buttonEl.hidden = !this.saving || this.committing;
            saveConnectionButton?.setButtonText(useNewPassword ? t('创建 Keychain 并保存连接', 'Create Keychain and save connection') : t('验证并保存连接', 'Verify and save connection'));
            updateCredentialDetails();
        };
        let status: HTMLElement | null = null;
        const controls = new Set<HTMLInputElement | HTMLButtonElement>();
        const hasDraftChanges = () => useNewPassword || selectedSecretId !== this.plugin.settings.secretId || url.trim() !== this.plugin.settings.webDavUrl || username.trim() !== this.plugin.settings.username;
        const dirty = () => { if (status) {
            status.dataset.state = hasDraftChanges() ? 'dirty' : 'saved';
            status.setText(hasDraftChanges() ? t('修改尚未保存。保存连接后生效。', 'Changes not saved. Save the connection to apply them.') : this.plugin.connectionStatus());
        } };
        const resetDraft = () => {
            url = this.plugin.settings.webDavUrl; username = this.plugin.settings.username;
            selectedSecretId = this.plugin.settings.secretId;
            password = ''; newCredentialName = ''; useNewPassword = false;
            if (urlInput) urlInput.value = url;
            if (usernameInput) usernameInput.value = username;
            if (passwordInput) passwordInput.value = '';
            if (nameInput) { nameInput.value = ''; nameInput.removeAttribute('aria-invalid'); }
            nameFeedback?.setText('');
            refreshCredentialOptions(); updateCredentialControls(); dirty();
        };
        const serverOrigin = (value: string) => { try { return new URL(value.trim()).origin; } catch { return ''; } };
        const resetCredentialSelection = () => {
            const originalIdentity = username.trim() === this.plugin.settings.username &&
                serverOrigin(url) === serverOrigin(this.plugin.settings.webDavUrl);
            selectedSecretId = originalIdentity ? this.plugin.settings.secretId : '';
            refreshCredentialOptions(); updateCredentialDetails();
        };
        const checkConnection = async (save: boolean) => {
            if (!status || this.saving) return;
            if (this.plugin.connectionSaving) {
                status.setText(this.plugin.connectionOperation === 'test' ? t('其他窗口正在测试连接，请完成或取消该检查。', 'Another window is testing a connection. Finish or cancel that check.') : t('正在保存连接，请稍候。', 'Connection is being saved. Please wait.')); return;
            }
            if (this.plugin.syncing) { status.setText(t('请等待当前刷新完成后再修改连接。', 'Wait for the current refresh before changing the connection.')); return; }
            const activeOwner = ensureOwner();
            const controller = new AbortController();
            const active = () => this.owner === activeOwner && !controller.signal.aborted;
            const token = this.plugin.beginConnectionOperation(save);
            if (!token) return;
            const cancel = () => {
                if (this.committing || this.cancelOperation !== cancel) return;
                controller.abort(); this.cancelOperation = null; this.saving = false;
                this.plugin.endConnectionOperation(token);
                controls.forEach(input => input.disabled = false); updateCredentialControls();
            };
            this.cancelOperation = cancel; this.saving = true; this.committing = false;
            controls.forEach(input => input.disabled = true);
            secretPicker?.setDisabled(true);
            updateCredentialControls();
            status.setText(t('正在验证连接…', 'Checking connection…'));
            try {
                if (!useNewPassword && !selectedSecretId) throw new UserError(t('尚未选择凭据。请选择已有条目，或点击“新建 Keychain”。', 'No credential selected. Choose an existing entry or select New Keychain.'));
                const webDavUrl = normalizeWebDavUrl(url), account = username.trim();
                const existingSecretId = useNewPassword ? '' : selectedSecretId;
                let newName: string | undefined;
                if (useNewPassword) {
                    try { newName = this.plugin.validateNewCredentialName(newCredentialName); }
                    catch (error) { updateNameFeedback(); nameInput?.focus(); throw error; }
                }
                if (!account) throw new UserError(t('请填写账号。', 'Enter your username.'));
                const testPassword = useNewPassword ? password : (existingSecretId ? this.app.secretStorage.getSecret(existingSecretId) : '');
                if (!testPassword) throw new UserError(useNewPassword ? t('请填写新密码。', 'Enter your new password.') : t('请选择可用凭据，或使用新密码。', 'Choose an available credential or use a new password.'));
                const files = await WebDAVClient.testConnection(webDavUrl, account, testPassword, controller.signal);
                if (!active()) return;
                const count = files.filter(file => !file.isCollection && new URL(file.href).pathname.toLowerCase().endsWith('.an')).length;
                if (!save) {
                    status.dataset.state = 'tested';
                    status.setText(t('连接成功，发现 ', 'Connection successful; found ') + count + t(' 个笔记文件。', ' annotation files.') +
                        (hasDraftChanges() ? t(' 修改尚未保存。', ' Changes not saved.') : '') + (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.'))); return;
                }
                if (this.plugin.syncing) throw new UserError(t('刷新正在进行，请稍后重新保存。', 'A refresh is running. Save again after it finishes.'));
                status.dataset.state = 'saving'; status.setText(t('连接已验证，正在等待保存…', 'Connection verified; waiting to save…'));
                const committed = await this.plugin.saveConnection(webDavUrl, account, testPassword, active, existingSecretId || undefined, newName, () => {
                    status?.setText(t('正在保存连接…', 'Saving connection…'));
                    this.committing = true; updateCredentialControls();
                });
                if (!committed || !active()) return;
                updateCredentialDetails();
                password = ''; if (passwordInput) passwordInput.value = '';
                newCredentialName = ''; if (nameInput) nameInput.value = '';
                selectedSecretId = this.plugin.settings.secretId;
                refreshCredentialOptions();
                useNewPassword = false;
                updateCredentialControls();
                status.dataset.state = 'saved';
                status.setText(t('连接成功并已保存，发现 ', 'Connection saved; found ') + count + t(' 个笔记文件。', ' annotation files.') + (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.')));
            } catch (error) {
                if (active()) { status.dataset.state = 'error'; status.setText(errorMessage(error) + ' ' + t('连接配置未更改。', 'Connection settings were not changed.')); }
            } finally {
                if (this.cancelOperation === cancel) {
                    this.cancelOperation = null; this.saving = false; this.committing = false;
                    this.plugin.endConnectionOperation(token);
                    if (!active()) resetDraft();
                    updateCredentialControls();
                }
                if (active() && useNewPassword) {
                    updateNameFeedback();
                    if (nameInput?.getAttribute('aria-invalid') === 'true') nameInput.focus();
                }
            }
        };
        const definitions: SettingDefinitionItem[] = [{ type: 'group', cls: 'moonreader-settings', heading: t('备份连接', 'Backup connection'), items: [
            { name: t('WebDAV 目录地址', 'WebDAV folder URL'), desc: t('填写包含 .an 备份文件的目录地址。', 'Folder URL containing your .an backup files.'), render: setting => {
                if (!this.owner) resetDraft();
                const currentOwner = ensureOwner();
                controls.clear();
                setting.settingEl.parentElement?.addClass('moonreader-connection-card');
                setting.settingEl.parentElement?.parentElement?.addClass('moonreader-connection-group');
                setting.settingEl.addClass('moonreader-connection-field');
                setting.addText(text => { urlInput = text.inputEl; controls.add(text.inputEl); text.setValue(url).setPlaceholder('https://…/dav/Books/.Notes/').onChange(value => {
                    const changedServer = serverOrigin(value) !== serverOrigin(url);
                    url = value; if (changedServer) resetCredentialSelection(); dirty();
                }); });
                return () => { if (this.owner === currentOwner) this.hide(); };
            } },
            { name: t('账号', 'Username'), desc: t('用于访问此 WebDAV 目录。', 'Account used to access this folder.'), render: setting => {
                setting.settingEl.addClass('moonreader-connection-field');
                setting.addText(text => { ensureOwner(); usernameInput = text.inputEl; controls.add(text.inputEl); text.setValue(username).onChange(value => {
                    const changedAccount = value.trim() !== username.trim();
                    username = value; if (changedAccount) resetCredentialSelection(); dirty();
                }); });
            } },
            { name: t('连接凭据', 'Connection credential'), desc: t('选择此账号使用的已有 Keychain，或新建并保存密码。', 'Choose a saved Keychain for this account or create one to save its password.'), render: setting => {
                ensureOwner();
                setting.settingEl.addClass('moonreader-keychain');
                const section = setting.controlEl.createDiv({ cls: 'moonreader-credential-controls' });
                credentialDetails = section.createDiv({ cls: 'moonreader-credential', attr: { 'aria-live': 'polite' } });
                const heading = credentialDetails.createDiv({ cls: 'moonreader-credential-heading' });
                heading.createEl('span', { text: t('当前使用', 'Currently using') });
                credentialName = credentialDetails.createEl('code', { cls: 'moonreader-credential-name' });
                existingControls = section.createDiv({ cls: 'moonreader-existing-credential' });
                savedLabel = existingControls.createEl('label', { cls: 'moonreader-saved-label', text: t('已保存的 Keychain', 'Saved Keychains') });
                selectionHint = existingControls.createDiv({ cls: 'moonreader-selection-hint', attr: { 'aria-live': 'polite' } });
                secretPicker = new DropdownComponent(existingControls).onChange(value => {
                    if (useNewPassword || this.saving || this.plugin.connectionSaving) return;
                    selectedSecretId = value;
                    secretPicker!.selectEl.title = value;
                    dirty(); updateCredentialDetails();
                });
                secretPicker.selectEl.setAttribute('aria-label', t('已保存的 Keychain', 'Saved Keychains'));
                savedLabel.appendChild(secretPicker.selectEl);
                refreshCredentialOptions();
                secretPicker.selectEl.addEventListener('focus', () => { if (!this.saving && !useNewPassword) refreshCredentialOptions(); });
                const usePasswordButton = new ButtonComponent(existingControls).setButtonText(t('新建 Keychain', 'New Keychain')).onClick(() => {
                    if (this.saving || this.plugin.connectionSaving) return;
                    try {
                        newCredentialName = this.plugin.suggestCredentialName(url);
                        if (nameInput) nameInput.value = newCredentialName;
                        useNewPassword = true; dirty(); updateCredentialControls(); updateNameFeedback(); nameInput?.focus(); nameInput?.select();
                    } catch (error) { status?.setText(errorMessage(error)); }
                });
                controls.add(usePasswordButton.buttonEl);
                existingControls.appendChild(selectionHint);
                credentialWarning = section.createDiv({ cls: 'moonreader-credential-warning', attr: { role: 'status' } });
                passwordControls = section.createDiv({ cls: 'moonreader-new-password' });
                passwordControls.createDiv({ cls: 'moonreader-credential-heading', text: t('新建 Keychain', 'New Keychain') });
                const nameLabel = passwordControls.createEl('label', { text: t('Keychain 名称', 'Keychain name') });
                const nameField = new TextComponent(nameLabel).setPlaceholder('moonreader-home-nas').onChange(value => {
                    newCredentialName = value; dirty(); updateNameFeedback(); updateCredentialDetails();
                });
                nameInput = nameField.inputEl; nameInput.maxLength = 64; nameInput.autocomplete = 'off'; nameInput.spellcheck = false;
                nameInput.setAttribute('aria-label', t('Keychain 名称', 'Keychain name')); controls.add(nameInput);
                passwordControls.createDiv({ cls: 'moonreader-credential-help', text: t('可修改建议名称。支持小写字母、数字和连字符，最多 64 字符。', 'Edit the suggested name. Use lowercase letters, numbers and dashes, up to 64 characters.') });
                nameFeedback = passwordControls.createDiv({ cls: 'moonreader-credential-name-error', attr: { 'aria-live': 'polite' } });
                const label = passwordControls.createEl('label', { text: t('新密码或应用密码', 'New password or app password') });
                const input = new TextComponent(label).onChange(value => { password = value; dirty(); });
                passwordInput = input.inputEl; passwordInput.type = 'password'; passwordInput.autocomplete = 'new-password';
                input.setPlaceholder(t('输入密码或应用密码', 'Enter password or app password'));
                passwordInput.setAttribute('aria-label', t('新密码或应用密码', 'New password or app password'));
                controls.add(passwordInput);
                passwordControls.createDiv({ cls: 'moonreader-credential-help', text: t('点击下方“创建 Keychain 并保存连接”完成保存；测试不会创建凭据。', 'Use “Create Keychain and save connection” below to save. Testing does not create a credential.') });
                const cancelButton = new ButtonComponent(passwordControls).setButtonText(t('取消新建', 'Cancel creation')).onClick(() => {
                    if (this.saving || this.plugin.connectionSaving) return;
                    password = ''; passwordInput!.value = ''; newCredentialName = ''; nameInput!.value = ''; nameFeedback?.setText(''); useNewPassword = false;
                    dirty(); updateCredentialControls(); usePasswordButton.buttonEl.focus();
                });
                controls.add(cancelButton.buttonEl);
                updateCredentialControls();
            } },
            { name: t('测试和保存连接', 'Test and save connection'), render: setting => {
                ensureOwner(); setting.settingEl.addClass('moonreader-connection-actions');
                setting.addButton(button => {
                    controls.add(button.buttonEl); button.setButtonText(t('测试连接', 'Test connection')).onClick(() => { void checkConnection(false); });
                    const testAction = setting.controlEl.createDiv({ cls: 'moonreader-test-action' });
                    testAction.appendChild(button.buttonEl);
                    testAction.createDiv({ cls: 'moonreader-test-hint', text: t('仅测试，不保存', 'Test only; does not save') });
                })
                    .addButton(button => { saveConnectionButton = button; controls.add(button.buttonEl); button.buttonEl.dataset.action = 'save-connection'; button.setCta().onClick(() => { void checkConnection(true); }); });
                setting.addButton(button => {
                    cancelCheckButton = button; button.setButtonText(t('取消检查', 'Cancel check')).onClick(() => {
                        if (!this.cancelOperation || this.committing) return;
                        this.cancelOperation();
                        if (status) { status.dataset.state = 'cancelled'; status.setText(t('检查已取消，连接未更改。', 'Check cancelled. Connection settings were not changed.')); }
                    });
                });
                updateCredentialControls();
                status = setting.controlEl.createDiv({ cls: 'moonreader-status', attr: { role: 'status', 'aria-live': 'polite' } });
                status.dataset.state = this.plugin.configured() ? 'saved' : 'empty';
                status.setText(this.saving ? t('正在保存连接…', 'Saving connection…') : this.plugin.connectionStatus());
            } }
        ] }];
        if (this.connectionOnly) {
            definitions.push({ name: t('返回书库', 'Back to library'), render: setting => { setting.settingEl.addClass('moonreader-back-to-library'); setting.addButton(button => button.setButtonText(t('返回书库', 'Back to library')).onClick(() => this.browse())); } });
            return definitions;
        }
        definitions.push({ type: 'group', cls: 'moonreader-settings', heading: t('书库显示', 'Library display'), items: [
            { name: t('阅读笔记', 'Reading notes'), desc: t('浏览缓存书籍并插入当前笔记。', 'Browse cached books and insert into the current note.'), render: setting => { setting.addButton(button => button.setButtonText(t('浏览书籍', 'Browse books')).onClick(() => this.browse())); } },
            { name: t('显示书籍数量', 'Books shown'), desc: t('0 表示全部。先搜索和排序，再限制显示数量；不影响备份下载。', '0 shows all books. Search and sort are applied before this limit; downloads are unaffected.'), render: setting => {
                const feedback = setting.descEl.createDiv({ cls: 'moonreader-preference-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
                let editRevision = 0;
                setting.addText(text => {
                    text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '1';
                    text.setValue(String(this.plugin.settings.bookListLimit)).onChange(async value => {
                        const revision = ++editRevision;
                        const limit = /^\d+$/.test(value) ? Number(value) : NaN;
                        if (!Number.isSafeInteger(limit)) { feedback.setText(t('请输入非负整数，0 表示全部书籍。', 'Enter a non-negative integer. Use 0 for all books.')); return; }
                        try {
                            await this.plugin.updateSettings({ bookListLimit: limit }); this.plugin.notify();
                            if (revision === editRevision) { text.setValue(String(this.plugin.settings.bookListLimit)); feedback.setText(t('已保存。', 'Saved.')); }
                        } catch (error) {
                            if (revision === editRevision) { feedback.setText(errorMessage(error)); text.setValue(String(this.plugin.settings.bookListLimit)); }
                        }
                    });
                });
            } },
        ] });
        definitions.push({ type: 'group', cls: 'moonreader-settings', heading: t('导入方式', 'Note insertion'), items: [
            { name: t('默认写入方式', 'Default import mode'), desc: t('每次导入都会展示目标。替换正文始终需要确认。', 'Every import shows its destination. Replacing the body always requires confirmation.'), render: setting => {
                const feedback = setting.descEl.createDiv({ cls: 'moonreader-preference-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
                let editRevision = 0;
                setting.addDropdown(dropdown => dropdown.addOption('ask', t('当前笔记光标处', 'Current note cursor')).addOption('append', t('文末追加', 'Append')).setValue(this.plugin.settings.insertAction === 'overwrite' ? 'ask' : this.plugin.settings.insertAction).onChange(async value => {
                    if (value !== 'ask' && value !== 'append') return;
                    const revision = ++editRevision;
                    try {
                        await this.plugin.updateSettings({ insertAction: value });
                        if (revision === editRevision) { dropdown.setValue(value); feedback.setText(t('已保存。', 'Saved.')); }
                    } catch (error) {
                        if (revision === editRevision) { feedback.setText(errorMessage(error)); dropdown.setValue(this.plugin.settings.insertAction === 'overwrite' ? 'ask' : this.plugin.settings.insertAction); }
                    }
                }));
            } },
        ] });
        definitions.push({ type: 'group', cls: 'moonreader-settings', heading: t('笔记模板', 'Note template'), items: [
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
                const feedback = section.createDiv({ cls: 'moonreader-preference-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
                new ButtonComponent(section).setButtonText(t('保存默认模板', 'Save default template')).onClick(async () => {
                    try { if (!template.trim()) throw new UserError(t('模板不能为空。', 'The template cannot be empty.')); await this.plugin.updateSettings({ noteTemplate: template }); feedback.setText(t('默认模板已保存。', 'Default template saved.')); }
                    catch (error) { feedback.setText(errorMessage(error)); }
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
