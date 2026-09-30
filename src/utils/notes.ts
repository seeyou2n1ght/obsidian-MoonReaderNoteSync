import type { MoonReaderNote } from './anParser';

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

export function renderNotes(notes: MoonReaderNote[], template: string): string {
    return notes.map(note => {
        const fields: Record<string, string> = { ...note, color: note.colorHex };
        // One pass and a callback prevent $ replacement tokens and recursive substitution.
        return template.replace(/\{(bookName|chapter|highlightText|note|color|timestamp|id)\}/g,
            (_, field: string) => escapeHtml(fields[field]));
    }).join('');
}

export function mergeNote(content: string, text: string, action: 'append' | 'overwrite'): string {
    if (action === 'append') return content + (content && !content.endsWith('\n') ? '\n' : '') + text;
    const frontmatter = content.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '';
    return frontmatter + (frontmatter && !frontmatter.endsWith('\n') ? '\n' : '') + text;
}
