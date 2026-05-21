import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { CryptoHelper } from '../utils/crypto';
import { TemplateBuilderUI } from './templateBuilder';

export class MoonReaderWebDAVSettingTab extends PluginSettingTab {
    plugin: MoonReaderSyncPlugin;

    constructor(app: App, plugin: MoonReaderSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'MoonReader WebDAV Sync Settings'});

        // Security
        containerEl.createEl('h3', {text: 'Security (Desktop Only)'});
        new Setting(containerEl)
            .setName('Local AES Key Path')
            .setDesc('Path to store the AES key. Must be OUTSIDE the Vault for security. E.g., C:/Users/name/.moonreader_key')
            .addText(text => text
                .setPlaceholder('Enter path for key')
                .setValue(this.plugin.settings.keyFilePath)
                .onChange(async (value) => {
                    this.plugin.settings.keyFilePath = value;
                    await this.plugin.saveSettings();
                })
            )
            .addButton(btn => btn
                .setButtonText('Generate Key')
                .onClick(async () => {
                    if (!this.plugin.settings.keyFilePath) {
                        new Notice("Please enter a key path first!");
                        return;
                    }
                    const success = await CryptoHelper.generateAndSaveKey(this.plugin.settings.keyFilePath);
                    if (success) {
                        new Notice(`Key generated and saved to ${this.plugin.settings.keyFilePath}`);
                    } else {
                        new Notice("Failed to generate key. Check console for details.");
                    }
                })
            );

        // WebDAV
        containerEl.createEl('h3', {text: 'WebDAV Configuration'});
        
        new Setting(containerEl)
            .setName('WebDAV URL')
            .setDesc('Full URL to the folder containing your .an files (e.g. https://.../dav/Books/.Moon+/Cache)')
            .addText(text => text
                .setPlaceholder('https://dav.server.com/dav/Books/.Notes/')
                .setValue(this.plugin.settings.webDavUrl)
                .onChange(async (value) => {
                    this.plugin.settings.webDavUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Username')
            .addText(text => text
                .setValue(this.plugin.settings.username)
                .onChange(async (value) => {
                    this.plugin.settings.username = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Password')
            .setDesc('Will be encrypted using the Local AES Key.')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('Enter password');
                text.onChange(async (value) => {
                    if (value && this.plugin.settings.keyFilePath) {
                        try {
                            const encrypted = await CryptoHelper.encrypt(value, this.plugin.settings.keyFilePath);
                            this.plugin.settings.encryptedPass = encrypted;
                            await this.plugin.saveSettings();
                            new Notice("Password encrypted and saved.");
                        } catch (e) {
                            new Notice("Failed to encrypt password. Is the key path valid?");
                        }
                    } else if (value && !this.plugin.settings.keyFilePath) {
                        new Notice("Please configure Local AES Key Path first.");
                    }
                });
            });

        // UI & Behavior
        containerEl.createEl('h3', {text: 'Behavior & UI'});
        
        new Setting(containerEl)
            .setName('Enable Hover Preview')
            .setDesc('Show rendered notes preview when hovering over a book')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableHoverPreview)
                .onChange(async (value) => {
                    this.plugin.settings.enableHoverPreview = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Insert Action')
            .addDropdown(dropdown => dropdown
                .addOption('ask', 'Ask Every Time')
                .addOption('append', 'Always Append')
                .addOption('overwrite', 'Always Overwrite (Preserves Frontmatter)')
                .setValue(this.plugin.settings.insertAction)
                .onChange(async (value: "ask"|"append"|"overwrite") => {
                    this.plugin.settings.insertAction = value;
                    await this.plugin.saveSettings();
                }));

        // Template
        containerEl.createEl('h3', {text: 'Template Builder'});
        
        TemplateBuilderUI.build(
            containerEl, 
            this.app, 
            this.plugin, 
            this.plugin.settings.noteTemplate, 
            async (value) => {
                this.plugin.settings.noteTemplate = value;
                await this.plugin.saveSettings();
            }
        );
    }
}
