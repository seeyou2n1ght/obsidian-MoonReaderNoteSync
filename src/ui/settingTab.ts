import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { TemplateBuilderUI } from './templateBuilder';
import { DEFAULT_SETTINGS } from '../settings';

export class MoonReaderWebDAVSettingTab extends PluginSettingTab {
    plugin: MoonReaderSyncPlugin;

    constructor(app: App, plugin: MoonReaderSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        // WebDAV
        new Setting(containerEl).setName('🌐 WebDAV Configuration').setHeading();
        
        new Setting(containerEl)
            .setName('WebDAV URL')
            .setDesc((() => {
                const frag = activeDocument.createDocumentFragment();
                frag.appendText('Full URL to the folder containing your .an files. ');
                frag.createEl('a', { 
                    text: 'How to configure?', 
                    href: 'https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync#1-security--webdav'
                });
                return frag;
            })())
            .addText(text => text
                .setPlaceholder('https://dav.server.com/dav/Books/.Notes/')
                .setValue(this.plugin.settings.webDavUrl)
                .onChange((value) => {
                    this.plugin.settings.webDavUrl = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Username')
            .addText(text => text
                .setValue(this.plugin.settings.username)
                .onChange((value) => {
                    this.plugin.settings.username = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Password')
            .setDesc('Your password is kept secure in the OS keychain (macOS/iOS Keychain, Windows Credential Manager, Android Keystore) and will NOT be synced in plaintext via data.json.')
            .addText(text => {
                text.inputEl.type = 'password';
                const hasPassword = this.app.secretStorage && this.app.secretStorage.getSecret("webdav-password");
                text.setPlaceholder(hasPassword ? 'Password configured (type to replace)' : 'Enter password');
                
                text.onChange((value) => {
                    if (value && this.app.secretStorage) {
                        this.app.secretStorage.setSecret("webdav-password", value);
                        new Notice("Password saved to native Keychain.");
                    }
                });
            });

        new Setting(containerEl)
            .setName('Test Connection')
            .setDesc('Verify your WebDAV URL and credentials')
            .addButton(btn => btn
                .setButtonText('Test Connection')
                .setCta()
                .onClick(async () => {
                    btn.setButtonText('Testing...');
                    const { WebDAVClient } = await import('../utils/webdav');
                    const client = new WebDAVClient(this.app, this.plugin.settings.webDavUrl, this.plugin.settings.username);
                    const success = await client.testConnection();
                    if (success) {
                        new Notice("Connection successful!");
                    } else {
                        new Notice("Connection failed. Please check your URL, username, and password.");
                    }
                    btn.setButtonText('Test Connection');
                })
            );

        // UI & Behavior
        new Setting(containerEl).setName('⚙️ Import Behavior').setHeading();
        
        new Setting(containerEl)
            .setName('Enable Hover Preview')
            .setDesc('Show rendered notes preview when hovering over a book')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableHoverPreview)
                .onChange((value) => {
                    this.plugin.settings.enableHoverPreview = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Insert Action')
            .addDropdown(dropdown => dropdown
                .addOption('ask', 'Ask Every Time')
                .addOption('append', 'Always Append')
                .addOption('overwrite', 'Always Overwrite (Preserves Frontmatter)')
                .setValue(this.plugin.settings.insertAction)
                .onChange((value: string) => {
                    this.plugin.settings.insertAction = value as "ask"|"append"|"overwrite";
                    void this.plugin.saveSettings();
                }));

        // Template
        new Setting(containerEl).setName('🎨 Note Template Design').setHeading();
        
        TemplateBuilderUI.build(
            containerEl, 
            this.app, 
            this.plugin, 
            this.plugin.settings.noteTemplate, 
            (value) => {
                this.plugin.settings.noteTemplate = value;
                void this.plugin.saveSettings();
            }
        );

        new Setting(containerEl)
            .setName('Restore Default Template')
            .setDesc('Reset the template back to the default factory settings.')
            .addButton(btn => btn
                .setButtonText('Restore')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.noteTemplate = DEFAULT_SETTINGS.noteTemplate;
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice("Template restored to default.");
                })
            );
    }
}
