import { App, SuggestModal, TFile } from 'obsidian';
import { t } from '../i18n';

export class FileSuggestModal extends SuggestModal<TFile> {
    private chosen = false;
    constructor(app: App, private select: (file: TFile) => void, private restoreFocus: () => void) {
        super(app);
        this.setPlaceholder(t('搜索目标笔记…', 'Search target notes…'));
    }
    getSuggestions(query: string): TFile[] {
        return this.app.vault.getMarkdownFiles().filter(f => f.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    }
    renderSuggestion(file: TFile, el: HTMLElement) {
        el.createDiv({ text: file.basename });
        el.createEl('small', { text: file.path, cls: 'moonreader-meta' });
    }
    onChooseSuggestion(file: TFile) { this.chosen = true; this.select(file); this.restoreFocus(); }
    onClose() { super.onClose(); if (!this.chosen) this.restoreFocus(); }
}
