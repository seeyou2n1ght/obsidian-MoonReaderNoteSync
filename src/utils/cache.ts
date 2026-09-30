import { promises as fs } from 'fs';
import { randomUUID, createHash } from 'crypto';
import { dirname } from 'path';
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
export async function readCache(path: string, source: string, baseUrl: string): Promise<BookCache> {
    const empty: BookCache = { version: 1, source, checkedAt: '', books: [] };
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(path, 'utf8')); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
        throw error;
    }
    if (Array.isArray(raw)) {
        // Legacy cache belongs to the existing account; no lastSynced forces a refresh.
        return { ...empty, books: raw.filter(isBook).map(b => ({ ...b, fileHref: new URL(b.fileHref, baseUrl).href, lastSynced: undefined })) };
    }
    const cache = raw as BookCache;
    if (!cache || cache.version !== 1 || !Array.isArray(cache.books) || !cache.books.every(isBook) || typeof cache.checkedAt !== 'string') throw new Error('Invalid cache');
    return cache.source === source ? cache : empty;
}
export async function writeCache(path: string, cache: BookCache): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
        await fs.writeFile(temp, JSON.stringify(cache), { flag: 'wx' });
        await fs.rename(temp, path);
    } finally {
        await fs.unlink(temp).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    }
}
