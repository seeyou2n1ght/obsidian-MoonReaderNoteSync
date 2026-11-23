import { AnParser } from './anParser';
import type { BookItem } from './notes';
import type { WebDAVClient } from './webdav';
import { t, errorMessage } from '../i18n';

const SYNC_CONCURRENCY = 4;

function fileDisplayName(href: string): string {
    const raw = new URL(href).pathname.split('/').pop() || 'Book';
    try { return decodeURIComponent(raw); }
    catch { return raw; }
}

export interface SyncResult { books: BookItem[]; updated: number; removed: number; unchanged: number; failed: number; failures: string[]; checkedAt: string; }
export async function syncBooks(client: Pick<WebDAVClient, 'getFiles' | 'getFileBuffer'>, cachedBooks: BookItem[], progress: (done: number, total: number) => void, isCancelled: () => boolean = () => false): Promise<SyncResult> {
    const checkCancelled = () => { if (isCancelled()) throw new Error('Sync cancelled'); };
    const files = (await client.getFiles()).filter(f => !f.isCollection && new URL(f.href).pathname.toLowerCase().endsWith('.an'));
    checkCancelled();
    const cached = new Map(cachedBooks.map(book => [book.fileHref, book]));
    const result: SyncResult = { books: [], updated: 0, removed: 0, unchanged: 0, failed: 0, failures: [], checkedAt: new Date().toISOString() };
    const orderedBooks = new Array<BookItem | undefined>(files.length);
    const orderedFailures = new Array<string | undefined>(files.length);
    const pending: Array<{ index: number; file: typeof files[number]; old?: BookItem }> = [];
    progress(0, files.length);
    for (const [index, file] of files.entries()) {
        checkCancelled();
        const old = cached.get(file.href);
        cached.delete(file.href);
        if (old && !old.syncError && old.lastSynced && file.lastModified && file.contentLength >= 0 && old.lastModified === file.lastModified && old.contentLength === file.contentLength) {
            orderedBooks[index] = old;
            result.unchanged++;
            progress(result.updated + result.unchanged + result.failed, files.length);
        } else {
            pending.push({ index, file, old });
        }
    }
    let cursor = 0;
    const worker = async () => {
        while (cursor < pending.length) {
            checkCancelled();
            const task = pending[cursor++];
            let parsing = false;
            try {
                const buffer = await client.getFileBuffer(task.file.href);
                checkCancelled();
                parsing = true;
                const notes = AnParser.parseBuffer(buffer);
                orderedBooks[task.index] = {
                    fileHref: task.file.href,
                    lastModified: task.file.lastModified,
                    contentLength: task.file.contentLength,
                    notes,
                    bookName: notes[0]?.bookName || fileDisplayName(task.file.href),
                    lastSynced: result.checkedAt
                };
                result.updated++;
            } catch (error) {
                checkCancelled();
                result.failed++;
                const name = task.old?.bookName || fileDisplayName(task.file.href);
                const detail = error instanceof Error ? error.message : String(error);
                const cause = error instanceof Error && error.cause instanceof Error ? ' (' + error.cause.message + ')' : '';
                console.error('[MoonReader Note Sync] Failed to sync book:', name, detail + cause);
                const lineMatch = parsing ? detail.match(/\bline (\d+)\b/) : null;
                const reason = parsing
                    ? lineMatch
                        ? t(`备份格式无效（第 ${lineMatch[1]} 行），请重新生成备份`, `Invalid backup format (line ${lineMatch[1]}); recreate the backup`)
                        : t('备份格式无效，请重新生成备份', 'Invalid backup format; recreate the backup')
                    : errorMessage(error);
                orderedFailures[task.index] = name + ' · ' + reason;
                if (task.old) {
                    const syncError = reason + t(' · 保留旧数据', ' · Previous data retained');
                    orderedBooks[task.index] = task.old.syncError === syncError ? task.old : { ...task.old, syncError };
                }
            }
            progress(result.updated + result.unchanged + result.failed, files.length);
        }
    };
    const workers = Math.min(SYNC_CONCURRENCY, pending.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    checkCancelled();
    result.books = orderedBooks.filter((item): item is BookItem => item !== undefined);
    result.failures = orderedFailures.filter((item): item is string => item !== undefined);
    result.removed = cached.size;
    return result;
}
