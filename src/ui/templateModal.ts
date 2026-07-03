import { App, Modal, ButtonComponent } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { BookItem } from './bookSuggestModal';
import { FileSuggestModal } from './fileSuggestModal';
import { TemplateBuilderUI } from './templateBuilder';

export class TemplateModal extends Modal {
    plugin: MoonReaderSyncPlugin;
    bookItem: BookItem;
    currentTemplate: string;

    constructor(app: App, plugin: MoonReaderSyncPlugin, bookItem: BookItem) {
        super(app);
        this.plugin = plugin;
        this.bookItem = bookItem;
        this.currentTemplate = plugin.settings.noteTemplate;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.createEl('h2', {text: `Adjust Template for ${this.bookItem.bookName}`});

        TemplateBuilderUI.build(
            contentEl,
            this.app,
            this.plugin,
            this.currentTemplate,
            (value) => {
                this.currentTemplate = value;
            }
        );

        const btnContainer = contentEl.createDiv();
        btnContainer.setCssStyles({ display: "flex" });
        btnContainer.setCssStyles({ justifyContent: "flex-end" });
        btnContainer.setCssStyles({ gap: "10px" });
        btnContainer.setCssStyles({ marginTop: "20px" });

        new ButtonComponent(btnContainer)
            .setButtonText("Insert at Cursor")
            .setCta()
            .onClick(() => {
                this.close();
                void this.plugin.importBookToCursor(this.bookItem, this.currentTemplate);
            });

        new ButtonComponent(btnContainer)
            .setButtonText("Insert to Note")
            .onClick(() => {
                this.close();
                new FileSuggestModal(this.app, this.plugin, this.bookItem, this.currentTemplate).open();
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}
