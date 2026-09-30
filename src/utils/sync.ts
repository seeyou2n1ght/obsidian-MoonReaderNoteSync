import { AnParser } from './anParser';
import type { BookItem } from './notes';
import type { WebDAVClient } from './webdav';
import { t } from '../i18n';

export interface SyncResult { books: BookItem[]; updated: number; unchanged: number; failed: number; failures: string[]; checkedAt: string; }
export async function syncBooks(client: Pick<WebDAVClient, 'getFiles' | 'getFileBuffer'>, cachedBooks: BookItem[], progress: (done: number, total: number) => void, isCancelled: () => boolean = () => false): Promise<SyncResult> {
    const checkCancelled = () => { if (isCancelled()) throw new Error('Sync cancelled'); };
    const files = (await client.getFiles()).filter(f => !f.isCollection && new URL(f.href).pathname.toLowerCase().endsWith('.an'));
    checkCancelled();
    const cached = new Map(cachedBooks.map(book => [book.fileHref, book]));
    const result: SyncResult = { books: [], updated: 0, unchanged: 0, failed: 0, failures: [], checkedAt: new Date().toISOString() };
    progress(0, files.length);
    for (const file of files) {
        checkCancelled();
        const old = cached.get(file.href);
        if (old && !old.syncError && old.lastSynced && file.lastModified && file.contentLength >= 0 && old.lastModified === file.lastModified && old.contentLength === file.contentLength) {
            result.books.push(old);
            result.unchanged++;
        } else {
            try {
                const buffer = await client.getFileBuffer(file.href);
                checkCancelled();
                const notes = AnParser.parseBuffer(buffer);
                result.books.push({ fileHref: file.href, lastModified: file.lastModified, contentLength: file.contentLength, notes, bookName: notes[0]?.bookName || decodeURIComponent(new URL(file.href).pathname.split('/').pop() || 'Book'), lastSynced: result.checkedAt });
                result.updated++;
            } catch {
                checkCancelled();
                result.failed++;
                const name = old?.bookName || new URL(file.href).pathname.split('/').pop() || 'Book';
                result.failures.push(name);
                if (old) result.books.push({ ...old, syncError: t('更新失败，保留旧数据', 'Update failed; previous data retained') });
            }
        }
        progress(result.updated + result.unchanged + result.failed, files.length);
    }
    return result;
}
