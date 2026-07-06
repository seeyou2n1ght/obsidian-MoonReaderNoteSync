import { App, SuggestModal, setIcon } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { MoonReaderNote } from '../utils/anParser';
import { TemplateModal } from './templateModal';
import { FileSuggestModal } from './fileSuggestModal';
import { ActionSuggestModal } from './actionSuggestModal';

export interface BookItem {
    fileHref: string;
    bookName: string;
    notes: MoonReaderNote[];
    lastModified?: string;
    contentLength?: number;
}

export class BookSuggestModal extends SuggestModal<BookItem> {
    plugin: MoonReaderSyncPlugin;
    books: BookItem[];
    previewEl: HTMLElement | null = null;

    constructor(app: App, plugin: MoonReaderSyncPlugin, books: BookItem[]) {
        super(app);
        this.plugin = plugin;
        this.books = books;
        this.setPlaceholder("Select a book to import... (Enter: Cursor, Shift+Enter: Edit Template)");
    }

    getSuggestions(query: string): BookItem[] {
        const lowerQuery = query.toLowerCase();
        return this.books.filter(b => b.bookName.toLowerCase().includes(lowerQuery));
    }

    renderSuggestion(item: BookItem, el: HTMLElement) {
        el.addClass("moonreader-book-item");
        el.setCssStyles({ display: "flex" });
        el.setCssStyles({ justifyContent: "space-between" });
        el.setCssStyles({ alignItems: "center" });
        
        el.createSpan({ text: item.bookName });
        
        const actionContainer = el.createDiv({ cls: "moonreader-book-actions" });
        actionContainer.setCssStyles({ display: "none" });
        
        const editBtn = actionContainer.createSpan({ cls: "moonreader-action-btn", title: "Adjust Template" });
        setIcon(editBtn, "pencil");
        editBtn.onClickEvent((evt) => {
            evt.stopPropagation();
            this.close();
            new TemplateModal(this.app, this.plugin, item).open();
        });

        const cursorBtn = actionContainer.createSpan({ cls: "moonreader-action-btn", title: "Insert at Cursor" });
        setIcon(cursorBtn, "text-cursor-input");
        cursorBtn.onClickEvent((evt) => {
            evt.stopPropagation();
            this.close();
            void this.plugin.importBookToCursor(item, this.plugin.settings.noteTemplate);
        });

        const fileBtn = actionContainer.createSpan({ cls: "moonreader-action-btn", title: "Insert to Specific Note" });
        setIcon(fileBtn, "file-plus");
        fileBtn.onClickEvent((evt) => {
            evt.stopPropagation();
            this.close();
            new FileSuggestModal(this.app, this.plugin, item, this.plugin.settings.noteTemplate).open();
        });

        el.addEventListener("mouseenter", () => {
            actionContainer.setCssStyles({ display: "flex" });
            actionContainer.setCssStyles({ gap: "8px" });
            if (this.plugin.settings.enableHoverPreview) {
                void this.showPreview(item, el);
            }
        });
        el.addEventListener("mouseleave", () => {
            actionContainer.setCssStyles({ display: "none" });
            this.hidePreview();
        });
    }

    async showPreview(item: BookItem, el: HTMLElement) {
        if (this.previewEl) this.hidePreview();
        
        const body = activeWindow.document.body;
        if (!body) return;

        const previewEl = body.createDiv({ cls: "moonreader-preview-popover popover" });
        this.previewEl = previewEl;

        previewEl.setCssStyles({ position: "absolute" });
        previewEl.setCssStyles({ zIndex: "1000" });
        previewEl.setCssStyles({ width: "400px" });
        previewEl.setCssStyles({ maxHeight: "300px" });
        previewEl.setCssStyles({ overflow: "auto" });
        previewEl.setCssStyles({ padding: "10px" });
        previewEl.setCssStyles({ backgroundColor: "var(--background-primary)" });
        previewEl.setCssStyles({ border: "1px solid var(--background-modifier-border)" });
        previewEl.setCssStyles({ borderRadius: "5px" });
        previewEl.setCssStyles({ boxShadow: "0 4px 10px rgba(0,0,0,0.5)" });
        
        const rect = el.getBoundingClientRect();
        previewEl.setCssStyles({ top: `${rect.top}px` });
        previewEl.setCssStyles({ left: `${rect.right + 10}px` });

        previewEl.createEl("div", { text: "Loading preview...", cls: "moonreader-preview-loading" });
        
        try {
            const previewText = await this.plugin.getPreviewText(item);
            if (this.previewEl) {
                this.previewEl.empty();
                const pre = this.previewEl.createEl("pre");
                pre.setCssStyles({ whiteSpace: "pre-wrap" });
                pre.innerText = previewText;
            }
        } catch {
            if (this.previewEl) {
                this.previewEl.empty();
                this.previewEl.createEl("div", { text: "Failed to load preview." });
            }
        }
    }

    hidePreview() {
        if (this.previewEl) {
            this.previewEl.remove();
            this.previewEl = null;
        }
    }

    onClose() {
        this.hidePreview();
        super.onClose();
    }

    onChooseSuggestion(item: BookItem, evt: MouseEvent | KeyboardEvent) {
        if (evt.shiftKey) {
            new TemplateModal(this.app, this.plugin, item).open();
            return;
        }

        const action = this.plugin.settings.insertAction;
        if (action === "ask") {
            new ActionSuggestModal(this.app, this.plugin, item).open();
        } else if (action === "append" || action === "overwrite") {
            new FileSuggestModal(this.app, this.plugin, item, this.plugin.settings.noteTemplate, action).open();
        } else {
            // Default fallback
            void this.plugin.importBookToCursor(item, this.plugin.settings.noteTemplate);
        }
    }
}
