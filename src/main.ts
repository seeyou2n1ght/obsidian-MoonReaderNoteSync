import { Plugin, Platform } from 'obsidian';

export default class MoonReaderSyncPlugin extends Plugin {
    async onload() {
        if (Platform.isMobile) {
            console.log("MoonReader WebDAV Sync Plugin is disabled on mobile devices.");
            return;
        }
        
        console.log("Loading MoonReader WebDAV Sync Plugin");
    }

    async onunload() {
        console.log("Unloading MoonReader WebDAV Sync Plugin");
    }
}
