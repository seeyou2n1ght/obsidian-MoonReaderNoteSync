import { Component, DropdownComponent } from 'obsidian';
import type MoonReaderSyncPlugin from '../main';
import { isNoteOrder, noteOrders, type NoteOrder } from '../settings';
import { errorMessage, t } from '../i18n';

export function bookOrderOptions() {
    return [
        ['backup-date', 'desc', t('备份时间从新到旧', 'Backup date, newest first')],
        ['backup-date', 'asc', t('备份时间从旧到新', 'Backup date, oldest first')],
        ['title', 'asc', t('书名升序', 'Title, ascending')],
        ['title', 'desc', t('书名降序', 'Title, descending')]
    ] as const;
}

export function sortPreference(plugin: MoonReaderSyncPlugin, owner: Component, dropdown: DropdownComponent,
    kind: 'book' | 'note', feedback: HTMLElement, onSaving = (_saving: boolean) => {}) {
    const current = () => kind === 'note' ? plugin.settings.noteOrder :
        plugin.settings.bookListSort + '/' + plugin.settings.bookListDirection;
    if (kind === 'note') {
        const labels: Record<NoteOrder, string> = {
            backup: t('备份原序', 'Backup order'),
            'chapter-asc': t('章节从前到后', 'Chapter, first to last'),
            'chapter-desc': t('章节从后到前', 'Chapter, last to first'),
            'time-asc': t('批注时间从早到晚', 'Annotation time, oldest first'),
            'time-desc': t('批注时间从晚到早', 'Annotation time, newest first')
        };
        for (const key of noteOrders) dropdown.addOption(key, labels[key]);
    } else {
        for (const [sort, direction, label] of bookOrderOptions()) dropdown.addOption(sort + '/' + direction, label);
    }
    const sync = () => dropdown.setValue(current());
    sync();
    plugin.listeners.add(sync);
    owner.register(() => plugin.listeners.delete(sync));
    dropdown.onChange(async value => {
        if (dropdown.selectEl.disabled || current() === value) return;
        dropdown.setDisabled(true);
        onSaving(true);
        feedback.setText(t('正在保存排序…', 'Saving order…'));
        try {
            if (kind === 'note' && isNoteOrder(value)) await plugin.updateSettings({ noteOrder: value });
            else if (kind === 'book') {
                const option = bookOrderOptions().find(([sort, direction]) => sort + '/' + direction === value);
                if (!option) return;
                await plugin.updateSettings({ bookListSort: option[0], bookListDirection: option[1] });
            }
            feedback.setText('');
            plugin.notify();
        } catch (error) {
            sync();
            feedback.setText(t('排序未保存，仍使用「', 'Order was not saved. Current order: ') +
                dropdown.selectEl.selectedOptions[0].text + t('」。', '. ') + errorMessage(error));
        } finally { sync(); dropdown.setDisabled(false); onSaving(false); }
    });
}
