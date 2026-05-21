import { App, SuggestModal, TFile } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { BookItem } from './bookSuggestModal';

export class FileSuggestModal extends SuggestModal<TFile> {
    plugin: MoonReaderSyncPlugin;
    bookItem: BookItem;
    template: string;

    constructor(app: App, plugin: MoonReaderSyncPlugin, bookItem: BookItem, template: string) {
        super(app);
        this.plugin = plugin;
        this.bookItem = bookItem;
        this.template = template;
        this.setPlaceholder("Select a note to insert into...");
    }

    getSuggestions(query: string): TFile[] {
        const files = this.app.vault.getMarkdownFiles();
        const lowerQuery = query.toLowerCase();
        return files.filter(f => f.path.toLowerCase().includes(lowerQuery));
    }

    renderSuggestion(file: TFile, el: HTMLElement) {
        el.createEl("div", { text: file.basename });
        el.createEl("small", { text: file.path, cls: "nav-folder-title-content" });
    }

    onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
        this.plugin.importBookToFile(this.bookItem, this.template, file);
    }
}
