import { App, SuggestModal, Notice, setIcon } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { MoonReaderNote, AnParser } from '../utils/anParser';
import { TemplateModal } from './templateModal';
import { FileSuggestModal } from './fileSuggestModal';

export interface BookItem {
    fileHref: string;
    bookName: string;
    notes: MoonReaderNote[];
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
        el.style.display = "flex";
        el.style.justifyContent = "space-between";
        el.style.alignItems = "center";
        
        el.createSpan({ text: item.bookName });
        
        const actionContainer = el.createDiv({ cls: "moonreader-book-actions" });
        actionContainer.style.display = "none";
        
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
            this.plugin.importBookToCursor(item, this.plugin.settings.noteTemplate);
        });

        const fileBtn = actionContainer.createSpan({ cls: "moonreader-action-btn", title: "Insert to Specific Note" });
        setIcon(fileBtn, "file-plus");
        fileBtn.onClickEvent((evt) => {
            evt.stopPropagation();
            this.close();
            new FileSuggestModal(this.app, this.plugin, item, this.plugin.settings.noteTemplate).open();
        });

        el.addEventListener("mouseenter", () => {
            actionContainer.style.display = "flex";
            actionContainer.style.gap = "8px";
            if (this.plugin.settings.enableHoverPreview) {
                this.showPreview(item, el);
            }
        });
        el.addEventListener("mouseleave", () => {
            actionContainer.style.display = "none";
            this.hidePreview();
        });
    }

    async showPreview(item: BookItem, el: HTMLElement) {
        if (this.previewEl) this.hidePreview();
        
        this.previewEl = document.body.createDiv({ cls: "moonreader-preview-popover popover" });
        this.previewEl.style.position = "absolute";
        this.previewEl.style.zIndex = "1000";
        this.previewEl.style.width = "400px";
        this.previewEl.style.maxHeight = "300px";
        this.previewEl.style.overflow = "auto";
        this.previewEl.style.padding = "10px";
        this.previewEl.style.backgroundColor = "var(--background-primary)";
        this.previewEl.style.border = "1px solid var(--background-modifier-border)";
        this.previewEl.style.borderRadius = "5px";
        this.previewEl.style.boxShadow = "0 4px 10px rgba(0,0,0,0.5)";
        
        const rect = el.getBoundingClientRect();
        this.previewEl.style.top = `${rect.top}px`;
        this.previewEl.style.left = `${rect.right + 10}px`;

        this.previewEl.createEl("div", { text: "Loading preview...", cls: "moonreader-preview-loading" });
        
        try {
            const previewText = await this.plugin.getPreviewText(item);
            if (this.previewEl) {
                this.previewEl.empty();
                const pre = this.previewEl.createEl("pre");
                pre.style.whiteSpace = "pre-wrap";
                pre.innerText = previewText;
            }
        } catch(e) {
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
        } else {
            this.plugin.importBookToCursor(item, this.plugin.settings.noteTemplate);
        }
    }
}
