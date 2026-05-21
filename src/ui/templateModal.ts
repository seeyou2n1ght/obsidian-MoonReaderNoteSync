import { App, Modal, Setting, ButtonComponent } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { BookItem } from './bookSuggestModal';
import { FileSuggestModal } from './fileSuggestModal';

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

        new Setting(contentEl)
            .setName('Template')
            .addTextArea(text => {
                text.inputEl.rows = 10;
                text.inputEl.cols = 50;
                text.setValue(this.currentTemplate)
                    .onChange(value => {
                        this.currentTemplate = value;
                    });
            });

        const btnContainer = contentEl.createDiv();
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "flex-end";
        btnContainer.style.gap = "10px";
        btnContainer.style.marginTop = "20px";

        new ButtonComponent(btnContainer)
            .setButtonText("Insert at Cursor")
            .setCta()
            .onClick(() => {
                this.close();
                this.plugin.importBookToCursor(this.bookItem, this.currentTemplate);
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
