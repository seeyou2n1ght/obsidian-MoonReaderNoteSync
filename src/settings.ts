export interface MoonReaderSyncSettings {
    webDavUrl: string;
    username: string;
    secretId: string;
    
    insertAction: "ask" | "append" | "overwrite";
    
    noteTemplate: string;
}

export const DEFAULT_SETTINGS: MoonReaderSyncSettings = {
    webDavUrl: 'https://dav.jianguoyun.com/dav/Books/.Notes/',
    username: '',
    secretId: '',
    
    insertAction: "ask",
    
    noteTemplate: '> {highlightText} ^{id}\n> <span style="color: {color}">{note}</span>\n\n'
}
