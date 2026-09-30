import { Plugin, FileSystemAdapter, MarkdownView, Modal } from 'obsidian';
import { join } from 'path';
import { MoonReaderSyncSettings, DEFAULT_SETTINGS } from './settings';
import { MoonReaderWebDAVSettingTab } from './ui/settingTab';
import { WebDAVClient, normalizeWebDavUrl } from './utils/webdav';
import { BookSuggestModal } from './ui/bookSuggestModal';
import { randomUUID } from 'crypto';
import { BookCache, readCache, writeCache, sourceId } from './utils/cache';
import { renderNotes } from './utils/notes';
import { syncBooks } from './utils/sync';
import { t, errorMessage, UserError } from './i18n';

export default class MoonReaderSyncPlugin extends Plugin {
    settings: MoonReaderSyncSettings = { ...DEFAULT_SETTINGS };
    cache: BookCache = { version: 1, source: '', checkedAt: '', books: [] };
    syncing = false;
    connectionSaving = false;
    status = '';
    readonly listeners = new Set<() => void>();
    readonly sessionImports = new Set<string>();
    private recentMarkdownView: MarkdownView | null = null;
    private saves: Promise<void> = Promise.resolve();
    private settingsTab!: MoonReaderWebDAVSettingTab;
    private browser: BookSuggestModal | null = null;
    private connectionModal: Modal | null = null;
    private disposed = false;
    renderNotes = renderNotes;

    async onload() {
        const saved = await this.loadData() || {};
        // Only current fields are retained; legacy ciphertext is never loaded or migrated.
        this.settings = {
            webDavUrl: saved.webDavUrl ?? DEFAULT_SETTINGS.webDavUrl,
            username: saved.username ?? DEFAULT_SETTINGS.username,
            secretId: saved.secretId ?? '',
            insertAction: saved.insertAction ?? DEFAULT_SETTINGS.insertAction,
            noteTemplate: saved.noteTemplate ?? DEFAULT_SETTINGS.noteTemplate
        };
        this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
            if (leaf?.view instanceof MarkdownView) this.recentMarkdownView = leaf.view;
        }));
        this.settingsTab = new MoonReaderWebDAVSettingTab(this.app, this);
        this.addSettingTab(this.settingsTab);
        await this.loadCache();
        this.addRibbonIcon('library', t('静读天下笔记', 'MoonReader notes'), () => this.openLibrary());
        this.addCommand({ id: 'pull-moonreader-notes', name: t('浏览和导入笔记', 'Browse and import notes'), callback: () => this.openLibrary() });
        this.addCommand({ id: 'refresh-moonreader-notes', name: t('刷新远端笔记', 'Refresh remote notes'), callback: () => { this.openLibrary(false); void this.refresh(); } });
    }
    onunload() {
        this.disposed = true;
        this.browser?.close();
        this.connectionModal?.close();
        this.settingsTab.hide();
        this.listeners.clear();
    }
    configured(): boolean {
        try { return !!(this.settings.webDavUrl && this.settings.username && this.settings.secretId && this.app.secretStorage.getSecret(this.settings.secretId)); }
        catch { return false; }
    }
    connectionStatus(): string {
        return this.configured() ? t('连接已保存', 'Connection saved') : this.settings.secretId ?
            t('已保存的密码不可用，请重新输入并保存', 'Saved password unavailable; re-enter and save it') :
            t('连接未配置，请输入密码并保存', 'Connection not configured; enter your password and save');
    }
    async saveConnection(webDavUrl: string, username: string, password: string, isActive: () => boolean) {
        if (!isActive()) return;
        if (this.settings.secretId && username === this.settings.username &&
            new URL(webDavUrl).origin === new URL(this.settings.webDavUrl).origin &&
            this.app.secretStorage.getSecret(this.settings.secretId) === password) {
            await this.updateSettings({ webDavUrl, username });
            this.notify(); return;
        }
        const secretId = 'moonreader-' + randomUUID();
        try {
            this.app.secretStorage.setSecret(secretId, password);
            if (this.app.secretStorage.getSecret(secretId) !== password) throw new Error('Secret storage did not retain the credential');
            if (!isActive()) { this.app.secretStorage.setSecret(secretId, ''); return; }
            await this.updateSettings({ webDavUrl, username, secretId });
        } catch (error) {
            try { this.app.secretStorage.setSecret(secretId, ''); }
            catch { throw new UserError(t('连接未更改，但新凭据清理失败。可在 Obsidian 密钥库中清理未使用的 moonreader 凭据。', 'Connection unchanged, but the unused credential could not be cleared. Manage unused moonreader entries in Obsidian Keychain.')); }
            throw error;
        }
        this.notify();
    }
    private currentSource(): string {
        return sourceId(normalizeWebDavUrl(this.settings.webDavUrl), this.settings.username);
    }
    private cachePath(source?: string): string {
        const base = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
        return join(base, this.manifest.dir!, source ? 'moonreader_cache.' + source + '.json' : 'moonreader_cache.json');
    }
    async loadCache() {
        try {
            const source = this.currentSource();
            this.cache = await readCache(this.cachePath(source), source, this.settings.webDavUrl);
            if (!this.cache.checkedAt && !this.cache.books.length) {
                const legacy = await readCache(this.cachePath(), source, this.settings.webDavUrl);
                if (legacy.books.length) {
                    // Bind the old unscoped array before any connection settings can change.
                    await writeCache(this.cachePath(), legacy);
                    await writeCache(this.cachePath(source), legacy);
                    this.cache = legacy;
                }
            }
            this.status = this.cache.books.length ? this.cache.books.length + t(' 本书 · 本地缓存', ' books · Local cache') : t('尚无缓存书籍', 'No cached books yet');
        } catch {
            this.cache = { version: 1, source: '', checkedAt: '', books: [] };
            this.status = t('缓存无法读取。可刷新重新获取；原缓存文件已保留。', 'Cannot read the cache. Refresh to fetch it again; the original file is preserved.');
        }
        this.notify();
    }
    async updateSettings(patch: Partial<MoonReaderSyncSettings>): Promise<void> {
        const save = this.saves.then(async () => {
            const next = { ...this.settings, ...patch };
            await this.saveData(next);
            this.settings = next;
        });
        this.saves = save.catch(() => {});
        await save;
    }
    notify() { if (!this.disposed) this.listeners.forEach(fn => fn()); }
    openLibrary(refreshIfEmpty = true) {
        if (this.browser) {
            this.browser.inputEl.focus();
            if (refreshIfEmpty && !this.cache.books.length && this.configured()) void this.refresh();
            return;
        }
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        const recent = this.app.workspace.getMostRecentLeaf()?.view;
        const history = this.app.workspace.getLastOpenFiles();
        const view = active || (leaves.some(leaf => leaf.view === this.recentMarkdownView) ? this.recentMarkdownView : null) ||
            (recent instanceof MarkdownView ? recent : null) ||
            history.map(path => leaves.find(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === path)?.view as MarkdownView | undefined).find(Boolean) ||
            (leaves.length === 1 && leaves[0].view instanceof MarkdownView ? leaves[0].view : null);
        this.browser = new BookSuggestModal(this.app, this, view, () => { this.browser = null; });
        this.browser.open();
        if (refreshIfEmpty && !this.cache.books.length && this.configured()) void this.refresh();
    }
    openConnectionSettings() {
        if (this.connectionModal) return;
        const modal = new Modal(this.app);
        modal.modalEl.addClass('moonreader-connection');
        this.connectionModal = modal;
        modal.setTitle(t('连接静读天下备份', 'Connect MoonReader backup'));
        const tab = new MoonReaderWebDAVSettingTab(this.app, this, () => { modal.close(); this.openLibrary(); }, true);
        tab.containerEl = modal.contentEl;
        modal.onClose = () => { tab.hide(); this.connectionModal = null; };
        tab.display();
        modal.open();
    }
    async refresh() {
        if (this.syncing) return;
        if (this.connectionSaving) {
            this.status = t('正在保存连接，请稍后刷新。', 'Connection is being saved. Refresh when it finishes.');
            this.notify();
            return;
        }
        if (!this.configured()) {
            this.status = t('连接配置未完成，无法刷新。请点击右上角设置完成并保存连接；已有缓存仍可浏览和导入。', 'Cannot refresh: connection setup is incomplete. Open settings at the top right and save your connection; cached books remain available.');
            this.notify();
            return;
        }
        this.syncing = true;
        const settings = { ...this.settings };
        this.status = t('正在读取远端目录…', 'Reading remote folder…');
        this.notify();
        try {
            const source = this.currentSource();
            const password = this.app.secretStorage.getSecret(settings.secretId);
            if (!password) throw new UserError(t('已保存的密码不可用，请重新输入并保存。', 'Saved password unavailable; re-enter and save it.'));
            const result = await syncBooks(new WebDAVClient(settings.webDavUrl, settings.username, password),
                this.cache.source === source ? this.cache.books : [], (done, total) => {
                    this.status = t('正在检查书籍', 'Checking books') + ': ' + done + ' / ' + total;
                    this.notify();
                }, () => this.disposed);
            if (this.disposed || source !== this.currentSource()) return;
            const next: BookCache = { version: 1, source, checkedAt: result.checkedAt, books: result.books };
            await writeCache(this.cachePath(source), next);
            this.cache = next;
            this.status = t('刷新完成', 'Refresh complete') + ': ' + result.updated + t(' 本更新，', ' updated, ') +
                result.unchanged + t(' 本未变化，', ' unchanged, ') + result.failed + t(' 本失败。', ' failed.');
            if (!result.books.length && !result.failed) this.status += t('目录中没有 .an 文件。请检查备份位置。', 'No .an files in this folder. Check the backup location.');
            if (result.failed) this.status += t('已有缓存已保留；可重试刷新。失败书籍：', 'Existing cache retained; refresh to retry. Failed books: ') + result.failures.join('、');
        } catch (error) {
            if (this.disposed) return;
            this.status = errorMessage(error) + ' ' + t('已有缓存仍可浏览和导入。', 'Existing cached books remain available.');
        } finally {
            this.syncing = false;
            this.notify();
        }
    }
}
