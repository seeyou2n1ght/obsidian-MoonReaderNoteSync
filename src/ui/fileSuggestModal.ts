import { App, SuggestModal, TFile } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { BookItem } from './bookSuggestModal';

export class FileSuggestModal extends SuggestModal<string> {
    plugin: MoonReaderSyncPlugin;
    bookItem: BookItem;
    template: string;
    overrideAction?: "append" | "overwrite";

    constructor(app: App, plugin: MoonReaderSyncPlugin, bookItem: BookItem, template: string, overrideAction?: "append" | "overwrite") {
        super(app);
        this.plugin = plugin;
        this.bookItem = bookItem;
        this.template = template;
        this.overrideAction = overrideAction;
        this.setPlaceholder("Select a note to insert into...");
    }

    getSuggestions(query: string): string[] {
        const cache = this.app.metadataCache as unknown as { getCachedFiles(): string[] };
        const files = cache.getCachedFiles();
        const lowerQuery = query.toLowerCase();
        return files.filter(f => f.toLowerCase().includes(lowerQuery) && f.endsWith('.md'));
    }

    renderSuggestion(path: string, el: HTMLElement) {
        const parts = path.split('/');
        const basename = parts[parts.length - 1].replace('.md', '');
        el.createEl("div", { text: basename });
        el.createEl("small", { text: path, cls: "nav-folder-title-content" });
    }

    onChooseSuggestion(path: string, evt: MouseEvent | KeyboardEvent) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            void this.plugin.importBookToFile(this.bookItem, this.template, file, this.overrideAction);
        }
    }
}
