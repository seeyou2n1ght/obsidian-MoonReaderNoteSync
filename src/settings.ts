export interface MoonReaderSyncSettings {
    webDavUrl: string;
    username: string;
    encryptedPass: string;
    keyFilePath: string;
    moonReaderPath: string;
    
    enableHoverPreview: boolean;
    insertAction: "ask" | "append" | "overwrite";
    
    noteTemplate: string;
}

export const DEFAULT_SETTINGS: MoonReaderSyncSettings = {
    webDavUrl: 'https://dav.jianguoyun.com/dav/',
    username: '',
    encryptedPass: '',
    keyFilePath: '',
    moonReaderPath: '/Books/.Notes/',
    
    enableHoverPreview: true,
    insertAction: "ask",
    
    noteTemplate: '> {highlightText} ^{id}\n> <span style="color: {color}">{note}</span>\n\n'
}
