import type { MoonReaderNote } from './anParser';

import type { NoteOrder } from '../settings';

export function orderedNotes(notes: MoonReaderNote[], order: NoteOrder): MoonReaderNote[] {
    if (order === 'backup') return notes;
    const direction = order.endsWith('-asc') ? 1 : -1;
    if (order.startsWith('chapter')) {
        return [...notes].sort((a, b) => {
            const chapterDiff = Number(a.chapter) - Number(b.chapter);
            if (chapterDiff !== 0) return direction * chapterDiff;
            if (typeof a.offset === 'number' && typeof b.offset === 'number' && Number.isFinite(a.offset) && Number.isFinite(b.offset)) {
                return direction * (a.offset - b.offset);
            }
            return 0;
        });
    }
    return [...notes].sort((a, b) => {
        if (!a.timestamp || !b.timestamp) return Number(!a.timestamp) - Number(!b.timestamp);
        return direction * a.timestamp.localeCompare(b.timestamp);
    });
}

export interface BookItem {
    fileHref: string;
    bookName: string;
    notes: MoonReaderNote[];
    lastModified?: string;
    contentLength?: number;
    lastSynced?: string;
    syncError?: string;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function decodeLineBreaks(text: string): string {
    return text.replace(/<BR>/gi, '\n');
}

function insideInlineHtmlTag(beforeOnLine: string, afterOnLine: string): boolean {
    const openTag = beforeOnLine.match(/<([a-z][a-z0-9-]*)\b[^>]*>(?:(?!<\/\1>).)*$/i);
    if (!openTag) return false;
    return new RegExp(`</${openTag[1]}\\s*>`, 'i').test(afterOnLine);
}

export function renderNotes(notes: MoonReaderNote[], template: string): string {
    const rendered = notes.map(note => {
        const fields: Record<string, string> = {
            id: note.id,
            bookName: note.bookName,
            chapter: note.chapter,
            highlightText: decodeLineBreaks(note.highlightText),
            note: decodeLineBreaks(note.note),
            color: note.colorHex,
            timestamp: note.timestamp
        };
        // Evaluate conditional blocks on the raw template before field values enter the string.
        const expanded = template.replace(
            /\{#(bookName|chapter|highlightText|note|color|timestamp|id)\}([\s\S]*?)\{\/\1\}/g,
            (_, field: string, body: string) => fields[field].trim() ? body : ''
        );
        // One pass and a callback prevent $ replacement tokens and recursive substitution.
        return expanded.replace(
            /\{(bookName|chapter|highlightText|note|color|timestamp|id)\}/g,
            (match: string, field: string, offset: number, source: string) => {
                const escaped = escapeHtml(fields[field]);
                if (!escaped.includes('\n')) return escaped;
                const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
                const nextBreak = source.indexOf('\n', offset + match.length);
                const lineEnd = nextBreak < 0 ? source.length : nextBreak;
                const beforeOnLine = source.slice(lineStart, offset);
                const afterOnLine = source.slice(offset + match.length, lineEnd);
                if (insideInlineHtmlTag(beforeOnLine, afterOnLine)) return escaped.replace(/\n/g, '<br>');
                const quotePrefix = beforeOnLine.match(/^([ \t]*(?:>[ \t]?)+)/)?.[1];
                return quotePrefix ? escaped.replace(/\n/g, '\n' + quotePrefix) : escaped;
            }
        );
    });
    let output = '';
    for (const entry of rendered) {
        if (output && entry && !/\r?\n$/.test(output) && !/^\r?\n/.test(entry)) output += '\n\n';
        output += entry;
    }
    return output;
}

export function mergeNote(content: string, text: string, action: 'append' | 'overwrite'): string {
    if (action === 'append') return content + (content && !content.endsWith('\n') ? '\n' : '') + text;
    const frontmatter = content.match(/^(?:\uFEFF)?---\r?\n(?:[^\n]*\n)*?---(?:\r?\n|$)/)?.[0] || '';
    return frontmatter + (frontmatter && !frontmatter.endsWith('\n') ? '\n' : '') + text;
}
