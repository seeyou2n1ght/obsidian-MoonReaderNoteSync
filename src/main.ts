import { Plugin, MarkdownView, Modal, normalizePath } from 'obsidian';
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
    connectionOperation: 'test' | 'save' | null = null;
    private connectionToken: symbol | null = null;
    private blockedRefresh: { previous: string; message: string } | null = null;
    status = '';
    readonly listeners = new Set<() => void>();
    readonly sessionImports = new Set<string>();
    private readonly clearedCredentialNames = new Set<string>();
    private recentMarkdownView: MarkdownView | null = null;
    private saves: Promise<void> = Promise.resolve();
    private settingsTab!: MoonReaderWebDAVSettingTab;
    private browser: BookSuggestModal | null = null;
    private connectionModal: Modal | null = null;
    private disposed = false;
    renderNotes = renderNotes;

    async onload() {
        const raw: unknown = await this.loadData();
        const saved: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        // Only current fields are retained; legacy ciphertext is never loaded or migrated.
        this.settings = {
            webDavUrl: typeof saved.webDavUrl === 'string' ? saved.webDavUrl : DEFAULT_SETTINGS.webDavUrl,
            username: typeof saved.username === 'string' ? saved.username : DEFAULT_SETTINGS.username,
            secretId: typeof saved.secretId === 'string' ? saved.secretId : '',
            bookListLimit: typeof saved.bookListLimit === 'number' && Number.isSafeInteger(saved.bookListLimit) && saved.bookListLimit >= 0 ? saved.bookListLimit : DEFAULT_SETTINGS.bookListLimit,
            bookListSort: saved.bookListSort === 'title' ? 'title' : DEFAULT_SETTINGS.bookListSort,
            bookListDirection: saved.bookListDirection === 'asc' || saved.bookListDirection === 'desc' ? saved.bookListDirection : saved.bookListSort === 'title' ? 'asc' : DEFAULT_SETTINGS.bookListDirection,
            insertAction: saved.insertAction === 'ask' || saved.insertAction === 'append' || saved.insertAction === 'overwrite' ? saved.insertAction : DEFAULT_SETTINGS.insertAction,
            noteTemplate: typeof saved.noteTemplate === 'string' && saved.noteTemplate.trim() ? saved.noteTemplate : DEFAULT_SETTINGS.noteTemplate
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
    credentialStatus(): string {
        const id = this.settings.secretId;
        if (!id) return t('已保存凭据：未配置', 'Saved credential: Not configured');
        return t('已保存凭据：', 'Saved credential: ') + id + ' · ' +
            (this.credentialAvailable() ? t('密码可读取', 'Password readable') : t('密码不可用，请选择其他凭据或新建凭据', 'Password unavailable; select another credential or create one'));
    }
    credentialAvailable(): boolean {
        try { return !!(this.settings.secretId && this.app.secretStorage.getSecret(this.settings.secretId)); }
        catch { return false; }
    }
    suggestCredentialName(webDavUrl: string): string {
        let server = 'backup';
        try { server = new URL(webDavUrl).hostname.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || server; } catch { /* allow editing an incomplete URL */ }
        const existing = new Set(this.app.secretStorage.listSecrets());
        let id: string;
        do { id = 'moonreader-' + server + '-' + randomUUID().slice(0, 8); } while (existing.has(id));
        return id;
    }
    validateNewCredentialName(value: string): string {
        const id = value.trim();
        if (!id) throw new UserError(t('请填写凭据名称。', 'Enter a credential name.'));
        if (!/^[a-z0-9-]+$/.test(id) || id.length > 64) throw new UserError(t('名称仅支持小写字母、数字和连字符，最多 64 个字符。', 'Use lowercase letters, numbers and dashes, up to 64 characters.'));
        const retryingClearedEntry = this.clearedCredentialNames.has(id) && !this.app.secretStorage.getSecret(id);
        if (this.app.secretStorage.listSecrets().includes(id) && !retryingClearedEntry) throw new UserError(t('名称已存在。请选择已有凭据，或使用其他名称。', 'This name already exists. Choose the existing credential or use another name.'));
        return id;
    }
    beginConnectionOperation(save: boolean): symbol | null {
        if (this.connectionSaving || this.disposed) return null;
        const token = this.connectionToken = Symbol('connection');
        this.connectionSaving = true; this.connectionOperation = save ? 'save' : 'test'; this.notify();
        return token;
    }
    endConnectionOperation(token: symbol) {
        if (this.connectionToken !== token) return;
        this.connectionToken = null; this.connectionSaving = false; this.connectionOperation = null;
        if (this.blockedRefresh) {
            if (this.status === this.blockedRefresh.message) this.status = this.blockedRefresh.previous;
            this.blockedRefresh = null;
        }
        this.notify();
    }
    async saveConnection(webDavUrl: string, username: string, password: string, isActive: () => boolean, existingSecretId?: string, newCredentialName?: string, onCommit?: () => void) {
        const canCommit = () => !this.disposed && isActive();
        if (!canCommit()) return false;
        const verifyCredential = (id: string) => {
            if (!canCommit()) return false;
            if (this.app.secretStorage.getSecret(id) !== password) {
                throw new UserError(t('所选凭据已更改或不可用，请重新测试后保存。', 'The selected credential changed or is unavailable. Test again before saving.'));
            }
            onCommit?.(); return true;
        };
        if (existingSecretId) {
            if (this.app.secretStorage.getSecret(existingSecretId) !== password) {
                throw new UserError(t('所选凭据已更改或不可用，请重新测试后保存。', 'The selected credential changed or is unavailable. Test again before saving.'));
            }
            if (!await this.updateSettings({ webDavUrl, username, secretId: existingSecretId }, () => verifyCredential(existingSecretId))) return false;
            await this.loadCache(); return true;
        }
        if (newCredentialName === undefined && this.settings.secretId && username === this.settings.username &&
            new URL(webDavUrl).origin === new URL(this.settings.webDavUrl).origin &&
            this.app.secretStorage.getSecret(this.settings.secretId) === password) {
            if (!await this.updateSettings({ webDavUrl, username }, () => verifyCredential(this.settings.secretId))) return false;
            await this.loadCache(); return true;
        }
        const secretId = this.validateNewCredentialName(newCredentialName ?? this.suggestCredentialName(webDavUrl));
        const clearCreatedCredential = () => {
            // Do not clear another writer's replacement while settings were being saved.
            if (this.app.secretStorage.getSecret(secretId) === password) {
                this.app.secretStorage.setSecret(secretId, '');
                this.clearedCredentialNames.add(secretId);
            }
        };
        try {
            this.app.secretStorage.setSecret(secretId, password);
            if (this.app.secretStorage.getSecret(secretId) !== password) throw new Error('Secret storage did not retain the credential');
            this.clearedCredentialNames.delete(secretId);
            if (!await this.updateSettings({ webDavUrl, username, secretId }, () => verifyCredential(secretId))) {
                clearCreatedCredential(); return false;
            }
        } catch (error) {
            try { clearCreatedCredential(); }
            catch { throw new UserError(t('连接未更改，但新凭据清理失败。可在 Obsidian 密钥库中清理未使用的凭据。', 'Connection unchanged, but the unused credential could not be cleared. Manage unused entries in Obsidian Keychain.')); }
            throw error;
        }
        // A committed connection must switch caches even if its form has closed.
        await this.loadCache(); return true;
    }
    private currentSource(): string {
        return sourceId(normalizeWebDavUrl(this.settings.webDavUrl), this.settings.username);
    }
    private cachePath(source?: string): string {
        return normalizePath(this.manifest.dir! + '/' + (source ? 'moonreader_cache.' + source + '.json' : 'moonreader_cache.json'));
    }
    async loadCache() {
        try {
            const source = this.currentSource();
            this.cache = await readCache(this.app.vault.adapter, this.cachePath(source), source, this.settings.webDavUrl);
            if (!this.cache.checkedAt && !this.cache.books.length) {
                const legacy = await readCache(this.app.vault.adapter, this.cachePath(), source, this.settings.webDavUrl);
                if (legacy.books.length) {
                    // Bind the old unscoped array before any connection settings can change.
                    await writeCache(this.app.vault.adapter, this.cachePath(), legacy);
                    await writeCache(this.app.vault.adapter, this.cachePath(source), legacy);
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
    async updateSettings(patch: Partial<MoonReaderSyncSettings>, shouldSave: () => boolean = () => true): Promise<boolean> {
        const save = this.saves.then(async () => {
            if (!shouldSave()) return false;
            const next = { ...this.settings, ...patch };
            await this.saveData(next);
            this.settings = next;
            return true;
        });
        this.saves = save.then(() => {}, () => {});
        return save;
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
        tab.renderConnection();
        modal.open();
    }
    async refresh() {
        if (this.syncing) return;
        if (this.connectionSaving) {
            const message = this.connectionOperation === 'test' ? t('正在测试连接，请完成或取消检查后刷新。', 'Connection is being tested. Finish or cancel the check before refreshing.') :
                t('正在保存连接，请稍后刷新。', 'Connection is being saved. Refresh when it finishes.');
            this.blockedRefresh = { previous: this.blockedRefresh?.previous ?? this.status, message };
            this.status = message;
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
            try {
                await writeCache(this.app.vault.adapter, this.cachePath(source), next);
            } catch {
                throw new UserError(t('远端检查已完成，但本地缓存保存失败。请检查插件目录的访问权限后重试。', 'Remote check completed, but saving the local cache failed. Check access to the plugin folder and retry.'));
            }
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
