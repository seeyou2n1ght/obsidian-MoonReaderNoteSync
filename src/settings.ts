export interface MoonReaderSyncSettings {
    webDavUrl: string;
    username: string;
    secretId: string;
    bookListLimit: number;
    bookListSort: 'backup-date' | 'title';
    bookListDirection: 'asc' | 'desc';
    
    insertAction: "ask" | "append" | "overwrite";
    
    noteTemplate: string;
}

export const DEFAULT_SETTINGS: MoonReaderSyncSettings = {
    webDavUrl: 'https://dav.jianguoyun.com/dav/Books/.Notes/',
    username: '',
    secretId: '',
    bookListLimit: 0,
    bookListSort: 'backup-date',
    bookListDirection: 'desc',
    
    insertAction: "ask",
    
    noteTemplate: '> {highlightText} ^{id}\n> <span style="color: {color}">{note}</span>\n\n'
}
