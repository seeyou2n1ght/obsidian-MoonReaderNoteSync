import type { DataAdapter } from 'obsidian';
import { randomUUID, createHash } from 'crypto';
import type { BookItem } from './notes';

export interface BookCache { version: 1; source: string; checkedAt: string; books: BookItem[]; }
export function sourceId(url: string, username: string): string {
    return createHash('sha256').update(JSON.stringify([url, username])).digest('hex');
}
export function isBook(value: unknown): value is BookItem {
    if (!value || typeof value !== 'object') return false;
    const b = value as BookItem;
    return typeof b.fileHref === 'string' && typeof b.bookName === 'string' && Array.isArray(b.notes) &&
        b.notes.every(n => n && typeof n === 'object' && !('originalPath' in n) && ['id', 'bookName', 'chapter', 'colorHex', 'timestamp', 'note', 'highlightText'].every(k => typeof (n as unknown as Record<string, unknown>)[k] === 'string'));
}
// Files in the plugin config directory are not indexed as TFiles; use the vault adapter.
type CacheStorage = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'rename' | 'remove'>;
const cacheOperations = new WeakMap<CacheStorage, Map<string, Promise<unknown>>>();
async function withCacheLock<T>(storage: CacheStorage, path: string, operation: () => Promise<T>): Promise<T> {
    let paths = cacheOperations.get(storage);
    if (!paths) { paths = new Map(); cacheOperations.set(storage, paths); }
    const next = (paths.get(path) || Promise.resolve()).catch(() => {}).then(operation);
    paths.set(path, next);
    try { return await next; }
    finally { if (paths.get(path) === next) paths.delete(path); }
}
async function recoverCache(storage: CacheStorage, path: string): Promise<void> {
    const backup = path + '.bak';
    if (await storage.exists(backup)) {
        if (!await storage.exists(path)) await storage.rename(backup, path);
        else {
            try { await storage.remove(backup); } catch { /* the committed cache remains readable */ }
        }
    }
}
export function readCache(storage: CacheStorage, path: string, source: string, baseUrl: string): Promise<BookCache> {
    return withCacheLock(storage, path, () => readCacheUnlocked(storage, path, source, baseUrl));
}
async function readCacheUnlocked(storage: CacheStorage, path: string, source: string, baseUrl: string): Promise<BookCache> {
    const empty: BookCache = { version: 1, source, checkedAt: '', books: [] };
    let raw: unknown;
    await recoverCache(storage, path);
    if (!await storage.exists(path)) return empty;
    raw = JSON.parse(await storage.read(path));
    if (Array.isArray(raw)) {
        // Legacy cache belongs to the existing account; no lastSynced forces a refresh.
        return { ...empty, books: raw.filter(isBook).map(b => ({ ...b, fileHref: new URL(b.fileHref, baseUrl).href, lastSynced: undefined })) };
    }
    const cache = raw as BookCache;
    if (!cache || cache.version !== 1 || !Array.isArray(cache.books) || !cache.books.every(isBook) || typeof cache.checkedAt !== 'string') throw new Error('Invalid cache');
    return cache.source === source ? cache : empty;
}
export function writeCache(storage: CacheStorage, path: string, cache: BookCache): Promise<void> {
    return withCacheLock(storage, path, () => writeCacheUnlocked(storage, path, cache));
}
async function writeCacheUnlocked(storage: CacheStorage, path: string, cache: BookCache): Promise<void> {
    const text = JSON.stringify(cache);
    const temp = path + '.' + randomUUID() + '.tmp';
    const backup = path + '.bak';
    await recoverCache(storage, path);
    try {
        await storage.write(temp, text);
        // DataAdapter.rename rejects an existing destination, unlike Node's rename.
        const hadCache = await storage.exists(path);
        if (hadCache) await storage.rename(path, backup);
        try {
            await storage.rename(temp, path);
        } catch (error) {
            if (hadCache) {
                // Leave the backup for readCache to recover if rollback also fails.
                try { await storage.rename(backup, path); } catch { /* recovered on next load */ }
            }
            throw error;
        }
        // The new cache is committed. A failed cleanup must not report refresh failure.
        if (hadCache) {
            try { await storage.remove(backup); } catch { /* cleaned on next load */ }
        }
    } finally {
        try { if (await storage.exists(temp)) await storage.remove(temp); } catch { /* keep the original error */ }
    }
}
