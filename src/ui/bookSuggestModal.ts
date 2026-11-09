import { App, ButtonComponent, Component, MarkdownView, Menu, Modal } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import type { BookItem } from '../utils/notes';
import { bookOrderOptions } from './sortPreference';
import { ImportPanel } from './importPanel';
import { t, errorMessage } from '../i18n';

export class BookSuggestModal extends Modal {
    inputEl!: HTMLInputElement;
    private owner = new Component();
    private panel!: ImportPanel;
    private list!: HTMLElement;
    private workspace!: HTMLElement;
    private switchBook!: ButtonComponent;
    private failureDetails!: ButtonComponent;
    private listCount!: HTMLElement;
    private bookOrder!: ButtonComponent;
    private orderMenu: Menu | null = null;
    private savingOrder = false;
    private reading!: HTMLElement;
    private empty!: HTMLElement;
    private status!: HTMLElement;
    private sourceDetails!: HTMLDetailsElement;
    private server!: HTMLElement;
    private detailText!: HTMLElement;
    private progress!: HTMLProgressElement;
    private refreshButton!: ButtonComponent;
    private settingsButton!: ButtonComponent;
    private selected: string | null = null;
    private needsSelection = false;
    private selectedRow: HTMLButtonElement | null = null;
    private shownBooks: BookItem[] = [];
    private unsubscribe = () => {};
    private updateLibrary = () => {};
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
        this.sourceDetails = toolbar.createEl('details', { cls: 'moonreader-source' });
        this.server = this.sourceDetails.createEl('summary');
        this.detailText = this.sourceDetails.createDiv({ cls: 'moonreader-source-info' });
        this.status = toolbar.createDiv({ cls: 'moonreader-meta', attr: { role: 'status', 'aria-live': 'polite' } });
        this.failureDetails = new ButtonComponent(toolbar).onClick(() => {
            this.sourceDetails.open = !this.sourceDetails.open;
            this.failureDetails.buttonEl.setAttribute('aria-expanded', String(this.sourceDetails.open));
        });
        this.failureDetails.buttonEl.setAttribute('aria-expanded', 'false');
        this.sourceDetails.addEventListener('toggle', () => this.failureDetails.buttonEl.setAttribute('aria-expanded', String(this.sourceDetails.open)));
        this.refreshButton = new ButtonComponent(toolbar).onClick(() => {
            if (!this.plugin.configured() || this.plugin.libraryPhase === 'auth') this.plugin.openConnectionSettings();
            else void this.plugin.refresh();
        });
        this.settingsButton = new ButtonComponent(toolbar).setIcon('settings').setTooltip(t('连接设置', 'Connection settings')).onClick(() => this.plugin.openConnectionSettings());
        this.progress = this.contentEl.createEl('progress', { cls: 'moonreader-check-progress', attr: { 'aria-label': t('书库检查进度', 'Library check progress') } });
        const workspace = this.contentEl.createDiv({ cls: 'moonreader-workspace' });
        this.workspace = workspace;
        this.switchBook = new ButtonComponent(workspace).onClick(() => {
            const open = workspace.dataset.picker !== 'open';
            this.setPicker(open);
            if (open) this.inputEl.focus();
        });
        this.switchBook.buttonEl.addClass('moonreader-switch-book');
        const sidebar = workspace.createDiv({ cls: 'moonreader-sidebar' });
        this.inputEl = sidebar.createEl('input', { attr: { type: 'search', placeholder: t('搜索书籍…', 'Search books…'), 'aria-label': t('搜索书籍', 'Search books') } });
        const order = sidebar.createDiv({ cls: 'moonreader-list-order' });
        this.listCount = order.createDiv({ cls: 'moonreader-meta', attr: { role: 'status', 'aria-live': 'polite' } });
        this.bookOrder = new ButtonComponent(order).setTooltip(t('书籍排序', 'Book order')).onClick(() => this.openOrderMenu());
        this.bookOrder.buttonEl.setAttribute('aria-haspopup', 'menu');
        this.list = sidebar.createDiv({ cls: 'moonreader-book-list', attr: { role: 'listbox', 'aria-label': t('书籍', 'Books') } });
        const right = workspace.createDiv({ cls: 'moonreader-reading' });
        this.reading = right.createDiv();
        this.empty = right.createDiv({ cls: 'moonreader-empty' });
        const footer = this.contentEl.createDiv({ cls: 'moonreader-footer' });
        this.panel = this.owner.addChild(new ImportPanel(this.app, this.plugin, this.reading, footer, this.view, () => this.close(), () => {
            this.updateBusy();
            if (!this.panel.busy) this.updateLibrary();
            if (this.closeRequested && !this.panel.busy) this.close();
        }));
        this.inputEl.addEventListener('input', () => {
            if (this.panel.busy) return;
            this.needsSelection = false;
            this.renderBooks();
        });
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
                } else if (event.key === 'Enter' && this.selected) { event.preventDefault(); this.setPicker(false); this.panel.focusPrimary(); }
            }
        }, true);
        let books = this.plugin.cache.books;
        let limit = this.plugin.settings.bookListLimit;
        let sort = this.plugin.settings.bookListSort;
        let noteOrder = this.plugin.settings.noteOrder;
        let direction = this.plugin.settings.bookListDirection;
        const update = this.updateLibrary = () => {
            this.updateConnectionBar();
            this.updateOrderButton();
            this.refreshButton.setDisabled(this.plugin.syncing || this.plugin.connectionSaving || this.panel.busy);
            if (this.panel.busy) return;
            const cacheChanged = books !== this.plugin.cache.books;
            if (cacheChanged || limit !== this.plugin.settings.bookListLimit || sort !== this.plugin.settings.bookListSort || direction !== this.plugin.settings.bookListDirection) {
                books = this.plugin.cache.books; limit = this.plugin.settings.bookListLimit;
                sort = this.plugin.settings.bookListSort; direction = this.plugin.settings.bookListDirection;
                this.renderBooks(true, cacheChanged);
            } else if (noteOrder !== this.plugin.settings.noteOrder) {
                this.panel.setBook(this.shownBooks.find(book => book.fileHref === this.selected) || null, true);
            }
            noteOrder = this.plugin.settings.noteOrder;
        };
        this.plugin.listeners.add(update);
        this.unsubscribe = () => this.plugin.listeners.delete(update);
        this.renderBooks(); update(); this.focusLibrary();
    }
    focusLibrary() {
        if (this.switchBook.buttonEl.offsetWidth && this.workspace.dataset.picker !== 'open') this.switchBook.buttonEl.focus();
        else this.inputEl.focus();
    }
    private setPicker(open: boolean) {
        this.workspace.dataset.picker = open ? 'open' : 'closed';
        this.switchBook.buttonEl.setAttribute('aria-expanded', String(open));
    }
    private updateConnectionBar() {
        const { cache, libraryPhase: phase, checkProgress, syncing, settings } = this.plugin;
        const configured = syncing || this.plugin.configured();
        let url: URL | undefined;
        try { url = new URL(settings.webDavUrl); } catch { /* Invalid saved address can be corrected in settings. */ }
        this.sourceDetails.hidden = !settings.username || !url;
        this.server.setText(url?.host || '');
        const last = new Date(this.plugin.lastChecked || cache.checkedAt);
        const checked = Number.isFinite(last.getTime()) ? t('上次检查 ', 'Last checked ') + last.toLocaleString(t('zh-CN', 'en'), { dateStyle: 'short', timeStyle: 'short' }) : t('尚未检查', 'Not checked yet');
        this.detailText.setText([url?.host, url?.pathname, checked, this.plugin.status].filter(Boolean).join('\n'));
        const setup = !configured || phase === 'auth';
        const retry = phase === 'partial' || phase === 'error';
        const action = !configured && !settings.secretId ? t('连接备份', 'Connect backup') : setup ? t('检查凭据', 'Check credentials') :
            syncing ? t('检查中', 'Checking') : retry ? t('重试', 'Retry') : t('刷新', 'Refresh');
        this.refreshButton.setButtonText(action);
        this.refreshButton.setTooltip(setup || retry ? action : t('刷新书库', 'Refresh library'));
        this.settingsButton.buttonEl.hidden = setup;
        const today = Number.isFinite(last.getTime()) && last.toDateString() === new Date().toDateString();
        const shortTime = today ? t('今天 ', 'Today ') + last.toLocaleTimeString(t('zh-CN', 'en'), { hour: '2-digit', minute: '2-digit' }) + t(' 已检查', ' · Checked') : checked;
        let summary = shortTime;
        if (!configured) summary = settings.secretId ? t('保存的凭据不可用', 'Saved credential unavailable') : t('尚未连接阅读备份', 'Backup not configured');
        else if (syncing) summary = checkProgress && checkProgress.total ? t('正在检查书籍 ', 'Checking books ') + checkProgress.done + ' / ' + checkProgress.total :
            cache.books.length ? t('正在检查更新…', 'Checking for updates…') : t('正在获取书籍…', 'Fetching books…');
        else if (phase === 'ready' || phase === 'partial') summary = shortTime + ' · ' + this.plugin.librarySummary;
        else if (phase === 'auth' || phase === 'error') summary = (phase === 'auth' ? t('认证或访问权限异常', 'Authentication or access denied') : this.plugin.librarySummary) +
            (cache.books.length ? t(' · 显示本地缓存', ' · Showing local cache') + ' · ' + checked : '');
        this.status.dataset.phase = !configured ? 'setup' : phase;
        this.failureDetails.buttonEl.hidden = phase !== 'partial' || !configured;
        if (!this.failureDetails.buttonEl.hidden) {
            this.failureDetails.setButtonText(this.plugin.librarySummary + ' ▾');
            summary = shortTime;
        }
        this.status.setText(summary);
        this.progress.hidden = !syncing;
        if (checkProgress?.total) { this.progress.max = checkProgress.total; this.progress.value = checkProgress.done; }
        else this.progress.removeAttribute('value');
        if (!cache.books.length) this.renderEmpty(false);
    }
    private updateOrderButton() {
        this.bookOrder.setButtonText((this.plugin.settings.bookListSort === 'title' ? t('书名', 'Title') : t('修改时间', 'Modified')) + (this.plugin.settings.bookListDirection === 'asc' ? ' ↑' : ' ↓'));
        this.bookOrder.buttonEl.title = t('更改排序。日期为 WebDAV 备份文件的修改时间，不是阅读或批注时间。', 'Change book order. Date means the WebDAV backup file’s modification time, not reading or annotation time.');
        this.bookOrder.setDisabled(this.panel.busy || this.savingOrder);
    }
    private async saveOrder(sort: 'backup-date' | 'title', direction: 'asc' | 'desc') {
        if (this.disposed || this.panel.busy || this.savingOrder) return;
        this.savingOrder = true; this.updateOrderButton();
        try { await this.plugin.updateSettings({ bookListSort: sort, bookListDirection: direction }); this.plugin.notify(); }
        catch (error) { if (!this.disposed) this.status.setText(errorMessage(error)); }
        finally { this.savingOrder = false; if (!this.disposed) this.updateOrderButton(); }
    }
    private openOrderMenu() {
        if (this.disposed || this.panel.busy || this.savingOrder) return;
        this.orderMenu?.hide();
        const menu = this.orderMenu = new Menu();
        for (const [sort, direction, label] of bookOrderOptions()) {
            const selected = this.plugin.settings.bookListSort === sort && this.plugin.settings.bookListDirection === direction;
            menu.addItem(item => item.setTitle(label).setChecked(selected).onClick(() => {
                if (!selected) void this.saveOrder(sort, direction);
            }));
        }
        const rect = this.bookOrder.buttonEl.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
    private renderBooks(preserveFeedback = false, cacheChanged = false) {
        if (this.panel.busy || this.disposed) return;
        const query = this.inputEl.value.trim().toLocaleLowerCase();
        const matched = this.plugin.cache.books.filter(book => book.bookName.toLocaleLowerCase().includes(query));
        const titles = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const titleOrder = (a: BookItem, b: BookItem) => titles.compare(a.bookName, b.bookName) || a.fileHref.localeCompare(b.fileHref);
        const modified = (book: BookItem) => { const date = Date.parse(book.lastModified || ''); return Number.isFinite(date) ? date : -Infinity; };
        matched.sort((a, b) => {
            if (this.plugin.settings.bookListSort === 'title') return titleOrder(a, b) * (this.plugin.settings.bookListDirection === 'asc' ? 1 : -1);
            const first = modified(a), second = modified(b);
            if (first === second) return titleOrder(a, b);
            if (first === -Infinity) return 1;
            if (second === -Infinity) return -1;
            return (first > second ? 1 : -1) * (this.plugin.settings.bookListDirection === 'asc' ? 1 : -1);
        });
        this.shownBooks = this.plugin.settings.bookListLimit > 0 ? matched.slice(0, this.plugin.settings.bookListLimit) : matched;
        this.listCount.setText(this.shownBooks.length < matched.length ? t('显示 ', 'Showing ') + this.shownBooks.length + ' / ' + matched.length :
            (query ? t('匹配 ', 'Matches: ') : '') + matched.length + t(' 本', ' books'));
        const retained = this.shownBooks.find(book => book.fileHref === this.selected);
        if (cacheChanged && this.selected && !retained) this.needsSelection = true;
        const book = retained || (this.needsSelection ? null : this.shownBooks[0]) || null;
        const restoreListFocus = this.list.contains(this.list.ownerDocument.activeElement);
        this.list.empty();
        this.selectedRow = null;
        for (const [index, candidate] of this.shownBooks.entries()) {
            const row = this.list.createEl('button', { cls: 'moonreader-book-item', attr: {
                type: 'button', role: 'option', 'aria-selected': 'false', tabindex: '-1', title: candidate.bookName,
                id: 'moonreader-book-' + index
            } });
            row.createSpan({ text: candidate.bookName });
            row.createEl('small', { text: String(candidate.notes.length), cls: 'moonreader-meta' });
            if (candidate.syncError) row.createSpan({ cls: 'moonreader-book-error', text: '!', attr: { 'aria-label': candidate.syncError, title: candidate.syncError } });
            row.addEventListener('click', () => { if (!this.panel.busy) {
                this.selectBook(candidate, row);
                this.setPicker(false);
                if (this.switchBook.buttonEl.offsetWidth) this.switchBook.buttonEl.focus();
            } });
        }
        this.inputEl.setAttribute('aria-controls', this.list.id ||= 'moonreader-book-list');
        const row = book ? this.list.children[this.shownBooks.indexOf(book)] as HTMLButtonElement : null;
        this.selectBook(book, row, preserveFeedback);
        if (restoreListFocus) (row || this.inputEl).focus();
    }
    private selectBook(book: BookItem | null, row: HTMLButtonElement | null, preserveFeedback = false) {
        if (this.selectedRow) {
            this.selectedRow.tabIndex = -1;
            this.selectedRow.setAttribute('aria-selected', 'false');
        }
        this.selectedRow = row;
        const initial = this.selected === null;
        this.selected = book?.fileHref || null;
        this.switchBook.setButtonText(book ? t('切换书籍 · ', 'Switch book · ') + book.bookName + ' ▾' : t('选择书籍', 'Choose a book'));
        if (!book) this.setPicker(true);
        else if (initial && this.workspace.dataset.picker === undefined) this.setPicker(false);
        if (row) {
            this.needsSelection = false;
            row.setAttribute('aria-selected', 'true');
            row.tabIndex = 0;
            this.inputEl.setAttribute('aria-activedescendant', row.id);
        } else this.inputEl.removeAttribute('aria-activedescendant');
        this.panel.setBook(book, preserveFeedback);
        this.reading.hidden = !book;
        this.empty.hidden = !!book;
        if (!book) this.renderEmpty(this.plugin.cache.books.length > 0);
    }
    private renderEmpty(filtered: boolean) {
        const { syncing, libraryPhase: phase } = this.plugin;
        const message = this.needsSelection && this.shownBooks.length ? t('原选书籍已不在当前列表，请重新选择。', 'The selected book is no longer listed. Choose a book to import.') : filtered ? t('试试其他关键词。', 'Try another search.') :
            syncing ? t('正在读取阅读备份…', 'Fetching your reading backup…') :
            !this.plugin.configured() ? t('连接备份后，这里会出现你的书籍。', 'Connect your backup to see your books here.') :
            phase === 'error' || phase === 'auth' || phase === 'partial' ? t('暂无可用书籍，请查看上方检查结果。', 'No books available. See the check result above.') :
            phase === 'ready' ? t('备份目录中没有书籍，请检查备份位置。', 'No books in the backup folder. Check the location.') : t('本地暂无可用书籍。', 'No locally cached books.');
        this.empty.empty();
        this.empty.createEl('h3', { text: this.needsSelection && this.shownBooks.length ? t('请选择书籍', 'Choose a book') : filtered ? t('没有匹配的书籍', 'No matching books') : t('你的阅读笔记', 'Your reading notes') });
        this.empty.createEl('p', { text: message });
    }
    private moveSelection(delta: number) {
        if (this.panel.busy || !this.shownBooks.length) return;
        const index = this.shownBooks.findIndex(book => book.fileHref === this.selected);
        const next = index < 0 ? (delta > 0 ? 0 : this.shownBooks.length - 1) : (index + delta + this.shownBooks.length) % this.shownBooks.length;
        const row = this.list.children[next] as HTMLButtonElement;
        const focusList = this.list.contains(this.list.ownerDocument.activeElement);
        this.selectBook(this.shownBooks[next], row);
        if (focusList) row.focus();
        row.scrollIntoView?.({ block: 'nearest' });
    }
    private updateBusy() {
        this.inputEl.disabled = this.panel.busy;
        this.bookOrder.setDisabled(this.panel.busy || this.savingOrder);
        if (this.panel.busy) this.orderMenu?.hide();
        this.list.querySelectorAll<HTMLButtonElement>('button').forEach(el => el.disabled = this.panel.busy);
        this.refreshButton.setDisabled(this.panel.busy || this.plugin.syncing || this.plugin.connectionSaving);
        this.settingsButton.setDisabled(this.panel.busy);
    }
    close() { if (this.panel?.busy) { this.closeRequested = true; return; } super.close(); }
    onClose() { this.disposed = true; this.orderMenu?.hide(); this.unsubscribe(); this.updateLibrary = () => {}; this.owner.unload(); this.contentEl.empty(); this.closed(); }
}
