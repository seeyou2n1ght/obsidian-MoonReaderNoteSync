import { Component, MarkdownRenderer, App } from 'obsidian';
import type { MoonReaderNote } from '../utils/anParser';
import { t } from '../i18n';

// Each preview owns its render lifecycle. Superseded renders never replace newer content.
export class NotePreview extends Component {
    private renderOwner: Component | null = null;
    private revision = 0;
    constructor(private app: App, private el: HTMLElement) { super(); }
    async render(text: string, sourcePath: string) {
        const revision = ++this.revision;
        if (this.renderOwner) this.removeChild(this.renderOwner);
        const owner = this.addChild(new Component());
        this.renderOwner = owner;
        const staging = this.el.createDiv();
        staging.remove();
        staging.addClass('markdown-rendered');
        try {
            await MarkdownRenderer.render(this.app, text, staging, sourcePath, owner);
            if (revision === this.revision) this.el.replaceChildren(staging);
        } catch {
            if (revision === this.revision) this.el.setText(t('预览失败，请检查模板。', 'Preview failed. Check the template.'));
        }
    }
    onunload() { this.revision++; }
}

export class TemplateBuilderUI {
    static build(container: HTMLElement, initial: string, onChange: (value: string) => void) {
        const editor = container.createEl('textarea', { cls: 'moonreader-template-textarea', attr: { 'aria-label': t('笔记模板', 'Note template'), spellcheck: 'false' } });
        editor.value = initial;
        container.createDiv({ cls: 'moonreader-meta moonreader-field-hint', text: t('可用字段 · 点击插入到光标处', 'Available fields · Click to insert at the cursor') });
        const fields = container.createDiv({ cls: 'moonreader-fields' });
        const insert = (value: string) => {
            editor.setRangeText(value, editor.selectionStart, editor.selectionEnd, 'end');
            editor.focus();
            onChange(editor.value);
        };
        for (const [field, label] of [
            ['bookName', t('书名', 'Book')], ['chapter', t('章节索引', 'Chapter index')],
            ['highlightText', t('高亮原文', 'Highlight')], ['note', t('批注', 'Note')],
            ['color', t('高亮颜色', 'Color')], ['timestamp', t('UTC 时间', 'UTC time')], ['id', t('笔记编号', 'Note ID')]
        ]) {
            const value = '{' + field + '}';
            const button = fields.createEl('button', { attr: { type: 'button', title: label + ' · ' + t('点击或拖入模板', 'Click or drag into the template'), 'aria-label': label + ' ' + value } });
            button.createEl('code', { text: value });
            button.createSpan({ text: label });
            button.draggable = true;
            button.addEventListener('click', () => insert(value));
            button.addEventListener('dragstart', event => event.dataTransfer?.setData('text/plain', value));
        }
        editor.addEventListener('input', () => onChange(editor.value));
        return editor;
    }
    static sample(): MoonReaderNote[] {
        return [{ id: '12345678', bookName: t('阅读示例', 'Reading example'), chapter: '4', highlightText: t('这是书中的一段高亮。', 'A highlighted passage from a book.'), note: t('这是我的阅读批注。', 'My reading note.'), colorHex: '#FFEB3B', timestamp: '2026-01-01 12:00:00' }];
    }
}
