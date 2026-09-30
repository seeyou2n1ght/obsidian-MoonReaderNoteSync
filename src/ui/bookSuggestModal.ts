import { App, ButtonComponent, Component, MarkdownView, Modal } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import type { BookItem } from '../utils/notes';
import { ImportPanel } from './importPanel';
import { t } from '../i18n';

export class BookSuggestModal extends Modal {
    inputEl!: HTMLInputElement;
    private owner = new Component();
    private panel!: ImportPanel;
    private list!: HTMLElement;
    private reading!: HTMLElement;
    private empty!: HTMLElement;
    private status!: HTMLElement;
    private connectionStatus!: HTMLElement;
    private refreshButton!: ButtonComponent;
    private settingsButton!: ButtonComponent;
    private selected: string | null = null;
    private shownBooks: BookItem[] = [];
    private unsubscribe = () => {};
    private closeRequested = false;
    private disposed = false;
    constructor(app: App, private plugin: MoonReaderSyncPlugin, private view: MarkdownView | null, private closed: () => void) {
        super(app);
        this.setTitle(t('阅读笔记', 'Reading notes'));
    }
    onOpen() {
        this.modalEl.addClass('moonreader-library');
        this.owner.load();
        const toolbar = this.contentEl.createDiv({ cls: 'moonreader-library-toolbar' });
        this.status = toolbar.createDiv({ cls: 'moonreader-meta', attr: { role: 'status', 'aria-live': 'polite' } });
        this.refreshButton = new ButtonComponent(toolbar).setIcon('refresh-cw').setTooltip(t('刷新书库', 'Refresh library')).onClick(() => { void this.plugin.refresh(); });
        this.settingsButton = new ButtonComponent(toolbar).setIcon('settings').setTooltip(t('连接设置', 'Connection settings')).onClick(() => this.plugin.openConnectionSettings());
        this.connectionStatus = this.contentEl.createDiv({ cls: 'moonreader-connection-status', attr: { role: 'status', 'aria-live': 'polite' } });
        const workspace = this.contentEl.createDiv({ cls: 'moonreader-workspace' });
        const sidebar = workspace.createDiv({ cls: 'moonreader-sidebar' });
        this.inputEl = sidebar.createEl('input', { attr: { type: 'search', placeholder: t('搜索书籍…', 'Search books…'), 'aria-label': t('搜索书籍', 'Search books') } });
        this.list = sidebar.createDiv({ cls: 'moonreader-book-list', attr: { role: 'listbox', 'aria-label': t('书籍', 'Books') } });
        const right = workspace.createDiv({ cls: 'moonreader-reading' });
        this.reading = right.createDiv();
        this.empty = right.createDiv({ cls: 'moonreader-empty' });
        const footer = this.contentEl.createDiv({ cls: 'moonreader-footer' });
        this.panel = this.owner.addChild(new ImportPanel(this.app, this.plugin, this.reading, footer, this.view, () => this.close(), () => {
            this.updateBusy();
            if (this.closeRequested && !this.panel.busy) this.close();
        }));
        this.inputEl.addEventListener('input', () => { if (!this.panel.busy) this.renderBooks(); });
        this.modalEl.addEventListener('keydown', event => {
            if (event.key === 'Escape' && (this.panel.busy || this.panel.dismissSecondary())) {
                event.preventDefault(); event.stopImmediatePropagation(); return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault(); event.stopPropagation(); void this.panel.submit(); return;
            }
            if (event.target === this.inputEl || this.list.contains(event.target as Node)) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); this.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
                } else if (event.key === 'Enter') { event.preventDefault(); this.panel.focusPrimary(); }
            }
        }, true);
        let books = this.plugin.cache.books;
        const update = () => {
            this.status.setText(this.plugin.status);
            this.connectionStatus.setText(this.plugin.connectionStatus());
            this.refreshButton.setDisabled(this.plugin.syncing || this.panel.busy);
            if (books !== this.plugin.cache.books && !this.panel.busy) { books = this.plugin.cache.books; this.renderBooks(); }
        };
        this.plugin.listeners.add(update);
        this.unsubscribe = () => this.plugin.listeners.delete(update);
        this.renderBooks(); update(); this.inputEl.focus();
    }
    private renderBooks() {
        if (this.panel.busy || this.disposed) return;
        const query = this.inputEl.value.trim().toLocaleLowerCase();
        this.shownBooks = this.plugin.cache.books.filter(book => book.bookName.toLocaleLowerCase().includes(query));
        const book = this.shownBooks.find(book => book.fileHref === this.selected) || this.shownBooks[0] || null;
        this.selected = book?.fileHref || null;
        const restoreListFocus = this.list.contains(this.list.ownerDocument.activeElement);
        this.list.empty();
        for (const candidate of this.shownBooks) {
            const row = this.list.createEl('button', { cls: 'moonreader-book-item', attr: {
                type: 'button', role: 'option', 'aria-selected': String(candidate === book), tabindex: candidate === book ? '0' : '-1', title: candidate.bookName,
                id: 'moonreader-book-' + this.shownBooks.indexOf(candidate)
            } });
            row.createEl('span', { text: candidate.bookName });
            row.createEl('small', { text: String(candidate.notes.length), cls: 'moonreader-meta' });
            if (candidate.syncError) row.createEl('span', { cls: 'moonreader-book-error', text: '!', attr: { 'aria-label': candidate.syncError, title: candidate.syncError } });
            row.addEventListener('click', () => { if (!this.panel.busy) { this.selected = candidate.fileHref; this.renderBooks(); } });
        }
        this.inputEl.setAttribute('aria-controls', this.list.id ||= 'moonreader-book-list');
        if (book) this.inputEl.setAttribute('aria-activedescendant', 'moonreader-book-' + this.shownBooks.indexOf(book));
        else this.inputEl.removeAttribute('aria-activedescendant');
        if (restoreListFocus) this.list.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
        this.panel.setBook(book);
        this.reading.hidden = !book;
        this.empty.hidden = !!book;
        this.empty.empty();
        if (!book) {
            const hasBooks = this.plugin.cache.books.length > 0;
            this.empty.createEl('h3', { text: hasBooks ? t('没有匹配的书籍', 'No matching books') : t('你的阅读笔记', 'Your reading notes') });
            this.empty.createEl('p', { text: hasBooks ? t('试试其他关键词。', 'Try another search.') : t('连接阅读备份，获取书籍后即可插入笔记。', 'Connect your reading backup to start importing notes.') });
            if (!hasBooks) new ButtonComponent(this.empty).setCta().setButtonText(this.plugin.configured() ? t('获取书籍', 'Fetch books') : t('连接备份', 'Connect backup'))
                .onClick(() => { if (this.plugin.configured()) void this.plugin.refresh(); else this.plugin.openConnectionSettings(); });
        }
    }
    private moveSelection(delta: number) {
        if (this.panel.busy || !this.shownBooks.length) return;
        const index = this.shownBooks.findIndex(book => book.fileHref === this.selected);
        this.selected = this.shownBooks[(index + delta + this.shownBooks.length) % this.shownBooks.length].fileHref;
        this.renderBooks();
        this.list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }
    private updateBusy() {
        this.inputEl.disabled = this.panel.busy;
        this.list.querySelectorAll<HTMLButtonElement>('button').forEach(el => el.disabled = this.panel.busy);
        this.refreshButton.setDisabled(this.panel.busy || this.plugin.syncing);
        this.settingsButton.setDisabled(this.panel.busy);
    }
    close() { if (this.panel?.busy) { this.closeRequested = true; return; } super.close(); }
    onClose() { this.disposed = true; this.unsubscribe(); this.owner.unload(); this.contentEl.empty(); this.closed(); }
}
