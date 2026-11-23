import { App, ButtonComponent, Component, DropdownComponent, MarkdownView, Menu, Notice, TFile } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import type { BookItem } from '../utils/notes';
import { mergeNote, orderedNotes, renderNotes } from '../utils/notes';
import { FileSuggestModal } from './fileSuggestModal';
import { NotePreview, TemplateBuilderUI } from './templateBuilder';
import { sortPreference } from './sortPreference';
import { t, errorMessage, UserError } from '../i18n';

type ImportAction = 'cursor' | 'append' | 'overwrite';

// The import controls live inside the library; choosing a book never opens another modal.
export class ImportPanel extends Component {
    private template: string;
    private templateDirty = false;
    private target: TFile | null;
    private originalFile: TFile | null;
    private action: ImportAction;
    private book: BookItem | null = null;
    private initialEditorText: string | null;
    private initialCursor: { line: number; ch: number } | null;
    private preview!: NotePreview;
    private body!: HTMLElement;
    private notes: BookItem['notes'] = [];
    private expanded = false;
    private toggle!: ButtonComponent;
    private heading!: HTMLElement;
    private orderSaving = false;
    private previewReady = false;
    private previewRevision = 0;
    private renderTimer?: number;
    private lastOrder?: string;
    private previewStatus!: HTMLElement;
    private previewMore!: HTMLElement;
    private previewMoreText!: HTMLElement;
    private previewMoreButton!: ButtonComponent;
    private templateToggle!: ButtonComponent;
    private templateEditor!: HTMLTextAreaElement;
    private templateReset!: ButtonComponent;
    private templateStatus!: HTMLElement;
    private meta!: HTMLElement;
    private warning!: HTMLElement;
    private status!: HTMLElement;
    private targetLabel!: HTMLElement;
    private actions!: HTMLElement;
    private confirmation!: HTMLElement;
    private templateDetails!: HTMLElement;
    private primary!: ButtonComponent;
    private modeButton!: ButtonComponent;
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
        const toolbar = this.content.createDiv({ cls: 'moonreader-preview-toolbar' });
        this.heading = toolbar.createEl('h3', { cls: 'moonreader-book-title' });
        const range = toolbar.createDiv({ cls: 'moonreader-preview-range' });
        this.meta = range.createDiv({ cls: 'moonreader-meta' });
        const controls = toolbar.createDiv({ cls: 'moonreader-preview-controls' });
        const orderLabel = controls.createEl('label', { text: t('笔记顺序 ', 'Note order ') });
        const dropdown = new DropdownComponent(orderLabel);
        dropdown.selectEl.setAttribute('aria-label', t('笔记排序', 'Note order'));
        this.toggle = new ButtonComponent(range).onClick(() => {
            this.expanded = !this.expanded; this.updatePreview(false);
        });
        this.previewStatus = range.createSpan({ cls: 'moonreader-meta moonreader-preview-status', attr: { role: 'status' } });
        this.templateToggle = new ButtonComponent(controls).setButtonText(t('调整模板', 'Adjust template')).onClick(() => {
            this.showTemplate(!!this.templateDetails.hidden);
        });
        this.templateToggle.buttonEl.setAttribute('aria-expanded', 'false');
        const sortFeedback = toolbar.createDiv({ cls: 'moonreader-meta moonreader-sort-feedback', attr: { role: 'status' } });
        this.body = this.content.createDiv({ cls: 'moonreader-reading-body' });
        this.warning = this.body.createDiv({ cls: 'moonreader-warning' });
        this.templateDetails = this.body.createDiv({ cls: 'moonreader-template-details' });
        this.templateDetails.hidden = true;
        const editorContainer = this.templateDetails;
        this.templateEditor = TemplateBuilderUI.build(editorContainer, this.template, value => {
            this.template = value;
            this.templateDirty = value !== this.plugin.settings.noteTemplate;
            this.templateStatus.setText('');
            this.updateTemplateState();
            this.updatePreview(true, this.expanded);
        });
        const templateActions = editorContainer.createDiv({ cls: 'moonreader-template-actions' });
        this.templateReset = new ButtonComponent(templateActions).setButtonText(t('恢复默认模板', 'Reset to default')).onClick(() => {
            if (this.busy) return;
            this.template = this.plugin.settings.noteTemplate;
            this.templateDirty = false;
            this.templateEditor.value = this.template;
            this.templateStatus.setText(t('已恢复为默认模板。', 'Reset to default template.'));
            this.updateTemplateState();
            this.updatePreview(true, false);
        });
        new ButtonComponent(templateActions).setButtonText(t('保存为默认模板', 'Save as default template')).onClick(async () => {
            try {
                if (this.busy) return;
                if (!this.template.trim()) throw new UserError(t('模板不能为空。', 'The template cannot be empty.'));
                await this.plugin.updateSettings({ noteTemplate: this.template });
                if (this.active) {
                    this.templateDirty = false;
                    this.templateStatus.setText(t('默认模板已保存。', 'Default template saved.'));
                    this.updateTemplateState();
                    this.plugin.notify();
                }
            } catch (error) { if (this.active) this.templateStatus.setText(errorMessage(error)); }
        });
        this.templateStatus = editorContainer.createDiv({ cls: 'moonreader-meta moonreader-template-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.updateTemplateState();
        this.preview = this.addChild(new NotePreview(this.app, this.body.createDiv({ cls: 'moonreader-preview moonreader-book-preview' })));
        this.previewMore = this.body.createDiv({ cls: 'moonreader-preview-more' });
        this.previewMoreText = this.previewMore.createSpan({ cls: 'moonreader-meta' });
        this.previewMoreButton = new ButtonComponent(this.previewMore).onClick(() => {
            this.expanded = true;
            this.updatePreview(false);
        });
        this.previewMore.hidden = true;
        const feedback = this.footer.createDiv({ cls: 'moonreader-import-feedback' });
        this.status = feedback.createDiv({ cls: 'moonreader-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.recovery = new ButtonComponent(feedback).setButtonText(t('改为文末追加', 'Use append instead')).onClick(() => this.setAction('append'));
        this.recovery.buttonEl.hidden = true;
        this.confirmation = this.footer.createDiv({ cls: 'moonreader-confirmation' });
        this.confirmation.hidden = true;
        const actions = this.footer.createDiv({ cls: 'moonreader-import-actions' });
        this.actions = actions;
        const destination = actions.createDiv({ cls: 'moonreader-destination' });
        destination.createSpan({ text: t('写入到', 'Write to'), cls: 'moonreader-meta' });
        this.targetLabel = new ButtonComponent(destination).onClick(() => this.chooseTarget()).buttonEl;
        this.modeButton = new ButtonComponent(actions).setTooltip(t('写入方式', 'Import mode')).onClick(() => this.openMenu());
        this.modeButton.buttonEl.setAttribute('aria-haspopup', 'menu');
        this.primary = new ButtonComponent(actions).setCta().onClick(() => {
            if (!this.target) this.chooseTarget(); else void this.submit();
        });
        sortPreference(this.plugin, this, dropdown, 'note', sortFeedback, saving => {
            this.orderSaving = saving;
            if (this.active) this.updateButton();
        });
    }
    setBook(book: BookItem | null, preserveFeedback = false) {
        if (this.busy) return;
        const sameBook = this.book === book;
        if (this.book?.fileHref !== book?.fileHref) {
            this.expanded = false;
            if (this.body) this.body.scrollTop = 0;
        }
        this.book = book;
        const refreshPreview = !sameBook || this.lastOrder !== this.plugin.settings.noteOrder;
        this.lastOrder = this.plugin.settings.noteOrder;
        if (refreshPreview) this.notes = book ? orderedNotes(book.notes, this.plugin.settings.noteOrder) : [];
        if (!sameBook) {
            if (this.action === 'overwrite') this.action = 'append';
            if (!preserveFeedback) this.clearFeedback();
            this.recovery.buttonEl.hidden = true;
            this.confirmation.empty(); this.confirmation.hidden = true; this.repeatConfirmation = false;
        }
        this.heading.setText(book?.bookName || t('阅读笔记', 'Reading notes'));
        this.updateWarning();
        if (refreshPreview) this.updatePreview();
        this.updateDestination(); this.updateButton();
    }
    syncDefaultTemplate() {
        if (!this.active || this.busy) return;
        const latest = this.plugin.settings.noteTemplate;
        if (!this.templateDirty && this.template !== latest) {
            this.template = latest;
            this.templateEditor.value = latest;
            this.templateStatus.setText('');
            this.updateTemplateState();
            this.updatePreview(true, false);
            return;
        }
        this.templateDirty = this.template !== latest;
        this.updateTemplateState();
    }
    private updateTemplateState() {
        const modified = this.templateDirty && this.template !== this.plugin.settings.noteTemplate;
        const open = !this.templateDetails.hidden;
        const base = open ? t('收起模板', 'Hide template') : t('调整模板', 'Adjust template');
        this.templateToggle.setButtonText(modified ? base + t(' · 未保存', ' · modified') : base);
        this.templateToggle.buttonEl.dataset.dirty = String(modified);
        this.templateToggle.buttonEl.dataset.open = String(open);
        this.templateReset.setDisabled(this.busy || !modified);
    }
    private showTemplate(open: boolean) {
        this.templateDetails.hidden = !open;
        this.templateToggle.buttonEl.setAttribute('aria-expanded', String(open));
        this.updateTemplateState();
        if (open) {
            if (this.body) this.body.scrollTop = 0;
            this.templateEditor.focus({ preventScroll: true });
        } else this.templateToggle.buttonEl.focus();
    }
    private updatePreview(contentChanged = true, debounce = false) {
        window.clearTimeout(this.renderTimer);
        const revision = ++this.previewRevision;
        if (contentChanged) this.previewReady = false;
        const count = this.notes.length;
        const visible = this.expanded ? this.notes : this.notes.slice(0, 3);
        this.meta.setText(t('预览 ', 'Preview ') + visible.length + ' / ' + count + t(' 条', ' notes'));
        this.meta.title = this.lastOrder?.startsWith('chapter') ? t('按章节与书内位置排序；旧缓存沿用备份顺序', 'Sorted by chapter and reading position; legacy cache uses backup order') : '';
        this.toggle.buttonEl.hidden = count <= 3;
        this.toggle.setButtonText(this.expanded ? t('收起至前 3 条', 'Show first 3') : t('查看全部', 'Preview all'));
        this.toggle.buttonEl.setAttribute('aria-expanded', String(this.expanded));
        const remaining = count - visible.length;
        this.previewMore.hidden = remaining <= 0;
        if (remaining > 0) {
            this.previewMoreText.setText(t(`还有 ${remaining} 条未展开`, `${remaining} more ${remaining === 1 ? 'note' : 'notes'} not shown`));
            this.previewMoreButton.setButtonText(t(`展开全部 ${count} 条`, `Show all ${count} notes`));
        }
        this.previewStatus.setText(t('正在更新预览…', 'Updating preview…'));
        this.updateButton();
        const render = async () => {
            const ready = await this.preview.render(renderNotes(visible, this.template), this.target?.path || '');
            if (!this.active || revision !== this.previewRevision) return;
            this.previewReady = ready;
            this.previewStatus.setText('');
            this.updateButton();
        };
        if (debounce) this.renderTimer = window.setTimeout(() => void render(), 180);
        else void render();
    }
    private clearFeedback() { this.status.setText(''); this.recovery.buttonEl.hidden = true; }
    private importKey(): string { return JSON.stringify([this.plugin.cache.source, this.book?.fileHref, this.target?.path]); }
    private updateWarning() {
        const repeat = this.book && this.target && this.action !== 'overwrite' && this.plugin.sessionImports.has(this.importKey());
        this.warning.setText([this.book?.syncError || '', repeat ? t('本次会话已向此笔记导入过这本书。再次导入可能产生重复内容。', 'This book was already imported into this note during this session. Importing again may duplicate content.') : ''].filter(Boolean).join(' '));
    }
    private updateDestination() {
        this.targetLabel.setText(this.target ? this.target.path : t('尚未选择目标笔记', 'No target note selected'));
        this.targetLabel.title = this.target?.path || '';
        this.targetLabel.setAttribute('aria-label', this.target ? t('写入 ', 'Write to ') + this.target.path : t('尚未选择目标笔记', 'No target note selected'));
        this.modeButton.setButtonText((this.action === 'cursor' ? t('光标处插入', 'At cursor') : this.action === 'append' ? t('文末追加', 'Append to end') : t('替换正文', 'Replace body')) + ' ▾');
    }
    private get writeBlocked() {
        return this.busy || this.completed || this.orderSaving || !this.previewReady || !this.notes.length || !this.template.trim();
    }
    private updateButton() {
        const count = this.book?.notes.length || 0;
        this.primary.setButtonText(this.busy ? t('正在写入…', 'Writing…') : !this.target ? t('选择笔记', 'Choose note') :
            (this.action === 'cursor' ? t('插入全部 ', 'Insert all ') : this.action === 'append' ? t('追加全部 ', 'Append all ') : t('替换全部 ', 'Replace all ')) + count + t(' 条', count === 1 ? ' note' : ' notes'));
        this.actions.hidden = !this.confirmation.hidden;
        this.primary.setDisabled(this.writeBlocked || this.action === 'overwrite' || this.repeatConfirmation);
        this.modeButton.setDisabled(this.busy || !count);
        const confirm = this.confirmation.querySelector<HTMLButtonElement>('.mod-cta');
        if (confirm) confirm.disabled = this.writeBlocked;
    }
    focusPrimary() {
        if (this.confirmation.hidden) this.primary.buttonEl.focus();
        else this.confirmation.querySelector('button')?.focus();
    }
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
            new ButtonComponent(this.confirmation).setCta().setButtonText(t('确认替换', 'Confirm replacement')).onClick(() => { void this.submit(true); }).buttonEl.addClass('mod-warning');
            this.updateButton(); this.focusPrimary();
        }
    }
    private openMenu() {
        if (this.busy) return;
        this.menu?.hide();
        const menu = this.menu = new Menu();
        menu.addItem(item => item.setTitle(t('插入光标处', 'Insert at cursor')).setIcon('text-cursor-input').setChecked(this.action === 'cursor')
            .setDisabled(!this.target || this.target !== this.originalFile || this.view?.file !== this.originalFile).onClick(() => this.setAction('cursor')));
        menu.addItem(item => item.setTitle(t('追加到文末', 'Append to end')).setIcon('text-cursor').setChecked(this.action === 'append').onClick(() => this.setAction('append')));
        menu.addSeparator();
        menu.addItem(item => item.setTitle(t('替换正文…', 'Replace body…')).setIcon('replace').setDisabled(!this.target).onClick(() => this.setAction('overwrite')));
        const rect = this.modeButton.buttonEl.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
    private chooseTarget() {
        if (this.busy) return;
        new FileSuggestModal(this.app, file => {
            if (!this.active || this.busy) return;
            this.target = file;
            this.setAction('append'); this.updatePreview();
        }, () => { if (this.active) this.focusPrimary(); }, this.book?.bookName || '').open();
    }
    dismissSecondary(): boolean {
        if (!this.confirmation.hidden) { this.setAction(this.repeatConfirmation ? this.action : this.target === this.originalFile ? 'cursor' : 'append'); return true; }
        if (!this.templateDetails.hidden) { this.showTemplate(false); return true; }
        return false;
    }
    async submit(confirmReplacement = false, confirmRepeat = false) {
        if (this.writeBlocked || !this.book || !this.target) return;
        if (this.action === 'overwrite' && (!confirmReplacement || this.confirmation.hidden)) return;
        if (this.action !== 'overwrite' && this.plugin.sessionImports.has(this.importKey()) && !(confirmRepeat && this.repeatConfirmation && !this.confirmation.hidden)) {
            if (this.repeatConfirmation) return;
            this.repeatConfirmation = true;
            this.confirmation.empty(); this.confirmation.hidden = false;
            this.confirmation.createEl('p', { text: t('已导入过这本书，是否仍要再次写入 ', 'This book was already imported. Write it again to ') + this.target.path + '?' });
            new ButtonComponent(this.confirmation).setButtonText(t('取消', 'Cancel')).onClick(() => this.setAction(this.action));
            new ButtonComponent(this.confirmation).setCta().setButtonText(t('仍然导入', 'Import again')).onClick(() => { void this.submit(false, true); });
            this.updateButton(); this.focusPrimary(); return;
        }
        const target = this.target, action = this.action, book = this.book;
        const importKey = this.importKey();
        this.busy = true; this.changed(); this.updateButton(); this.recovery.buttonEl.hidden = true;
        this.status.setText(t('正在写入…', 'Writing…'));
        this.footer.querySelectorAll<HTMLButtonElement>('button').forEach(el => el.disabled = true);
        this.content.querySelectorAll<HTMLInputElement>('button, textarea, input, select').forEach(el => el.disabled = true);
        try {
            if (this.app.vault.getAbstractFileByPath(target.path) !== target) throw new UserError(t('目标笔记已移动或删除，请重新选择。', 'The target note was moved or deleted. Select it again.'));
            const text = renderNotes(this.notes, this.template);
            if (!text.trim()) throw new UserError(t('模板生成了空内容，请调整模板。', 'The template produced empty content. Adjust the template.'));
            if (action === 'cursor') {
                if (!this.view || !this.app.workspace.getLeavesOfType('markdown').some(leaf => leaf.view === this.view) ||
                    this.view.file !== target || !this.initialCursor || this.view.editor.getValue() !== this.initialEditorText) {
                    this.recovery.buttonEl.hidden = false;
                    throw new UserError(t('原笔记已关闭、切换或内容已变化。可改为文末追加。', 'The original note was closed or changed. You can append to the end instead.'));
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
                this.content.querySelectorAll<HTMLInputElement>('button, textarea, input, select').forEach(el => el.disabled = false);
                this.updateTemplateState();
                this.updateButton(); this.changed();
            }
            if (this.completed && this.active) this.done();
        }
    }
    onunload() { this.active = false; window.clearTimeout(this.renderTimer); this.menu?.hide(); }
}
