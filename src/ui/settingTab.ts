import { App, ButtonComponent, Component, PluginSettingTab, Setting, SettingGroup, type SettingDefinitionItem } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import { ConnectionSection } from './connectionSection';
import { NotePreview, TemplateBuilderUI } from './templateBuilder';
import { sortPreference } from './sortPreference';
import { renderNotes } from '../utils/notes';
import { t, errorMessage, UserError } from '../i18n';

export class MoonReaderWebDAVSettingTab extends PluginSettingTab {
    private owner: Component | null = null;
    private connection: ConnectionSection | null = null;
    private resetDraft: (() => void) | null = null;
    get saving(): boolean { return this.connection?.saving ?? false; }
    constructor(app: App, private plugin: MoonReaderSyncPlugin, private browse = () => plugin.openLibrary(), private connectionOnly = false) { super(app, plugin); }
    hide() { this.connection?.cancel(); this.owner?.unload(); this.owner = null; this.resetDraft?.(); }
    getSettingDefinitions(): SettingDefinitionItem[] {
        // Indexing creates definitions only. Drafts and rendering have no persistence side effects.
        const ensureOwner = () => {
            if (!this.owner) { this.owner = new Component(); this.owner.load(); }
            return this.owner;
        };
        const connection = new ConnectionSection({
            app: this.app,
            plugin: this.plugin,
            connectionOnly: this.connectionOnly,
            hasOwner: () => this.owner !== null,
            ensureOwner: reset => {
                this.connection = connection;
                this.resetDraft = reset;
                return ensureOwner();
            },
            isCurrentOwner: owner => this.owner === owner,
            onHide: () => this.hide()
        });
        const definitions: SettingDefinitionItem[] = [connection.definition()];
        if (this.connectionOnly) {
            definitions.push({
                name: t('返回书库', 'Back to library'),
                render: setting => {
                    setting.settingEl.addClass('moonreader-back-to-library');
                    setting.addButton(button => button.setButtonText(t('返回书库', 'Back to library')).onClick(() => this.browse()));
                }
            });
            return definitions;
        }
        definitions.push({
            type: 'group',
            cls: 'moonreader-settings',
            heading: t('书库显示', 'Library display'),
            items: [
                {
                    name: t('阅读笔记', 'Reading notes'),
                    desc: t('浏览缓存书籍并插入当前笔记。', 'Browse cached books and insert into the current note.'),
                    render: setting => { setting.addButton(button => button.setButtonText(t('浏览书籍', 'Browse books')).onClick(() => this.browse())); }
                },
                {
                    name: t('默认书籍排序', 'Default book order'),
                    desc: t('在书库中更改也会更新此默认值。', 'Changing this in the library also updates the default.'),
                    render: setting => {
                        const feedback = setting.descEl.createDiv({ attr: { role: 'status' } });
                        setting.addDropdown(dropdown => sortPreference(this.plugin, ensureOwner(), dropdown, 'book', feedback));
                    }
                },
                {
                    name: t('显示书籍数量', 'Books shown'),
                    desc: t('0 表示全部。先搜索和排序，再限制显示数量；不影响备份下载。', '0 shows all books. Search and sort are applied before this limit; downloads are unaffected.'),
                    render: setting => {
                        const feedback = setting.descEl.createDiv({ cls: 'moonreader-preference-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
                        let editRevision = 0;
                        setting.addText(text => {
                            text.inputEl.type = 'number';
                            text.inputEl.min = '0';
                            text.inputEl.step = '1';
                            text.setValue(String(this.plugin.settings.bookListLimit)).onChange(async value => {
                                const revision = ++editRevision;
                                const limit = /^\d+$/.test(value) ? Number(value) : NaN;
                                if (!Number.isSafeInteger(limit)) {
                                    feedback.setText(t('请输入非负整数，0 表示全部书籍。', 'Enter a non-negative integer. Use 0 for all books.'));
                                    return;
                                }
                                try {
                                    await this.plugin.updateSettings({ bookListLimit: limit });
                                    this.plugin.notify();
                                    if (revision === editRevision) {
                                        text.setValue(String(this.plugin.settings.bookListLimit));
                                        feedback.setText(t('已保存。', 'Saved.'));
                                    }
                                } catch (error) {
                                    if (revision === editRevision) {
                                        feedback.setText(errorMessage(error));
                                        text.setValue(String(this.plugin.settings.bookListLimit));
                                    }
                                }
                            });
                        });
                    }
                }
            ]
        });
        definitions.push({
            type: 'group',
            cls: 'moonreader-settings',
            heading: t('导入方式', 'Note insertion'),
            items: [
                {
                    name: t('默认笔记排序', 'Default note order'),
                    desc: t('在书库中更改也会更新此默认值。', 'Changing this in the library also updates the default.'),
                    render: setting => {
                        const feedback = setting.descEl.createDiv({ attr: { role: 'status' } });
                        setting.addDropdown(dropdown => sortPreference(this.plugin, ensureOwner(), dropdown, 'note', feedback));
                    }
                },
                {
                    name: t('默认写入方式', 'Default import mode'),
                    desc: t('每次导入都会展示目标。替换正文始终需要确认。', 'Every import shows its destination. Replacing the body always requires confirmation.'),
                    render: setting => {
                        const feedback = setting.descEl.createDiv({ cls: 'moonreader-preference-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
                        let editRevision = 0;
                        setting.addDropdown(dropdown => dropdown
                            .addOption('ask', t('当前笔记光标处', 'Current note cursor'))
                            .addOption('append', t('文末追加', 'Append'))
                            .setValue(this.plugin.settings.insertAction)
                            .onChange(async value => {
                                if (value !== 'ask' && value !== 'append') return;
                                const revision = ++editRevision;
                                try {
                                    await this.plugin.updateSettings({ insertAction: value });
                                    if (revision === editRevision) {
                                        dropdown.setValue(value);
                                        feedback.setText(t('已保存。', 'Saved.'));
                                    }
                                } catch (error) {
                                    if (revision === editRevision) {
                                        feedback.setText(errorMessage(error));
                                        dropdown.setValue(this.plugin.settings.insertAction);
                                    }
                                }
                            }));
                    }
                }
            ]
        });
        definitions.push({
            type: 'group',
            cls: 'moonreader-settings',
            heading: t('笔记模板', 'Note template'),
            items: [
                {
                    name: t('默认笔记模板', 'Default note template'),
                    render: setting => {
                        const currentOwner = ensureOwner();
                        setting.settingEl.addClass('moonreader-template-setting');
                        const section = setting.controlEl.createEl('details', { cls: 'moonreader-settings-template' });
                        section.createEl('summary', { text: t('调整模板', 'Adjust template') });
                        let template = this.plugin.settings.noteTemplate;
                        const editor = section.createDiv();
                        section.createEl('p', { cls: 'moonreader-meta', text: t('此处使用示例内容；导入时预览所选书籍的真实笔记。', 'Sample content below; importing previews the selected book’s actual notes.') });
                        const preview = currentOwner.addChild(new NotePreview(this.app, section.createDiv({ cls: 'moonreader-preview' })));
                        TemplateBuilderUI.build(editor, template, value => {
                            template = value;
                            void preview.render(renderNotes(TemplateBuilderUI.sample(), template), '');
                        });
                        void preview.render(renderNotes(TemplateBuilderUI.sample(), template), '');
                        const feedback = section.createDiv({ cls: 'moonreader-preference-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
                        new ButtonComponent(section).setButtonText(t('保存默认模板', 'Save default template')).onClick(async () => {
                            try {
                                if (!template.trim()) throw new UserError(t('模板不能为空。', 'The template cannot be empty.'));
                                await this.plugin.updateSettings({ noteTemplate: template });
                                this.plugin.notify();
                                feedback.setText(t('默认模板已保存。', 'Default template saved.'));
                            } catch (error) { feedback.setText(errorMessage(error)); }
                        });
                    }
                }
            ]
        });
        return definitions;
    }
    // The connection modal shares these definitions without participating in settings navigation.
    renderConnection() {
        this.hide();
        this.containerEl.empty();
        this.containerEl.addClass('moonreader-settings');
        for (const definition of this.getSettingDefinitions()) {
            if ('type' in definition && definition.type === 'group') {
                const group = new SettingGroup(this.containerEl).setHeading(definition.heading || '');
                for (const item of definition.items || []) {
                    if ('render' in item && item.render) item.render(new Setting(group.listEl).setName(item.name).setDesc(item.desc || ''), group);
                }
            } else if ('render' in definition && definition.render) {
                const group = new SettingGroup(this.containerEl);
                definition.render(new Setting(group.listEl).setName(definition.name), group);
            }
        }
    }
}
