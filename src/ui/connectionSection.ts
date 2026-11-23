import { App, ButtonComponent, Component, DropdownComponent, Setting, TextComponent, type SettingDefinitionItem } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import { normalizeWebDavUrl, WebDAVClient } from '../utils/webdav';
import { errorMessage, t, UserError } from '../i18n';

export interface ConnectionSectionHost {
    readonly app: App;
    readonly plugin: MoonReaderSyncPlugin;
    readonly connectionOnly: boolean;
    hasOwner(): boolean;
    ensureOwner(resetDraft: () => void): Component;
    isCurrentOwner(owner: Component): boolean;
    onHide(): void;
}

export class ConnectionSection {
    private _saving = false;
    get saving(): boolean { return this._saving; }
    private set saving(value: boolean) { this._saving = value; }
    private committing = false;
    private cancelOperation: (() => void) | null = null;
    private url: string;
    private username: string;
    private password = '';
    private useNewPassword = false;
    private newCredentialName = '';
    private selectedSecretId: string;
    private urlInput: HTMLInputElement | null = null;
    private usernameInput: HTMLInputElement | null = null;
    private nameInput: HTMLInputElement | null = null;
    private nameFeedback: HTMLElement | null = null;
    private secretPicker: DropdownComponent | null = null;
    private saveConnectionButton: ButtonComponent | null = null;
    private cancelCheckButton: ButtonComponent | null = null;
    private savedLabel: HTMLElement | null = null;
    private selectionHint: HTMLElement | null = null;
    private credentialWarning: HTMLElement | null = null;
    private passwordInput: HTMLInputElement | null = null;
    private existingControls: HTMLElement | null = null;
    private passwordControls: HTMLElement | null = null;
    private credentialDetails: HTMLElement | null = null;
    private credentialName: HTMLElement | null = null;
    private status: HTMLElement | null = null;
    private readonly controls = new Set<HTMLInputElement | HTMLButtonElement>();

    constructor(private host: ConnectionSectionHost) {
        this.url = host.plugin.settings.webDavUrl;
        this.username = host.plugin.settings.username;
        this.selectedSecretId = host.plugin.settings.secretId;
    }

    cancel() { this.cancelOperation?.(); }

    resetDraft = () => {
        const { settings } = this.host.plugin;
        this.url = settings.webDavUrl;
        this.username = settings.username;
        this.selectedSecretId = settings.secretId;
        this.password = '';
        this.newCredentialName = '';
        this.useNewPassword = false;
        if (this.urlInput) this.urlInput.value = this.url;
        if (this.usernameInput) this.usernameInput.value = this.username;
        if (this.passwordInput) this.passwordInput.value = '';
        if (this.nameInput) { this.nameInput.value = ''; this.nameInput.removeAttribute('aria-invalid'); }
        this.nameFeedback?.setText('');
        this.refreshCredentialOptions();
        this.updateCredentialControls();
        this.updateDirtyStatus();
    };

    private serverOrigin(value: string): string {
        try { return new URL(value.trim()).origin; }
        catch { return ''; }
    }

    private hasDraftChanges(): boolean {
        const { settings } = this.host.plugin;
        return this.useNewPassword
            || this.selectedSecretId !== settings.secretId
            || this.url.trim() !== settings.webDavUrl
            || this.username.trim() !== settings.username;
    }

    private updateDirtyStatus() {
        if (!this.status) return;
        const changed = this.hasDraftChanges();
        this.status.dataset.state = changed ? 'dirty' : 'saved';
        this.status.setText(changed
            ? t('修改尚未保存。保存连接后生效。', 'Changes not saved. Save the connection to apply them.')
            : this.host.plugin.connectionStatus());
    }

    private updateNameFeedback() {
        if (!this.useNewPassword) return;
        try {
            this.host.plugin.validateNewCredentialName(this.newCredentialName);
            this.nameFeedback?.setText('');
            this.nameInput?.setAttribute('aria-invalid', 'false');
        } catch (error) {
            this.nameFeedback?.setText(errorMessage(error));
            this.nameInput?.setAttribute('aria-invalid', 'true');
        }
    }

    private refreshCredentialOptions() {
        if (!this.secretPicker) return;
        this.secretPicker.selectEl.empty();
        let ids: string[] = [];
        try { ids = this.host.app.secretStorage.listSecrets(); } catch { /* unavailable entries remain visible */ }
        if (this.selectedSecretId && !ids.includes(this.selectedSecretId)) ids.push(this.selectedSecretId);
        for (const id of ids.sort((a, b) => a.localeCompare(b))) this.secretPicker.addOption(id, id);
        this.secretPicker.setValue(this.selectedSecretId);
        this.secretPicker.selectEl.title = this.selectedSecretId;
        this.secretPicker.selectEl.hidden = !ids.length;
        if (this.savedLabel) this.savedLabel.hidden = !ids.length;
        if (this.selectionHint) {
            this.selectionHint.dataset.empty = String(!ids.length);
            this.selectionHint.setText(ids.length ? t('请选择已有 Keychain', 'Choose a saved Keychain') : t('尚无已保存的 Keychain', 'No saved Keychains yet'));
            this.selectionHint.hidden = !!this.selectedSecretId;
        }
    }

    private updateCredentialDetails() {
        const id = this.host.plugin.settings.secretId;
        const changing = !!id && (this.useNewPassword || this.selectedSecretId !== id);
        if (this.credentialDetails) this.credentialDetails.hidden = !changing;
        if (this.credentialName) { this.credentialName.setText(id); this.credentialName.hidden = !changing; }
        let available = false;
        try { available = !!this.selectedSecretId && !!this.host.app.secretStorage.getSecret(this.selectedSecretId); } catch { /* show actionable error */ }
        if (this.credentialWarning) {
            this.credentialWarning.hidden = this.useNewPassword || !this.selectedSecretId || available;
            this.credentialWarning.setText(t('此 Keychain 的密码不可用。请选择其他已保存的 Keychain，或新建 Keychain。', 'Password unavailable for this Keychain. Choose another saved Keychain or create a new one.'));
        }
        if (this.selectionHint) this.selectionHint.hidden = !!this.selectedSecretId;
    }

    private updateCredentialControls() {
        this.controls.forEach(input => input.disabled = this.saving);
        if (this.existingControls) this.existingControls.hidden = this.useNewPassword;
        if (this.passwordControls) this.passwordControls.hidden = !this.useNewPassword;
        if (this.passwordInput) this.passwordInput.disabled = !this.useNewPassword || this.saving;
        if (this.nameInput) this.nameInput.disabled = !this.useNewPassword || this.saving;
        this.secretPicker?.setDisabled(this.useNewPassword || this.saving);
        if (this.cancelCheckButton) this.cancelCheckButton.buttonEl.hidden = !this.saving || this.committing;
        this.saveConnectionButton?.setButtonText(this.useNewPassword
            ? t('创建 Keychain 并保存连接', 'Create Keychain and save connection')
            : t('验证并保存连接', 'Verify and save connection'));
        this.updateCredentialDetails();
    }

    private resetCredentialSelection() {
        const { settings } = this.host.plugin;
        const originalIdentity = this.username.trim() === settings.username
            && this.serverOrigin(this.url) === this.serverOrigin(settings.webDavUrl);
        this.selectedSecretId = originalIdentity ? settings.secretId : '';
        this.refreshCredentialOptions();
        this.updateCredentialDetails();
    }

    private async checkConnection(save: boolean) {
        const { plugin, app } = this.host;
        if (!this.status || this.saving) return;
        if (plugin.connectionSaving) {
            this.status.setText(plugin.connectionOperation === 'test'
                ? t('其他窗口正在测试连接，请完成或取消该检查。', 'Another window is testing a connection. Finish or cancel that check.')
                : t('正在保存连接，请稍候。', 'Connection is being saved. Please wait.'));
            return;
        }
        if (plugin.syncing) {
            this.status.setText(t('请等待当前刷新完成后再修改连接。', 'Wait for the current refresh before changing the connection.'));
            return;
        }
        const activeOwner = this.host.ensureOwner(this.resetDraft);
        const controller = new AbortController();
        const active = () => this.host.isCurrentOwner(activeOwner) && !controller.signal.aborted;
        const token = plugin.beginConnectionOperation(save);
        if (!token) return;
        const cancel = () => {
            if (this.committing || this.cancelOperation !== cancel) return;
            controller.abort();
            this.cancelOperation = null;
            this.saving = false;
            plugin.endConnectionOperation(token);
            this.controls.forEach(input => input.disabled = false);
            this.updateCredentialControls();
        };
        this.cancelOperation = cancel;
        this.saving = true;
        this.committing = false;
        this.controls.forEach(input => input.disabled = true);
        this.secretPicker?.setDisabled(true);
        this.updateCredentialControls();
        this.status.setText(t('正在验证连接…', 'Checking connection…'));
        try {
            if (!this.useNewPassword && !this.selectedSecretId) {
                throw new UserError(t('尚未选择凭据。请选择已有条目，或点击“新建 Keychain”。', 'No credential selected. Choose an existing entry or select New Keychain.'));
            }
            const webDavUrl = normalizeWebDavUrl(this.url);
            const account = this.username.trim();
            const existingSecretId = this.useNewPassword ? '' : this.selectedSecretId;
            let newName: string | undefined;
            if (this.useNewPassword) {
                try { newName = plugin.validateNewCredentialName(this.newCredentialName); }
                catch (error) { this.updateNameFeedback(); this.nameInput?.focus(); throw error; }
            }
            if (!account) throw new UserError(t('请填写账号。', 'Enter your username.'));
            const testPassword = this.useNewPassword ? this.password : (existingSecretId ? app.secretStorage.getSecret(existingSecretId) : '');
            if (!testPassword) {
                throw new UserError(this.useNewPassword ? t('请填写新密码。', 'Enter your new password.') : t('请选择可用凭据，或使用新密码。', 'Choose an available credential or use a new password.'));
            }
            const files = await WebDAVClient.testConnection(webDavUrl, account, testPassword, controller.signal);
            if (!active()) return;
            const count = files.filter(file => !file.isCollection && new URL(file.href).pathname.toLowerCase().endsWith('.an')).length;
            if (!save) {
                this.status.dataset.state = 'tested';
                this.status.setText(t('连接成功，发现 ', 'Connection successful; found ') + count + t(' 个笔记文件。', ' annotation files.') +
                    (this.hasDraftChanges() ? t(' 修改尚未保存。', ' Changes not saved.') : '') + (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.')));
                return;
            }
            if (plugin.syncing) throw new UserError(t('刷新正在进行，请稍后重新保存。', 'A refresh is running. Save again after it finishes.'));
            this.status.dataset.state = 'saving';
            this.status.setText(t('连接已验证，正在等待保存…', 'Connection verified; waiting to save…'));
            const committed = await plugin.saveConnection(webDavUrl, account, testPassword, active, existingSecretId || undefined, newName, () => {
                this.status?.setText(t('正在保存连接…', 'Saving connection…'));
                this.committing = true;
                this.updateCredentialControls();
            });
            if (!committed || !active()) return;
            this.updateCredentialDetails();
            this.password = '';
            if (this.passwordInput) this.passwordInput.value = '';
            this.newCredentialName = '';
            if (this.nameInput) this.nameInput.value = '';
            this.selectedSecretId = plugin.settings.secretId;
            this.refreshCredentialOptions();
            this.useNewPassword = false;
            this.updateCredentialControls();
            this.status.dataset.state = 'saved';
            this.status.setText(t('连接成功并已保存，发现 ', 'Connection saved; found ') + count + t(' 个笔记文件。', ' annotation files.') +
                (count ? '' : t(' 请确认备份目录。', ' Check the backup folder.')));
        } catch (error) {
            if (active()) {
                this.status.dataset.state = 'error';
                this.status.setText(errorMessage(error) + ' ' + t('连接配置未更改。', 'Connection settings were not changed.'));
            }
        } finally {
            if (this.cancelOperation === cancel) {
                this.cancelOperation = null;
                this.saving = false;
                this.committing = false;
                plugin.endConnectionOperation(token);
                if (!active()) this.resetDraft();
                this.updateCredentialControls();
            }
            if (active() && this.useNewPassword) {
                this.updateNameFeedback();
                if (this.nameInput?.getAttribute('aria-invalid') === 'true') this.nameInput.focus();
            }
        }
    }

    private renderUrlField(setting: Setting) {
        const { plugin } = this.host;
        if (!this.host.hasOwner()) this.resetDraft();
        const currentOwner = this.host.ensureOwner(this.resetDraft);
        this.controls.clear();
        setting.settingEl.parentElement?.addClass('moonreader-connection-card');
        setting.settingEl.parentElement?.parentElement?.addClass('moonreader-connection-group');
        const card = setting.settingEl.parentElement;
        if (!this.host.connectionOnly && card?.parentElement && plugin.configured() && !card.closest('.moonreader-saved-connection')) {
            const disclosure = card.parentElement.createEl('details', { cls: 'moonreader-saved-connection' });
            card.before(disclosure);
            const summary = disclosure.createEl('summary');
            const updateSummary = () => summary.setText(t('已保存 · ', 'Saved · ') +
                this.serverOrigin(plugin.settings.webDavUrl) + ' · ' + plugin.settings.username);
            updateSummary();
            plugin.listeners.add(updateSummary);
            currentOwner.register(() => plugin.listeners.delete(updateSummary));
            disclosure.appendChild(card);
        }
        setting.settingEl.addClass('moonreader-connection-field');
        setting.settingEl.addClass('moonreader-connection-url');
        setting.addText(text => {
            this.urlInput = text.inputEl;
            this.controls.add(text.inputEl);
            text.setValue(this.url).setPlaceholder('https://…/dav/Books/.Notes/').onChange(value => {
                const changedServer = this.serverOrigin(value) !== this.serverOrigin(this.url);
                this.url = value;
                if (changedServer) this.resetCredentialSelection();
                this.updateDirtyStatus();
            });
        });
        return () => { if (this.host.isCurrentOwner(currentOwner)) this.host.onHide(); };
    }

    private renderUsernameField(setting: Setting) {
        setting.settingEl.addClass('moonreader-connection-field');
        setting.addText(text => {
            this.host.ensureOwner(this.resetDraft);
            this.usernameInput = text.inputEl;
            this.controls.add(text.inputEl);
            text.setValue(this.username).onChange(value => {
                const changedAccount = value.trim() !== this.username.trim();
                this.username = value;
                if (changedAccount) this.resetCredentialSelection();
                this.updateDirtyStatus();
            });
        });
    }

    private renderCredentialField(setting: Setting) {
        const { plugin } = this.host;
        this.host.ensureOwner(this.resetDraft);
        setting.settingEl.addClass('moonreader-keychain');
        const section = setting.controlEl.createDiv({ cls: 'moonreader-credential-controls' });
        this.credentialDetails = section.createDiv({ cls: 'moonreader-credential', attr: { 'aria-live': 'polite' } });
        const heading = this.credentialDetails.createDiv({ cls: 'moonreader-credential-heading' });
        heading.createSpan({ text: t('当前使用', 'Currently using') });
        this.credentialName = this.credentialDetails.createEl('code', { cls: 'moonreader-credential-name' });
        this.existingControls = section.createDiv({ cls: 'moonreader-existing-credential' });
        this.savedLabel = this.existingControls.createEl('label', { cls: 'moonreader-saved-label', text: t('已保存的 Keychain', 'Saved Keychains') });
        this.selectionHint = this.existingControls.createDiv({ cls: 'moonreader-selection-hint', attr: { 'aria-live': 'polite' } });
        const picker = new DropdownComponent(this.existingControls).onChange(value => {
            if (this.useNewPassword || this.saving || plugin.connectionSaving) return;
            this.selectedSecretId = value;
            picker.selectEl.title = value;
            this.updateDirtyStatus();
            this.updateCredentialDetails();
        });
        this.secretPicker = picker;
        picker.selectEl.setAttribute('aria-label', t('已保存的 Keychain', 'Saved Keychains'));
        this.savedLabel.appendChild(picker.selectEl);
        this.refreshCredentialOptions();
        picker.selectEl.addEventListener('focus', () => {
            if (!this.saving && !this.useNewPassword) this.refreshCredentialOptions();
        });
        const usePasswordButton = new ButtonComponent(this.existingControls).setButtonText(t('新建 Keychain', 'New Keychain')).onClick(() => {
            if (this.saving || plugin.connectionSaving) return;
            try {
                this.newCredentialName = plugin.suggestCredentialName(this.url);
                if (this.nameInput) this.nameInput.value = this.newCredentialName;
                this.useNewPassword = true;
                this.updateDirtyStatus();
                this.updateCredentialControls();
                this.updateNameFeedback();
                this.nameInput?.focus();
                this.nameInput?.select();
            } catch (error) { this.status?.setText(errorMessage(error)); }
        });
        this.controls.add(usePasswordButton.buttonEl);
        this.existingControls.appendChild(this.selectionHint);
        this.credentialWarning = section.createDiv({ cls: 'moonreader-credential-warning', attr: { role: 'status' } });
        this.renderNewPasswordControls(section, usePasswordButton);
        this.updateCredentialControls();
    }

    private renderNewPasswordControls(section: HTMLElement, usePasswordButton: ButtonComponent) {
        const { plugin } = this.host;
        this.passwordControls = section.createDiv({ cls: 'moonreader-new-password' });
        this.passwordControls.createDiv({ cls: 'moonreader-credential-heading', text: t('新建 Keychain', 'New Keychain') });
        const nameLabel = this.passwordControls.createEl('label', { text: t('Keychain 名称', 'Keychain name') });
        const nameField = new TextComponent(nameLabel).setPlaceholder('moonreader-home-nas').onChange(value => {
            this.newCredentialName = value;
            this.updateDirtyStatus();
            this.updateNameFeedback();
            this.updateCredentialDetails();
        });
        this.nameInput = nameField.inputEl;
        this.nameInput.maxLength = 64;
        this.nameInput.autocomplete = 'off';
        this.nameInput.spellcheck = false;
        this.nameInput.setAttribute('aria-label', t('Keychain 名称', 'Keychain name'));
        this.controls.add(this.nameInput);
        this.passwordControls.createDiv({ cls: 'moonreader-credential-help', text: t('可修改建议名称。支持小写字母、数字和连字符，最多 64 字符。', 'Edit the suggested name. Use lowercase letters, numbers and dashes, up to 64 characters.') });
        this.nameFeedback = this.passwordControls.createDiv({ cls: 'moonreader-credential-name-error', attr: { 'aria-live': 'polite' } });
        const label = this.passwordControls.createEl('label', { text: t('新密码或应用密码', 'New password or app password') });
        const input = new TextComponent(label).onChange(value => { this.password = value; this.updateDirtyStatus(); });
        this.passwordInput = input.inputEl;
        this.passwordInput.type = 'password';
        this.passwordInput.autocomplete = 'new-password';
        input.setPlaceholder(t('输入密码或应用密码', 'Enter password or app password'));
        this.passwordInput.setAttribute('aria-label', t('新密码或应用密码', 'New password or app password'));
        this.controls.add(this.passwordInput);
        this.passwordControls.createDiv({ cls: 'moonreader-credential-help', text: t('点击下方“创建 Keychain 并保存连接”完成保存；测试不会创建凭据。', 'Use “Create Keychain and save connection” below to save. Testing does not create a credential.') });
        const cancelButton = new ButtonComponent(this.passwordControls).setButtonText(t('取消新建', 'Cancel creation')).onClick(() => {
            if (this.saving || plugin.connectionSaving) return;
            this.password = '';
            if (this.passwordInput) this.passwordInput.value = '';
            this.newCredentialName = '';
            if (this.nameInput) this.nameInput.value = '';
            this.nameFeedback?.setText('');
            this.useNewPassword = false;
            this.updateDirtyStatus();
            this.updateCredentialControls();
            usePasswordButton.buttonEl.focus();
        });
        this.controls.add(cancelButton.buttonEl);
    }

    private renderActionsField(setting: Setting) {
        const { plugin } = this.host;
        this.host.ensureOwner(this.resetDraft);
        setting.settingEl.addClass('moonreader-connection-actions');
        setting.addButton(button => {
            this.controls.add(button.buttonEl);
            button.setButtonText(t('测试连接', 'Test connection')).onClick(() => { void this.checkConnection(false); });
            const testAction = setting.controlEl.createDiv({ cls: 'moonreader-test-action' });
            testAction.appendChild(button.buttonEl);
            testAction.createDiv({ cls: 'moonreader-test-hint', text: t('仅测试，不保存', 'Test only; does not save') });
        }).addButton(button => {
            this.saveConnectionButton = button;
            this.controls.add(button.buttonEl);
            button.buttonEl.dataset.action = 'save-connection';
            button.setCta().onClick(() => { void this.checkConnection(true); });
        });
        setting.addButton(button => {
            this.cancelCheckButton = button;
            button.setButtonText(t('取消检查', 'Cancel check')).onClick(() => {
                if (!this.cancelOperation || this.committing) return;
                this.cancelOperation();
                if (this.status) {
                    this.status.dataset.state = 'cancelled';
                    this.status.setText(t('检查已取消，连接未更改。', 'Check cancelled. Connection settings were not changed.'));
                }
            });
        });
        this.updateCredentialControls();
        this.status = setting.controlEl.createDiv({ cls: 'moonreader-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.status.dataset.state = plugin.configured() ? 'saved' : 'empty';
        this.status.setText(this.saving ? t('正在保存连接…', 'Saving connection…') : plugin.connectionStatus());
    }

    definition(): SettingDefinitionItem {
        return {
            type: 'group',
            cls: 'moonreader-settings',
            heading: t('备份连接', 'Backup connection'),
            items: [
                {
                    name: t('WebDAV 目录地址', 'WebDAV folder URL'),
                    desc: t('填写包含 .an 备份文件的目录地址。', 'Folder URL containing your .an backup files.'),
                    render: setting => this.renderUrlField(setting)
                },
                {
                    name: t('账号', 'Username'),
                    desc: t('用于访问此 WebDAV 目录。', 'Account used to access this folder.'),
                    render: setting => this.renderUsernameField(setting)
                },
                {
                    name: t('连接凭据', 'Connection credential'),
                    desc: t('选择此账号使用的已有 Keychain，或新建并保存密码。', 'Choose a saved Keychain for this account or create one to save its password.'),
                    render: setting => this.renderCredentialField(setting)
                },
                {
                    name: t('测试和保存连接', 'Test and save connection'),
                    render: setting => this.renderActionsField(setting)
                }
            ]
        };
    }
}
