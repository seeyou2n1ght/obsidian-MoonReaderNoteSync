import { App, SuggestModal } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { BookItem } from './bookSuggestModal';
import { FileSuggestModal } from './fileSuggestModal';

export interface ActionItem {
    label: string;
    action: "cursor" | "append" | "overwrite";
}

export class ActionSuggestModal extends SuggestModal<ActionItem> {
    plugin: MoonReaderSyncPlugin;
    bookItem: BookItem;

    constructor(app: App, plugin: MoonReaderSyncPlugin, bookItem: BookItem) {
        super(app);
        this.plugin = plugin;
        this.bookItem = bookItem;
        this.setPlaceholder("Choose how to insert notes...");
    }

    getSuggestions(query: string): ActionItem[] {
        const options: ActionItem[] = [
            { label: "Insert at Current Cursor", action: "cursor" },
            { label: "Append to Specific Note", action: "append" },
            { label: "Overwrite Specific Note (Preserves Frontmatter)", action: "overwrite" }
        ];
        const lowerQuery = query.toLowerCase();
        return options.filter(o => o.label.toLowerCase().includes(lowerQuery));
    }

    renderSuggestion(item: ActionItem, el: HTMLElement) {
        el.createEl("div", { text: item.label });
    }

    onChooseSuggestion(item: ActionItem, evt: MouseEvent | KeyboardEvent) {
        if (item.action === "cursor") {
            void this.plugin.importBookToCursor(this.bookItem, this.plugin.settings.noteTemplate);
        } else {
            new FileSuggestModal(this.app, this.plugin, this.bookItem, this.plugin.settings.noteTemplate, item.action).open();
        }
    }
}
