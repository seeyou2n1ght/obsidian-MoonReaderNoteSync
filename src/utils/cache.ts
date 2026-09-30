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
export async function readCache(storage: CacheStorage, path: string, source: string, baseUrl: string): Promise<BookCache> {
    const empty: BookCache = { version: 1, source, checkedAt: '', books: [] };
    let raw: unknown;
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
export async function writeCache(storage: CacheStorage, path: string, cache: BookCache): Promise<void> {
    const text = JSON.stringify(cache);
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
        await storage.write(temp, text);
        await storage.rename(temp, path);
    } finally {
        if (await storage.exists(temp)) await storage.remove(temp);
    }
}
