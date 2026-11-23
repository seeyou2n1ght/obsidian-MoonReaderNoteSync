import { App, Notice, SuggestModal, TFile, normalizePath } from 'obsidian';
import { errorMessage, t, UserError } from '../i18n';

type NoteSuggestion =
    | { kind: 'existing'; file: TFile }
    | { kind: 'create'; path: string; basename: string };

const MAX_NOTE_BASENAME = 180;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function toNewNotePath(raw: string): string {
    let base = Array.from(raw.trim(), ch => (ch.charCodeAt(0) < 32 ? ' ' : ch))
        .join('')
        .replace(/\.md$/i, '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^\.+|\.+$/g, '')
        .trim()
        .slice(0, MAX_NOTE_BASENAME)
        .replace(/^\.+|\.+$/g, '')
        .trim();
    if (!base) return '';
    if (WINDOWS_RESERVED_NAME.test(base)) base += ' note';
    return normalizePath(base + '.md');
}

export class FileSuggestModal extends SuggestModal<NoteSuggestion> {
    private chosen = false;
    constructor(
        app: App,
        private select: (file: TFile) => void,
        private restoreFocus: () => void,
        private suggestedName = ''
    ) {
        super(app);
        this.setPlaceholder(t('搜索已有笔记，或输入新笔记名…', 'Search existing notes or type a new note name…'));
    }
    getSuggestions(query: string): NoteSuggestion[] {
        const files = this.app.vault.getMarkdownFiles();
        const needle = query.toLocaleLowerCase();
        const matched: NoteSuggestion[] = files
            .filter(file => file.path.toLocaleLowerCase().includes(needle))
            .map(file => ({ kind: 'existing', file }));
        const candidatePath = toNewNotePath(query.trim() || this.suggestedName);
        if (candidatePath && !files.some(file => file.path.toLocaleLowerCase() === candidatePath.toLocaleLowerCase())) {
            matched.push({ kind: 'create', path: candidatePath, basename: candidatePath.slice(0, -3) });
        }
        return matched;
    }
    renderSuggestion(item: NoteSuggestion, el: HTMLElement) {
        if (item.kind === 'existing') {
            el.createDiv({ text: item.file.basename });
            el.createEl('small', { text: item.file.path, cls: 'moonreader-meta' });
            return;
        }
        el.createDiv({ text: t('新建笔记：', 'Create note: ') + item.basename });
        el.createEl('small', { text: item.path, cls: 'moonreader-meta' });
    }
    onChooseSuggestion(item: NoteSuggestion) {
        this.chosen = true;
        if (item.kind === 'existing') {
            this.select(item.file);
            this.restoreFocus();
            return;
        }
        void (async () => {
            try {
                const existing = this.app.vault.getAbstractFileByPath(item.path);
                if (existing instanceof TFile) {
                    this.select(existing);
                } else if (existing) {
                    throw new UserError(t('同名目录已存在，请换一个笔记名。', 'A folder with that name already exists. Choose another name.'));
                } else {
                    const created = await this.app.vault.create(item.path, '');
                    this.select(created);
                }
            } catch (error) {
                new Notice(errorMessage(error));
            } finally {
                this.restoreFocus();
            }
        })();
    }
    onClose() { super.onClose(); if (!this.chosen) this.restoreFocus(); }
}
