import { App, ButtonComponent, Component, MarkdownView, Menu, Notice, TFile } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import type { BookItem } from '../utils/notes';
import { mergeNote } from '../utils/notes';
import { FileSuggestModal } from './fileSuggestModal';
import { NotePreview, TemplateBuilderUI } from './templateBuilder';
import { t, errorMessage, UserError } from '../i18n';

type ImportAction = 'cursor' | 'append' | 'overwrite';

// The import controls live inside the library; choosing a book never opens another modal.
export class ImportPanel extends Component {
    private template: string;
    private target: TFile | null;
    private originalFile: TFile | null;
    private action: ImportAction;
    private book: BookItem | null = null;
    private initialEditorText: string | null;
    private initialCursor: { line: number; ch: number } | null;
    private preview!: NotePreview;
    private heading!: HTMLElement;
    private meta!: HTMLElement;
    private warning!: HTMLElement;
    private status!: HTMLElement;
    private targetLabel!: HTMLElement;
    private modeLabel!: HTMLElement;
    private confirmation!: HTMLElement;
    private templateDetails!: HTMLDetailsElement;
    private primary!: ButtonComponent;
    private more!: ButtonComponent;
    private recovery!: ButtonComponent;
    private menu: Menu | null = null;
    private active = false;
    busy = false;
    private completed = false;
    private repeatConfirmation = false;

    constructor(private app: App, private plugin: MoonReaderSyncPlugin, private content: HTMLElement,
        private footer: HTMLElement, private view: MarkdownView | null, private done: () => void,
        private changed: () => void) {
        super();
        this.template = plugin.settings.noteTemplate;
        this.originalFile = this.target = view?.file || null;
        this.action = this.target && plugin.settings.insertAction !== 'append' ? 'cursor' : 'append';
        this.initialEditorText = view?.editor.getValue() ?? null;
        this.initialCursor = view?.editor.getCursor('head') ?? null;
    }
    onload() {
        this.active = true;
        this.heading = this.content.createEl('h3', { cls: 'moonreader-book-title' });
        this.meta = this.content.createDiv({ cls: 'moonreader-meta' });
        this.warning = this.content.createDiv({ cls: 'moonreader-warning' });
        this.preview = this.addChild(new NotePreview(this.app, this.content.createDiv({ cls: 'moonreader-preview moonreader-book-preview' })));
        this.templateDetails = this.content.createEl('details', { cls: 'moonreader-template-details' });
        this.templateDetails.createEl('summary', { text: t('调整模板', 'Adjust template') });
        const editorContainer = this.templateDetails.createDiv();
        TemplateBuilderUI.build(editorContainer, this.template, value => {
            this.template = value; this.updatePreview(); this.updateButton();
        });
        new ButtonComponent(editorContainer).setButtonText(t('保存为默认模板', 'Save as default template')).onClick(async () => {
            try {
                if (this.busy) return;
                if (!this.template.trim()) throw new UserError(t('模板不能为空。', 'The template cannot be empty.'));
                await this.plugin.updateSettings({ noteTemplate: this.template });
                if (this.active) this.status.setText(t('默认模板已保存。', 'Default template saved.'));
            } catch (error) { if (this.active) this.status.setText(errorMessage(error)); }
        });
        const feedback = this.footer.createDiv({ cls: 'moonreader-import-feedback' });
        this.status = feedback.createDiv({ cls: 'moonreader-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.recovery = new ButtonComponent(feedback).setButtonText(t('改为文末追加', 'Use append instead')).onClick(() => this.setAction('append'));
        this.recovery.buttonEl.hidden = true;
        this.confirmation = this.footer.createDiv({ cls: 'moonreader-confirmation' });
        const actions = this.footer.createDiv({ cls: 'moonreader-import-actions' });
        const destination = actions.createDiv({ cls: 'moonreader-destination' });
        this.targetLabel = destination.createDiv();
        this.modeLabel = destination.createDiv({ cls: 'moonreader-meta' });
        this.more = new ButtonComponent(actions).setButtonText(t('更多', 'More')).setTooltip(t('更多写入选项', 'More import options')).onClick(() => this.openMenu());
        this.primary = new ButtonComponent(actions).setCta().onClick(() => {
            if (!this.target) this.chooseTarget(); else void this.submit();
        });
        this.setBook(null);
    }
    setBook(book: BookItem | null, preserveFeedback = false) {
        if (this.busy) return;
        const sameBook = this.book === book;
        this.book = book;
        if (!sameBook) {
            if (this.action === 'overwrite') this.action = 'append';
            if (!preserveFeedback) this.clearFeedback();
            this.recovery.buttonEl.hidden = true;
            this.confirmation.empty(); this.confirmation.hidden = true; this.repeatConfirmation = false;
        }
        this.heading.setText(book?.bookName || t('阅读笔记', 'Reading notes'));
        this.meta.setText(book ? book.notes.length + t(' 条笔记 · 预览前 3 条', ' notes · Preview of the first 3') : t('选择一本书以预览笔记。', 'Choose a book to preview its notes.'));
        this.updateWarning();
        this.templateDetails.hidden = !book;
        this.updatePreview(); this.updateDestination(); this.updateButton();
    }
    private updatePreview() {
        void this.preview.render(this.book ? this.plugin.renderNotes(this.book.notes.slice(0, 3), this.template) : '', this.target?.path || '');
    }
    private clearFeedback() { this.status.setText(''); this.recovery.buttonEl.hidden = true; }
    private importKey(): string { return JSON.stringify([this.plugin.cache.source, this.book?.fileHref, this.target?.path]); }
    private updateWarning() {
        const repeat = this.book && this.target && this.action !== 'overwrite' && this.plugin.sessionImports.has(this.importKey());
        this.warning.setText([this.book?.syncError || '', repeat ? t('本次会话已向此笔记导入过这本书。再次导入可能产生重复内容。', 'This book was already imported into this note during this session. Importing again may duplicate content.') : ''].filter(Boolean).join(' '));
    }
    private updateDestination() {
        this.targetLabel.setText(this.target ? this.target.path.split('/').pop()! : t('尚未选择目标笔记', 'No target note selected'));
        this.targetLabel.title = this.target?.path || '';
        this.targetLabel.setAttribute('aria-label', this.target ? t('写入 ', 'Write to ') + this.target.path : t('尚未选择目标笔记', 'No target note selected'));
        this.modeLabel.setText(!this.target ? t('没有可用的已打开笔记，选择后追加到文末', 'No open note is available; choose one to append to its end') : this.action === 'cursor' ? t('打开面板时记录的笔记光标处', 'Cursor captured when the panel opened') : this.action === 'append' ? t('文末追加', 'Append to end') : t('替换正文 · 保留 YAML 属性', 'Replace body · Preserve YAML properties'));
    }
    private updateButton() {
        const count = this.book?.notes.length || 0;
        this.primary.setButtonText(this.busy ? t('正在写入…', 'Writing…') : !this.target ? t('选择笔记', 'Choose note') :
            (this.action === 'cursor' ? t('插入 ', 'Insert ') : this.action === 'append' ? t('追加 ', 'Append ') : t('替换 ', 'Replace ')) + count + t(' 条', ' notes'));
        this.primary.setDisabled(this.busy || this.completed || !count || !this.template.trim() || this.action === 'overwrite' || this.repeatConfirmation);
        this.more.setDisabled(this.busy || !count);
        const confirm = this.confirmation.querySelector<HTMLButtonElement>('.mod-cta');
        if (confirm) confirm.disabled = this.busy || !count || !this.template.trim();
    }
    focusPrimary() { this.primary.buttonEl.focus(); }
    private setAction(action: ImportAction) {
        if (this.busy) return;
        this.action = action;
        this.clearFeedback(); this.confirmation.hidden = true; this.confirmation.empty(); this.repeatConfirmation = false;
        this.updateWarning();
        this.updateDestination(); this.updateButton();
        if (action === 'overwrite' && this.target && this.book) {
            this.confirmation.hidden = false;
            this.confirmation.createEl('p', { text: t('将替换 ', 'Replace the body of ') + this.target.path + t(' 的正文，保留 YAML 属性。', ', preserving YAML properties.') });
            new ButtonComponent(this.confirmation).setButtonText(t('取消', 'Cancel')).onClick(() => this.setAction(this.target === this.originalFile ? 'cursor' : 'append'));
            const confirm = new ButtonComponent(this.confirmation).setCta().setButtonText(t('确认替换', 'Confirm replacement')).onClick(() => { void this.submit(true); });
            confirm.setDisabled(!this.template.trim());
        }
    }
    private openMenu() {
        if (this.busy) return;
        this.menu?.hide();
        const menu = this.menu = new Menu();
        menu.addItem(item => item.setTitle(t('插入光标处', 'Insert at cursor')).setIcon('text-cursor-input').setChecked(this.action === 'cursor')
            .setDisabled(!this.target || this.target !== this.originalFile || this.view?.file !== this.originalFile).onClick(() => this.setAction('cursor')));
        menu.addItem(item => item.setTitle(t('追加到文末', 'Append to end')).setIcon('text-cursor').setChecked(this.action === 'append').onClick(() => this.setAction('append')));
        menu.addItem(item => item.setTitle(t('更换目标笔记', 'Change target note')).setIcon('file-input').onClick(() => this.chooseTarget()));
        menu.addSeparator();
        menu.addItem(item => item.setTitle(t('替换正文…', 'Replace body…')).setIcon('replace').setDisabled(!this.target).onClick(() => this.setAction('overwrite')));
        const rect = this.more.buttonEl.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
    private chooseTarget() {
        if (this.busy) return;
        new FileSuggestModal(this.app, file => {
            if (!this.active) return;
            this.target = file;
            this.setAction('append'); this.updatePreview();
        }, () => { if (this.active) this.focusPrimary(); }).open();
    }
    dismissSecondary(): boolean {
        if (!this.confirmation.hidden) { this.setAction(this.repeatConfirmation ? this.action : this.target === this.originalFile ? 'cursor' : 'append'); return true; }
        if (this.templateDetails.open) { this.templateDetails.open = false; return true; }
        return false;
    }
    async submit(confirmReplacement = false, confirmRepeat = false) {
        if (this.busy || this.completed || !this.book?.notes.length || !this.target || !this.template.trim()) return;
        if (this.action === 'overwrite' && (!confirmReplacement || this.confirmation.hidden)) return;
        if (this.action !== 'overwrite' && this.plugin.sessionImports.has(this.importKey()) && !(confirmRepeat && this.repeatConfirmation && !this.confirmation.hidden)) {
            if (this.repeatConfirmation) return;
            this.repeatConfirmation = true;
            this.confirmation.empty(); this.confirmation.hidden = false;
            this.confirmation.createEl('p', { text: t('已导入过这本书，是否仍要再次写入 ', 'This book was already imported. Write it again to ') + this.target.path + '?' });
            new ButtonComponent(this.confirmation).setButtonText(t('取消', 'Cancel')).onClick(() => this.setAction(this.action));
            new ButtonComponent(this.confirmation).setCta().setButtonText(t('仍然导入', 'Import again')).onClick(() => { void this.submit(false, true); });
            this.updateButton(); return;
        }
        const target = this.target, action = this.action, book = this.book;
        const importKey = this.importKey();
        this.busy = true; this.changed(); this.updateButton(); this.recovery.buttonEl.hidden = true;
        this.status.setText(t('正在写入…', 'Writing…'));
        this.footer.querySelectorAll<HTMLButtonElement>('button').forEach(el => el.disabled = true);
        this.content.querySelectorAll<HTMLInputElement>('button, textarea, input').forEach(el => el.disabled = true);
        try {
            if (this.app.vault.getAbstractFileByPath(target.path) !== target) throw new UserError(t('目标笔记已移动或删除，请重新选择。', 'The target note was moved or deleted. Select it again.'));
            const text = this.plugin.renderNotes(book.notes, this.template);
            if (!text.trim()) throw new UserError(t('模板生成了空内容，请调整模板。', 'The template produced empty content. Adjust the template.'));
            if (action === 'cursor') {
                if (!this.view || this.view.file !== target || !this.initialCursor || this.view.editor.getValue() !== this.initialEditorText) {
                    this.recovery.buttonEl.hidden = false;
                    throw new UserError(t('原笔记已切换或内容已变化。可改为文末追加。', 'The original note changed. You can append to the end instead.'));
                }
                this.view.editor.replaceRange(text, this.initialCursor);
            } else await this.app.vault.process(target, content => mergeNote(content, text, action));
            this.completed = true;
            this.plugin.sessionImports.add(importKey);
            new Notice(book.notes.length + t(' 条笔记已写入 ', ' notes written to ') + target.path);
        } catch (error) { if (this.active) this.status.setText(errorMessage(error)); }
        finally {
            this.busy = false;
            if (this.active) {
                this.footer.querySelectorAll<HTMLButtonElement>('button').forEach(el => el.disabled = false);
                this.content.querySelectorAll<HTMLInputElement>('button, textarea, input').forEach(el => el.disabled = false);
                this.updateButton(); this.changed();
            }
            if (this.completed && this.active) this.done();
        }
    }
    onunload() { this.active = false; this.menu?.hide(); }
}
