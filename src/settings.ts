export const noteOrders = ['backup', 'chapter-asc', 'chapter-desc', 'time-asc', 'time-desc'] as const;
export type NoteOrder = typeof noteOrders[number];

export function isNoteOrder(value: unknown): value is NoteOrder {
    return noteOrders.some(order => order === value);
}

export interface MoonReaderSyncSettings {
    webDavUrl: string;
    username: string;
    secretId: string;
    noteOrder: NoteOrder;
    bookListLimit: number;
    bookListSort: 'backup-date' | 'title';
    bookListDirection: 'asc' | 'desc';
    
    insertAction: "ask" | "append";
    
    noteTemplate: string;
}

export const DEFAULT_SETTINGS: MoonReaderSyncSettings = {
    webDavUrl: 'https://dav.jianguoyun.com/dav/Books/.Notes/',
    username: '',
    secretId: '',
    noteOrder: 'backup',
    bookListLimit: 0,
    bookListSort: 'backup-date',
    bookListDirection: 'desc',
    
    insertAction: "ask",
    
    noteTemplate: '> {highlightText} ^{id}\n> <span style="color: {color}">{note}</span>\n\n'
}
