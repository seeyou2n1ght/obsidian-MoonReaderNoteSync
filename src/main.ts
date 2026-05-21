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

        this.addRibbonIcon('cloud-download', 'Pull MoonReader Notes', () => {
            this.pullNotesCommand();
        });

        this.addCommand({
            id: 'pull-moonreader-notes',
            name: 'Pull Notes from WebDAV',
            callback: () => {
                this.pullNotesCommand();
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async pullNotesCommand() {
        if (!this.settings.webDavUrl || !this.settings.username || !this.settings.encryptedPass || !this.settings.keyFilePath) {
            new Notice("Please configure WebDAV settings and local key first.");
            return;
        }

        new Notice("Connecting to WebDAV and parsing books...");
        const client = new WebDAVClient(this.settings.webDavUrl, this.settings.username, this.settings.encryptedPass, this.settings.keyFilePath);
        
        try {
            const files = await client.getFiles(this.settings.moonReaderPath);
            const anFiles = files.filter(f => f.href.endsWith('.an'));
            
            if (anFiles.length === 0) {
                new Notice("No .an files found in the specified path.");
                return;
            }

            const books: BookItem[] = [];
            for (const file of anFiles) {
                try {
                    const buf = await client.getFileBuffer(file.href);
                    const bookName = AnParser.parseBookNameOnly(buf) || file.href.split('/').pop() || "Unknown Book";
                    books.push({ file, bookName });
                } catch(e) {
                    console.error("Failed to parse book name for", file.href, e);
                }
            }

            if (books.length === 0) {
                new Notice("Failed to parse any books.");
                return;
            }

            new BookSuggestModal(this.app, this, books).open();

        } catch (e) {
            console.error("Pull notes failed", e);
            new Notice("Failed to pull notes. Check console for details.");
        }
    }

    async getNotesFromWebDAV(item: BookItem): Promise<MoonReaderNote[]> {
        const client = new WebDAVClient(this.settings.webDavUrl, this.settings.username, this.settings.encryptedPass, this.settings.keyFilePath);
        const buf = await client.getFileBuffer(item.file.href);
        return AnParser.parseBuffer(buf);
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
        const notes = await this.getNotesFromWebDAV(item);
        const previewNotes = notes.slice(0, 3);
        return this.renderNotes(previewNotes, this.settings.noteTemplate);
    }

    async importBookToCursor(item: BookItem, template: string) {
        new Notice(`Importing ${item.bookName}...`);
        const notes = await this.getNotesFromWebDAV(item);
        const text = this.renderNotes(notes, template);
        
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
        const notes = await this.getNotesFromWebDAV(item);
        const textToInsert = this.renderNotes(notes, template);
        
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
