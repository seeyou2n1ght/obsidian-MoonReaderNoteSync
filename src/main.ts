import { Plugin, Platform, Notice, TFile, MarkdownView } from 'obsidian';
import { MoonReaderSyncSettings, DEFAULT_SETTINGS } from './settings';
import { MoonReaderWebDAVSettingTab } from './ui/settingTab';
import { WebDAVClient } from './utils/webdav';
import { AnParser, MoonReaderNote } from './utils/anParser';
import { BookSuggestModal, BookItem } from './ui/bookSuggestModal';
import { CryptoHelper } from './utils/crypto';

export default class MoonReaderSyncPlugin extends Plugin {
    settings: MoonReaderSyncSettings;

    async onload() {
        CryptoHelper.init(this.app);
        
        await this.loadSettings();

        this.addSettingTab(new MoonReaderWebDAVSettingTab(this.app, this));

        this.addRibbonIcon('cloud-download', 'Sync MoonReader Notes', () => {
            this.pullNotesCommand();
        });

        this.addCommand({
            id: 'pull-moonreader-notes',
            name: 'Sync Notes (Smart)',
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

    async loadCache(): Promise<BookItem[]> {
        const cachePath = this.manifest.dir + '/moonreader_cache.json';
        if (await this.app.vault.adapter.exists(cachePath)) {
            const data = await this.app.vault.adapter.read(cachePath);
            try {
                const parsed = JSON.parse(data);
                // Invalidate poisoned cache from older buggy parsers
                if (parsed.length > 0 && parsed[0].notes && parsed[0].notes.length > 0 && parsed[0].notes[0].originalPath !== undefined) {
                    console.log("Found outdated cache format. Invalidating cache.");
                    return [];
                }
                return parsed;
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

        const cachedBooks = await this.loadCache();
        const cacheMap = new Map<string, BookItem>();
        for (const b of cachedBooks) {
            cacheMap.set(b.fileHref, b);
        }

        const client = new WebDAVClient(this.settings.webDavUrl, this.settings.username, this.settings.encryptedPass, this.settings.keyFilePath);
        
        let anFiles: WebDAVFile[] = [];
        try {
            const files = await client.getFiles();
            anFiles = files.filter(f => f.href.endsWith('.an'));
        } catch (e) {
            console.error("WebDAV check failed", e);
            if (cachedBooks.length > 0) {
                new Notice("Network unavailable or 403. Opening from local cache.");
                new BookSuggestModal(this.app, this, cachedBooks).open();
                return;
            } else {
                new Notice("Failed to connect and no local cache available.");
                return;
            }
        }

        if (anFiles.length === 0) {
            new Notice("No .an files found on WebDAV.");
            return;
        }

        const books: BookItem[] = [];
        let updatedCount = 0;

        for (const file of anFiles) {
            const cached = cacheMap.get(file.href);
            // 增量检查：如果缓存存在且文件的修改时间和大小都没变，直接用缓存
            if (cached && cached.lastModified === file.lastModified && cached.contentLength === file.contentLength) {
                books.push(cached);
            } else {
                try {
                    const buf = await client.getFileBuffer(file.href);
                    const parsedNotes = AnParser.parseBuffer(buf);
                    const bookName = parsedNotes.length > 0 ? parsedNotes[0].bookName : (file.href.split('/').pop() || "Unknown Book");
                    books.push({ 
                        fileHref: file.href, 
                        bookName, 
                        notes: parsedNotes,
                        lastModified: file.lastModified,
                        contentLength: file.contentLength
                    });
                    updatedCount++;
                } catch(e) {
                    console.error("Failed to fetch/parse", file.href, e);
                }
            }
        }

        if (books.length === 0) {
            new Notice("Failed to parse any books.");
            return;
        }

        if (updatedCount > 0 || books.length !== cachedBooks.length) {
            await this.saveCache(books);
            new Notice(updatedCount > 0 ? `Synced successfully. ${updatedCount} books updated.` : `Synced successfully. Cache rebuilt.`);
        } else {
            new Notice("Everything is up to date. Loaded from cache.");
        }
        
        new BookSuggestModal(this.app, this, books).open();
    }

function escapeHtml(text: string): string {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

    renderNotes(notes: MoonReaderNote[], template: string): string {
        let result = "";
        for (const note of notes) {
            let rendered = template;
            rendered = rendered.replace(/{bookName}/g, escapeHtml(note.bookName));
            rendered = rendered.replace(/{chapter}/g, escapeHtml(note.chapter));
            rendered = rendered.replace(/{highlightText}/g, escapeHtml(note.highlightText));
            rendered = rendered.replace(/{note}/g, escapeHtml(note.note));
            rendered = rendered.replace(/{color}/g, escapeHtml(note.colorHex));
            rendered = rendered.replace(/{timestamp}/g, escapeHtml(note.timestamp));
            rendered = rendered.replace(/{id}/g, escapeHtml(note.id));
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
