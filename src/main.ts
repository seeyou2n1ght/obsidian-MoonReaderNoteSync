import { Plugin, Platform, Notice, TFile, MarkdownView } from 'obsidian';
import { MoonReaderSyncSettings, DEFAULT_SETTINGS } from './settings';
import { MoonReaderWebDAVSettingTab } from './ui/settingTab';
import { WebDAVClient } from './utils/webdav';
import { AnParser, MoonReaderNote } from './utils/anParser';
import { BookSuggestModal, BookItem } from './ui/bookSuggestModal';

export default class MoonReaderSyncPlugin extends Plugin {
    settings: MoonReaderSyncSettings;

    async onload() {
        if (Platform.isMobile) {
            console.log("MoonReader WebDAV Sync Plugin is disabled on mobile devices.");
            return;
        }
        
        await this.loadSettings();

        this.addSettingTab(new MoonReaderWebDAVSettingTab(this.app, this));

        this.addRibbonIcon('cloud-download', 'Sync WebDAV Notes', () => {
            this.pullNotesCommand();
        });

        this.addCommand({
            id: 'pull-moonreader-notes',
            name: 'Sync Notes from WebDAV (Network)',
            callback: () => {
                this.pullNotesCommand();
            }
        });

        this.addCommand({
            id: 'open-moonreader-cache',
            name: 'Select Book from Local Cache',
            callback: async () => {
                const books = await this.loadCache();
                if (books.length === 0) {
                    new Notice("Local cache is empty. Please Sync from WebDAV first.");
                    return;
                }
                new BookSuggestModal(this.app, this, books).open();
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async loadCache(): Promise<BookItem[]> {
        const cachePath = this.manifest.dir + '/moonreader_cache.json';
        if (await this.app.vault.adapter.exists(cachePath)) {
            const data = await this.app.vault.adapter.read(cachePath);
            try {
                return JSON.parse(data);
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    async saveCache(books: BookItem[]) {
        const cachePath = this.manifest.dir + '/moonreader_cache.json';
        await this.app.vault.adapter.write(cachePath, JSON.stringify(books));
    }

    async pullNotesCommand() {
        if (!this.settings.webDavUrl || !this.settings.username || !this.settings.encryptedPass || !this.settings.keyFilePath) {
            new Notice("Please configure WebDAV settings and local key first.");
            return;
        }

        new Notice("Connecting to WebDAV and pulling all notes...");
        const client = new WebDAVClient(this.settings.webDavUrl, this.settings.username, this.settings.encryptedPass, this.settings.keyFilePath);
        
        try {
            const files = await client.getFiles();
            const anFiles = files.filter(f => f.href.endsWith('.an'));
            
            if (anFiles.length === 0) {
                new Notice("No .an files found in the specified path.");
                return;
            }

            const books: BookItem[] = [];
            for (const file of anFiles) {
                try {
                    const buf = await client.getFileBuffer(file.href);
                    const parsedNotes = AnParser.parseBuffer(buf);
                    const bookName = parsedNotes.length > 0 ? parsedNotes[0].bookName : (file.href.split('/').pop() || "Unknown Book");
                    books.push({ fileHref: file.href, bookName, notes: parsedNotes });
                } catch(e) {
                    console.error("Failed to parse", file.href, e);
                }
            }

            if (books.length === 0) {
                new Notice("Failed to parse any books.");
                return;
            }

            await this.saveCache(books);
            new Notice(`Successfully synced and cached ${books.length} books!`);
            new BookSuggestModal(this.app, this, books).open();

        } catch (e) {
            console.error("Pull notes failed", e);
            new Notice("Failed to pull notes. Check console for details.");
        }
    }

    renderNotes(notes: MoonReaderNote[], template: string): string {
        let result = "";
        for (const note of notes) {
            let rendered = template;
            rendered = rendered.replace(/{bookName}/g, note.bookName);
            rendered = rendered.replace(/{chapter}/g, note.chapter);
            rendered = rendered.replace(/{highlightText}/g, note.highlightText);
            rendered = rendered.replace(/{note}/g, note.note);
            rendered = rendered.replace(/{color}/g, note.colorHex);
            rendered = rendered.replace(/{timestamp}/g, note.timestamp);
            rendered = rendered.replace(/{id}/g, note.id);
            result += rendered;
        }
        return result;
    }

    async getPreviewText(item: BookItem): Promise<string> {
        const previewNotes = item.notes.slice(0, 3);
        return this.renderNotes(previewNotes, this.settings.noteTemplate);
    }

    async importBookToCursor(item: BookItem, template: string) {
        new Notice(`Importing ${item.bookName}...`);
        const text = this.renderNotes(item.notes, template);
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            const editor = activeView.editor;
            editor.replaceSelection(text);
            new Notice("Notes inserted successfully!");
        } else {
            new Notice("No active markdown view found. Please open a note first.");
        }
    }

    async importBookToFile(item: BookItem, template: string, file: TFile) {
        new Notice(`Importing ${item.bookName} to ${file.basename}...`);
        const textToInsert = this.renderNotes(item.notes, template);
        
        const content = await this.app.vault.read(file);
        
        let action = this.settings.insertAction;
        
        if (action === "overwrite") {
            const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
            const match = content.match(frontmatterRegex);
            const frontmatter = match ? match[0] : "";
            
            await this.app.vault.modify(file, frontmatter + textToInsert);
        } else {
            // Default or append
            await this.app.vault.modify(file, content + (content.endsWith("\n") ? "" : "\n") + textToInsert);
        }
        
        new Notice("Notes imported successfully!");
    }
}
