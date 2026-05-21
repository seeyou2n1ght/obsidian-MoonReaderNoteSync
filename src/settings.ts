export interface MoonReaderSyncSettings {
    webDavUrl: string;
    username: string;
    encryptedPass: string;
    keyFilePath: string;
    
    enableHoverPreview: boolean;
    insertAction: "ask" | "append" | "overwrite";
    
    noteTemplate: string;
}

export const DEFAULT_SETTINGS: MoonReaderSyncSettings = {
    webDavUrl: 'https://dav.jianguoyun.com/dav/Books/.Notes/',
    username: '',
    encryptedPass: '',
    keyFilePath: '',
    
    enableHoverPreview: true,
    insertAction: "ask",
    
    noteTemplate: '> {highlightText} ^{id}\n> <span style="color: {color}">{note}</span>\n\n'
}
