import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { harness, button, input, change, until, deferred, openImport, chooseMode, chooseSort, book } from './helpers.mjs';
import { packed, entry, xml, server, connected, submitConnection, passwordInput, settings } from './webdav-helpers.mjs';

test('library defaults to cursor insertion; closing does not write; overwrite requires confirmation', async t => {
    const h = await harness(t), before = h.files.get(h.target);
    let modal = await openImport(h);
    assert.equal(button(modal.modalEl, 'Insert all 1 note').disabled, false);
    modal.close();
    assert.equal(h.state.writes, 0);
    modal = await openImport(h); chooseMode(h, modal, 'overwrite');
    assert.equal(button(modal.modalEl, 'Replace all 1 note').disabled, true);
    button(modal.modalEl, 'Replace all 1 note').click();
    assert.equal(h.state.writes, 0);
    button(modal.modalEl, 'Confirm replacement').click();
    await until(() => h.state.writes === 1);
    assert.ok(h.files.get(h.target).startsWith('---\ntitle: test\n---\n'));
    assert.ok(!h.files.get(h.target).includes('Original body.'));
    assert.notEqual(h.files.get(h.target), before);
});

test('import double click commits once; failed write retains target and mode; success closes with a notice', async t => {
    const h = await harness(t), modal = await openImport(h), before = h.files.get(h.target);
    chooseMode(h, modal, 'append'); h.state.failWrite = true;
    button(modal.modalEl, 'Append all 1 note').click();
    await until(() => [...modal.modalEl.querySelectorAll('button')].some(el => el.textContent === 'Append all 1 note' && !el.disabled));
    assert.equal(h.files.get(h.target), before); assert.equal(h.state.writes, 0);
    assert.match(modal.contentEl.textContent, /Append to end/);
    h.state.failWrite = false;
    const gate = deferred(); h.state.beforeWrite = () => gate.promise;
    const submit = button(modal.modalEl, 'Append all 1 note');
    submit.click(); submit.click();
    assert.equal(submit.disabled, true);
    gate.resolve(); await until(() => h.state.writes === 1);
    assert.equal(h.files.get(h.target).split('Highlight').length - 1, 1);
    assert.equal(modal.modalEl.isConnected, false);
    assert.match(h.document.querySelector('.notice').textContent, /1 notes written to Target.md/);
});

test('no active note requires a target; stale cursor is refused with an append recovery action', async t => {
    const h = await harness(t);
    const empty = await openImport(h, null);
    assert.equal(h.state.writes, 0);
    button(empty.modalEl, 'Choose note').click();
    const picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    picker.querySelector('input').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(h.state.writes, 0);
    await until(() => !button(empty.modalEl, 'Append all 1 note').disabled);
    button(empty.modalEl, 'Append all 1 note').click(); await until(() => h.state.writes === 1);
    const stale = await openImport(h);
    h.files.set(h.target, h.files.get(h.target) + 'Concurrent edit.');
    button(stale.modalEl, 'Insert all 1 note').click();
    button(stale.modalEl, 'Import again').click();
    assert.equal(h.state.writes, 1);
    assert.match(stale.contentEl.textContent, /original note.*changed/i);
    button(stale.modalEl, 'Use append instead').click();
    button(stale.modalEl, 'Append all 1 note').click(); button(stale.modalEl, 'Import again').click(); await until(() => h.state.writes === 2);
    assert.match(h.files.get(h.target), /Concurrent edit/);
});

test('changing overwrite target resets confirmation and canceling picker preserves context', async t => {
    const h = await harness(t), modal = await openImport(h);
    chooseMode(h, modal, 'overwrite');
    assert.equal(modal.contentEl.querySelector('.moonreader-import-actions').hidden, true);
    button(modal.modalEl, 'Cancel').click();
    modal.contentEl.querySelector('.moonreader-destination button').click();
    let picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    picker.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(modal.contentEl.querySelector('.moonreader-confirmation').hidden, true);
    modal.contentEl.querySelector('.moonreader-destination button').click();
    picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    const search = picker.querySelector('input'); change(h, search, 'Other');
    search.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.match(modal.contentEl.textContent, /Other.md/);
    assert.equal(modal.contentEl.querySelector('.moonreader-confirmation').hidden, true);
    await until(() => !button(modal.modalEl, 'Append all 1 note').disabled);
    assert.equal(h.state.writes, 0);
});

test('preview ignores stale async renders and closing disposes its components', async t => {
    const h = await harness(t), gates = new Map();
    h.host.MarkdownRenderer.render = async (_app, text, el) => { const gate = deferred(); gates.set(text, gate); await gate.promise; el.textContent = text; };
    const el = h.document.createElement('div'), preview = new h.NotePreview(h.app, el);
    preview.load();
    const old = preview.render('old', ''), latest = preview.render('latest', '');
    gates.get('latest').resolve(); await latest;
    gates.get('old').resolve(); await old;
    assert.equal(el.textContent, 'latest');
    const closing = preview.render('closed', ''); preview.unload();
    gates.get('closed').resolve(); await closing;
    assert.equal(el.textContent, 'latest');
});

test('selection and search update the preview in the same dialog and no matches disables insertion', async t => {
    const h = await harness(t), modal = await openImport(h);
    h.plugin.cache.books = [book, { ...book, fileHref: 'https://fixture.test/other.an', bookName: 'Second book', notes: [{ ...book.notes[0], highlightText: 'Second highlight' }] }];
    h.plugin.notify();
    const first = modal.contentEl.querySelector('[role=option]'); first.focus();
    first.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(h.document.activeElement.getAttribute('aria-selected'), 'true');
    assert.match(h.document.activeElement.textContent, /Second book/);
    modal.contentEl.querySelector('[role=option][title="Second book"]').click();
    await until(() => modal.contentEl.querySelector('.moonreader-preview').textContent.includes('Second highlight'));
    assert.equal(h.document.querySelectorAll('[role=dialog]').length, 1);
    assert.equal(h.state.writes, 0);
    change(h, modal.inputEl, 'no matches');
    assert.equal(button(modal.modalEl, 'Insert all 0 notes').disabled, true);
    assert.equal(modal.contentEl.querySelector('.moonreader-reading > div').hidden, true);
    change(h, modal.inputEl, 'Synthetic');
    await until(() => !button(modal.modalEl, 'Insert all 1 note').disabled);
    button(modal.modalEl, 'Insert all 1 note').click();
    assert.equal(h.state.writes, 1);
    assert.equal(modal.modalEl.isConnected, false);
});

test('an unconfigured library shows a setup action without sending a request', async t => {
    const h = await harness(t), modal = await openImport(h);
    const cache = h.plugin.cache;
    let requests = 0;
    h.host.requestUrl = async () => { requests++; throw new Error('Unexpected request'); };
    assert.match(modal.contentEl.querySelector('[role=status]').textContent, /Backup not configured/);
    assert.equal(h.document.querySelectorAll('[role=dialog]').length, 1);
    assert.equal(h.plugin.cache, cache);
    assert.equal(requests, 0);
    assert.equal(h.state.saves, 0);
    button(modal.contentEl, 'Connect backup').click();
    assert.equal(h.document.querySelectorAll('[role=dialog]').length, 2);
    assert.ok(button(h.document.querySelector('.moonreader-connection'), 'Test connection'));
});

test('keyboard cannot bypass overwrite confirmation; choosing another book cancels replacement', async t => {
    const h = await harness(t), modal = await openImport(h);
    chooseMode(h, modal, 'overwrite');
    modal.inputEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(h.state.writes, 0);
    h.plugin.cache.books = [book, { ...book, fileHref: 'https://fixture.test/other.an', bookName: 'Second book' }];
    h.plugin.notify();
    modal.contentEl.querySelector('[role=option][title="Second book"]').click();
    assert.equal(modal.contentEl.querySelector('.moonreader-confirmation').hidden, true);
    await until(() => !button(modal.modalEl, 'Append all 1 note').disabled);
});

test('close waits for the pending write and prevents repeated submission and selection changes', async t => {
    const h = await harness(t), modal = await openImport(h), gate = deferred();
    chooseMode(h, modal, 'append'); h.state.beforeWrite = () => gate.promise;
    button(modal.modalEl, 'Append all 1 note').click();
    modal.close();
    assert.equal(modal.modalEl.isConnected, true);
    assert.equal(modal.inputEl.disabled, true);
    assert.equal(modal.contentEl.querySelector('button[aria-label="Book order"]').disabled, true);
    assert.equal(modal.contentEl.querySelector('[role=option]').disabled, true);
    gate.resolve();
    await until(() => !modal.modalEl.isConnected);
    assert.equal(h.state.writes, 1);
});

test('template fields insert into the editor selection and update the actual rendered preview', async t => {
    const h = await harness(t), modal = await openImport(h), editor = modal.contentEl.querySelector('textarea');
    change(h, editor, '{highlightText}'); editor.setSelectionRange(0, editor.value.length);
    const field = modal.contentEl.querySelector('button[aria-label="Book {bookName}"]');
    field.click();
    assert.equal(editor.value, '{bookName}');
    assert.equal(h.document.activeElement, editor);
    await until(() => modal.contentEl.querySelector('.moonreader-preview').textContent.includes('Synthetic book'));
    assert.equal(h.state.saves, 0);
});

test('library falls back to an open Markdown note but does not use a closed recent view', async t => {
    const h = await harness(t);
    h.plugin.cache.books = [book]; h.app.workspace.getActiveViewOfType = () => null;
    h.app.workspace.getMostRecentLeaf = () => ({ view: {} });
    h.plugin.openLibrary(false);
    assert.ok(button(h.document.querySelector('.moonreader-library'), 'Insert all 1 note'));
    h.plugin.browser.close();
    h.plugin.recentMarkdownView = h.view;
    h.app.workspace.getLeavesOfType = () => [];
    h.plugin.openLibrary(false);
    assert.ok(button(h.document.querySelector('.moonreader-library'), 'Choose note'));
    assert.equal(h.state.writes, 0);
});

test('repeated imports require explicit confirmation and keyboard/cancel cannot duplicate content', async t => {
    const h = await harness(t);
    let modal = await openImport(h); chooseMode(h, modal, 'append');
    button(modal.modalEl, 'Append all 1 note').click(); await until(() => h.state.writes === 1);
    modal = await openImport(h); chooseMode(h, modal, 'append');
    assert.match(modal.contentEl.querySelector('.moonreader-warning').textContent, /already imported/);
    button(modal.modalEl, 'Append all 1 note').click();
    modal.inputEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    assert.equal(h.state.writes, 1);
    button(modal.modalEl, 'Cancel').click(); assert.equal(h.state.writes, 1);
    button(modal.modalEl, 'Append all 1 note').click(); button(modal.modalEl, 'Import again').click();
    await until(() => h.state.writes === 2);
    assert.equal(h.files.get(h.target).split('Highlight').length - 1, 2);
});

test('library sorts backups before limiting, searches all cached books and never changes cache order', async t => {
    const h = await harness(t);
    const books = [
        { ...book, fileHref: 'https://fixture.test/a.an', bookName: 'Book 10', lastModified: '2026-01-01T00:00:00Z' },
        { ...book, fileHref: 'https://fixture.test/b.an', bookName: 'Book 2', lastModified: '2026-03-01T00:00:00Z' },
        { ...book, fileHref: 'https://fixture.test/c.an', bookName: 'Alpha', lastModified: 'invalid' },
        { ...book, fileHref: 'https://fixture.test/d.an', bookName: 'beta' }
    ];
    const originalOrder = books.map(item => item.fileHref);
    h.plugin.cache.books = books;
    const modal = new h.BookSuggestModal(h.app, h.plugin, h.view, () => {}); modal.open();
    const titles = () => [...modal.contentEl.querySelectorAll('[role=option] > span:first-child')].map(el => el.textContent);
    assert.deepEqual(titles(), ['Book 2', 'Book 10', 'Alpha', 'beta']);
    await h.plugin.updateSettings({ bookListLimit: 1 }); h.plugin.notify();
    assert.deepEqual(titles(), ['Book 2']);
    assert.match(modal.contentEl.textContent, /Showing 1 \/ 4/);
    change(h, modal.inputEl, 'Alpha');
    assert.deepEqual(titles(), ['Alpha']);
    change(h, modal.inputEl, 'absent');
    assert.deepEqual(titles(), []); assert.equal(button(modal.modalEl, 'Insert all 0 notes').disabled, true);
    change(h, modal.inputEl, '');
    await h.plugin.updateSettings({ bookListSort: 'title', bookListDirection: 'asc', bookListLimit: 0 }); h.plugin.notify();
    assert.deepEqual(titles(), ['Alpha', 'beta', 'Book 2', 'Book 10']);
    assert.deepEqual(h.plugin.cache.books, books);
    assert.deepEqual(h.plugin.cache.books.map(item => item.fileHref), originalOrder);
    assert.equal(h.plugin.cache.books[0].bookName, 'Book 10');
    books[0].lastModified = books[1].lastModified;
    await h.plugin.updateSettings({ bookListSort: 'backup-date', bookListDirection: 'desc' }); h.plugin.notify();
    assert.deepEqual(titles(), ['Book 2', 'Book 10', 'Alpha', 'beta']);
    assert.equal(h.state.writes, 0);
    modal.close();
});

test('sort menu preserves search and selection, saves both directions and keeps unknown dates last', async t => {
    const h = await harness(t);
    h.plugin.cache.books = [
        { ...book, bookName: 'Book A', fileHref: 'https://fixture.test/a.an', lastModified: '2026-01-01T00:00:00Z' },
        { ...book, bookName: 'Book Z', fileHref: 'https://fixture.test/z.an', lastModified: '2026-02-01T00:00:00Z' },
        { ...book, bookName: 'Book M', fileHref: 'https://fixture.test/m.an' },
        { ...book, bookName: 'Book X', fileHref: 'https://fixture.test/x.an', lastModified: 'invalid' }
    ];
    let modal = new h.BookSuggestModal(h.app, h.plugin, h.view, () => {}); modal.open();
    const titles = () => [...modal.contentEl.querySelectorAll('[role=option]')].map(row => row.title);
    change(h, modal.inputEl, 'Book');
    chooseSort(h, modal, 'Title, ascending'); await until(() => h.plugin.settings.bookListSort === 'title');
    assert.deepEqual(titles(), ['Book A', 'Book M', 'Book X', 'Book Z']);
    assert.equal(modal.inputEl.value, 'Book'); assert.equal(modal.contentEl.querySelector('[aria-selected=true]').title, 'Book Z');
    chooseSort(h, modal, 'Title, descending'); await until(() => h.plugin.settings.bookListDirection === 'desc');
    assert.deepEqual(titles(), ['Book Z', 'Book X', 'Book M', 'Book A']);
    chooseSort(h, modal, 'Backup date, newest first'); await until(() => h.plugin.settings.bookListSort === 'backup-date');
    assert.deepEqual(titles(), ['Book Z', 'Book A', 'Book M', 'Book X']);
    chooseSort(h, modal, 'Backup date, oldest first'); await until(() => h.plugin.settings.bookListDirection === 'asc');
    assert.deepEqual(titles(), ['Book A', 'Book Z', 'Book M', 'Book X']);
    await h.plugin.updateSettings({ bookListLimit: 1 }); h.plugin.notify();
    assert.equal(modal.contentEl.querySelector('[aria-selected=true]').title, 'Book A');
    assert.equal(modal.contentEl.querySelector('.moonreader-book-title').textContent, 'Book A');
    modal.close(); modal = new h.BookSuggestModal(h.app, h.plugin, h.view, () => {}); modal.open();
    assert.equal(modal.contentEl.querySelector('button[aria-label="Book order"]').textContent, 'Modified ↑');
    const saved = JSON.parse(await fs.readFile(join(h.vault, h.dir, 'data.json'), 'utf8'));
    assert.equal(saved.bookListDirection, 'asc'); assert.equal(saved.bookListSort, 'backup-date');
    assert.equal(h.state.writes, 0); modal.close();
});

test('library shows the configured server and retains explicit replacement target details', async t => {
    const h = await harness(t);
    h.target.path = 'Folder/Target.md';
    const modal = await openImport(h);
    const destination = modal.contentEl.querySelector('.moonreader-destination button');
    assert.equal(destination.textContent, h.target.path); assert.equal(destination.title, h.target.path);
    assert.ok(destination.getAttribute('aria-label').includes(h.target.path));
    assert.equal(modal.contentEl.querySelector('.moonreader-source').hidden, true);
    h.secrets.set('synthetic', 'synthetic-password');
    await h.plugin.updateSettings({ username: 'reader', secretId: 'synthetic' }); h.plugin.notify();
    assert.equal(modal.contentEl.querySelector('.moonreader-source').hidden, false);
    chooseMode(h, modal, 'overwrite');
    assert.ok(modal.contentEl.querySelector('.moonreader-confirmation').textContent.includes(h.target.path));
    assert.equal(h.state.writes, 0); modal.close();
});

test('invalid and duplicate names report inline without requests or secret writes; collision during testing is refused', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    h.secrets.set('shared-webdav', 'untouched-shared-password');
    const tab = settings(h), before = { ...h.plugin.settings }, writes = h.secretState.writes;
    button(tab.containerEl, 'New Keychain').click();
    const name = tab.containerEl.querySelector('input[aria-label="Keychain name"]');
    change(h, passwordInput(tab), 'synthetic-test-password');
    for (const value of ['', 'Home NAS', '中文', 'a'.repeat(65), 'shared-webdav']) {
        change(h, name, value);
        assert.equal(name.getAttribute('aria-invalid'), 'true');
        submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
        assert.equal(h.document.activeElement, name);
        assert.equal(dav.state.requests.length, 0); assert.equal(h.secretState.writes, writes);
        assert.deepEqual(h.plugin.settings, before);
    }
    assert.equal(h.secrets.get('shared-webdav'), 'untouched-shared-password');
    change(h, name, 'moonreader-home-nas');
    assert.equal(name.getAttribute('aria-invalid'), 'false');
    dav.state.beforeList = async () => { h.secrets.set('moonreader-home-nas', 'other-writer-password'); };
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.deepEqual(h.plugin.settings, before);
    assert.equal(h.secrets.get('moonreader-home-nas'), 'other-writer-password');
    assert.equal(h.secretState.writes, writes);
    assert.match(tab.containerEl.querySelector('.moonreader-credential-name-error').textContent, /already exists/);
    button(tab.containerEl, 'Cancel creation').click();
    assert.equal(name.value, ''); assert.equal(passwordInput(tab).value, '');
    tab.hide();
});

test('cached native setting definitions discard hidden drafts before rebuilding controls', async t => {
    const h = await harness(t), dav = await server(t);
    const tab = new h.MoonReaderWebDAVSettingTab(h.app, h.plugin);
    const definitions = tab.getSettingDefinitions();
    const render = () => {
        tab.containerEl.empty();
        for (const definition of definitions) {
            const group = new h.host.SettingGroup(tab.containerEl).setHeading(definition.heading || '');
            for (const item of definition.items || []) item.render?.(new h.host.Setting(group.listEl).setName(item.name).setDesc(item.desc || ''), group);
        }
    };
    render();
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url);
    change(h, input(tab.containerEl, 'Username'), 'reader');
    button(tab.containerEl, 'New Keychain').click();
    change(h, tab.containerEl.querySelector('.moonreader-new-password input[type=text]'), 'unsaved-review-key');
    change(h, passwordInput(tab), 'synthetic-test-password');
    tab.hide(); render();
    assert.equal(passwordInput(tab).value, '');
    assert.equal(tab.containerEl.querySelector('.moonreader-new-password input[type=text]').value, '');
    assert.equal(tab.containerEl.querySelector('.moonreader-new-password').hidden, true);
    assert.equal(input(tab.containerEl, 'Username').value, h.plugin.settings.username);
    assert.equal(input(tab.containerEl, 'WebDAV folder URL').value, h.plugin.settings.webDavUrl);
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.match(tab.containerEl.querySelector('.moonreader-status').textContent, /No credential selected/);
    assert.equal(dav.state.requests.length, 0); assert.equal(h.secretState.writes, 0);
    tab.hide();
});

test('closing the captured Markdown view refuses cursor insertion and allows explicit append recovery', async t => {
    const h = await harness(t), modal = await openImport(h), before = h.files.get(h.target);
    h.app.workspace.getLeavesOfType = () => [];
    button(modal.contentEl, 'Insert all 1 note').click();
    await until(() => !modal.panel.busy);
    assert.equal(h.state.writes, 0);
    assert.equal(h.files.get(h.target), before);
    assert.equal(h.plugin.sessionImports.size, 0);
    assert.equal(modal.panel.completed, false);
    assert.match(modal.contentEl.querySelector('.moonreader-import-feedback .moonreader-status').textContent, /closed/);
    button(modal.contentEl, 'Use append instead').click();
    button(modal.contentEl, 'Append all 1 note').click();
    await until(() => h.state.writes === 1);
    assert.ok(h.files.get(h.target).startsWith(before));
    assert.ok(h.files.get(h.target).includes('Highlight'));
    assert.equal(h.plugin.sessionImports.size, 1);
});

test('a failed import catches up deferred cache, selection and preference changes before retry', async t => {
    const h = await harness(t), modal = await openImport(h), gate = deferred();
    chooseMode(h, modal, 'append'); h.state.beforeWrite = () => gate.promise;
    button(modal.contentEl, 'Append all 1 note').click(); await until(() => modal.panel.busy);
    h.plugin.cache.books = [{ ...book, fileHref: 'https://fixture.test/dav/replacement.an', bookName: 'Replacement book', notes: [{ ...book.notes[0], highlightText: 'New highlight' }] }];
    h.plugin.settings.bookListLimit = 1; h.plugin.notify();
    assert.equal(modal.contentEl.querySelector('.moonreader-book-title').textContent, book.bookName);
    h.state.failWrite = true; gate.resolve(); await until(() => !modal.panel.busy);
    assert.equal(modal.contentEl.querySelector('.moonreader-book-item span').textContent, 'Replacement book');
    assert.equal(modal.contentEl.querySelector('[aria-selected=true]'), null);
    assert.match(modal.contentEl.querySelector('.moonreader-empty').textContent, /Choose a book/);
    assert.equal(button(modal.contentEl, 'Append all 0 notes').disabled, true);
    modal.inputEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    assert.equal(h.state.writes, 0);
    assert.match(modal.contentEl.querySelector('.moonreader-import-feedback .moonreader-status').textContent, /Operation failed/);
    modal.contentEl.querySelector('.moonreader-book-item').click();
    await until(() => modal.contentEl.querySelector('.moonreader-preview').textContent.includes('New highlight'));
    h.state.failWrite = false; h.state.beforeWrite = null;
    button(modal.contentEl, 'Append all 1 note').click(); await until(() => h.state.writes === 1);
    assert.ok(h.files.get(h.target).includes('New highlight')); assert.ok(!h.files.get(h.target).includes('> Highlight'));
});

test('an import records the source captured before a concurrent cache switch', async t => {
    const h = await harness(t); h.plugin.cache.source = 'old-source';
    const modal = await openImport(h), gate = deferred(); chooseMode(h, modal, 'append'); h.state.beforeWrite = () => gate.promise;
    button(modal.contentEl, 'Append all 1 note').click(); await until(() => modal.panel.busy);
    h.plugin.cache = { ...h.plugin.cache, source: 'new-source', books: [] }; h.plugin.notify();
    gate.resolve(); await until(() => !modal.panel.busy);
    assert.ok(h.plugin.sessionImports.has(JSON.stringify(['old-source', book.fileHref, h.target.path])));
    assert.ok(!h.plugin.sessionImports.has(JSON.stringify(['new-source', book.fileHref, h.target.path])));
});

test('default orders drive the library, bounded and full previews, and complete import', async t => {
    const h = await harness(t), tab = settings(h);
    const pref = label => tab.containerEl.querySelector('select[aria-label^="' + label + '"]');
    change(h, pref('Default book order'), 'title/desc', 'change');
    await until(() => h.plugin.settings.bookListSort === 'title');
    change(h, pref('Default note order'), 'chapter-asc', 'change');
    await until(() => h.plugin.settings.noteOrder === 'chapter-asc');
    const notes = [['X', '10', ''], ['B', '2', '2026-01-01'], ['C', '2', '2026-01-01'], ['A', '1', '2026-02-01']]
        .map(([highlightText, chapter, timestamp]) => ({ ...book.notes[0], highlightText, chapter, timestamp }));
    h.plugin.cache.books = [{ ...book, notes }];
    await h.plugin.updateSettings({ noteTemplate: '{highlightText}' });
    const modal = new h.BookSuggestModal(h.app, h.plugin, h.view, () => {}); modal.open();
    const preview = () => modal.contentEl.querySelector('.moonreader-book-preview').textContent;
    await until(() => preview() === 'ABC');
    assert.equal(modal.contentEl.querySelector('[aria-label="Book order"]').textContent, 'Title ↓');
    button(modal.contentEl, 'Preview all').click();
    await until(() => preview() === 'ABCX');
    const order = modal.contentEl.querySelector('select[aria-label="Note order"]');
    change(h, order, 'time-asc', 'change');
    await until(() => preview() === 'BCAX');
    change(h, order, 'time-desc', 'change');
    await until(() => preview() === 'ABCX');
    button(modal.contentEl, 'Show first 3').click();
    await until(() => preview() === 'ABC');
    assert.equal(pref('Default note order').value, 'time-desc');
    assert.equal(notes.map(n => n.highlightText).join(''), 'XBCA');
    button(modal.contentEl, 'Insert all 4 notes').click();
    await until(() => h.state.writes === 1);
    assert.ok(h.files.get(h.target).endsWith('A\n\nB\n\nC\n\nX'));
    tab.hide();
});

test('sorting and pending preview block every write entry until the selected order is visible', async t => {
    for (const replace of [false, true]) {
        const h = await harness(t);
        const modal = await openImport(h);
        h.plugin.cache.books = [{ ...book, notes: ['A', 'B', 'C', 'D'].map((highlightText, index) =>
            ({ ...book.notes[0], highlightText, chapter: String(4 - index) })) }];
        change(h, modal.contentEl.querySelector('textarea'), '{highlightText}');
        h.plugin.notify();
        const preview = modal.contentEl.querySelector('.moonreader-book-preview');
        await until(() => preview.textContent === 'ABC');
        if (replace) chooseMode(h, modal, 'overwrite');
        const action = button(modal.contentEl, replace ? 'Confirm replacement' : 'Insert all 4 notes');
        const save = deferred(), render = deferred();
        h.state.beforeSave = () => save.promise;
        const original = h.host.MarkdownRenderer.render;
        h.host.MarkdownRenderer.render = async (...args) => { await render.promise; return original(...args); };
        change(h, modal.contentEl.querySelector('[aria-label="Note order"]'), 'chapter-asc', 'change');
        const checkBlocked = () => {
            assert.equal(action.disabled, true); action.click();
            modal.inputEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
            assert.equal(h.state.writes, 0);
        };
        checkBlocked();
        save.resolve();
        await until(() => h.plugin.settings.noteOrder === 'chapter-asc');
        assert.equal(preview.textContent, 'ABC');
        checkBlocked(); render.resolve();
        await until(() => !action.disabled);
        assert.equal(preview.textContent, 'DCB');
        action.click(); await until(() => h.state.writes === 1);
        assert.ok(h.files.get(h.target).endsWith('D\n\nC\n\nB\n\nA'));
    }
});

test('expanded preview skips same-book searches and coalesces template edits', async t => {
    const h = await harness(t), modal = await openImport(h);
    h.plugin.cache.books = [{ ...book, notes: Array(120).fill(book.notes[0]) }]; h.plugin.notify();
    button(modal.contentEl, 'Preview all').click();
    await until(() => modal.contentEl.querySelectorAll('.moonreader-book-preview blockquote').length === 240);
    let renders = 0;
    const original = h.host.MarkdownRenderer.render;
    h.host.MarkdownRenderer.render = (...args) => { renders++; return original(...args); };
    for (const query of ['S', 'Sy', 'Syn']) change(h, modal.inputEl, query);
    assert.equal(renders, 0);
    const editor = modal.contentEl.querySelector('textarea');
    for (const template of ['1', '12', '123']) change(h, editor, template);
    assert.equal(button(modal.contentEl, 'Insert all 120 notes').disabled, true);
    await until(() => modal.contentEl.querySelector('.moonreader-book-preview').textContent === '123'.repeat(120));
    assert.equal(renders, 1);
    assert.equal(button(modal.contentEl, 'Insert all 120 notes').disabled, false);
    h.state.beforeSave = async () => { throw new Error('Controlled save failure'); };
    const order = modal.contentEl.querySelector('[aria-label="Note order"]');
    change(h, order, 'chapter-desc', 'change');
    await until(() => !order.disabled);
    assert.equal(order.value, 'backup');
    assert.match(modal.contentEl.querySelector('.moonreader-preview-toolbar').textContent, /Order was not saved.*Backup order/);
    assert.equal(button(modal.contentEl, 'Insert all 120 notes').disabled, false);
    modal.close();
});

test('changing book with arrow keys preserves other rows and points to the selected option', async t => {
    const h = await harness(t);
    h.plugin.cache.books = ['A', 'B', 'C'].map(name => ({ ...book, bookName: name, fileHref: name + '.an' }));
    h.plugin.openLibrary(false);
    const modal = h.plugin.browser;
    const rows = [...modal.contentEl.querySelectorAll('[role=option]')];
    modal.inputEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.deepEqual([...modal.contentEl.querySelectorAll('[role=option]')].map((row, i) => row === rows[i]), [true, true, true]);
    assert.equal(modal.inputEl.getAttribute('aria-activedescendant'), rows[1].id);
    assert.equal(modal.contentEl.querySelector('[aria-selected=true]'), rows[1]);
});

test('compact picker keeps the query and selection while toggling between list and preview', async t => {
    const h = await harness(t), modal = await openImport(h);
    const workspace = modal.contentEl.querySelector('.moonreader-workspace');
    const toggle = workspace.querySelector('.moonreader-switch-book');
    assert.equal(workspace.dataset.picker, 'closed');
    toggle.click();
    change(h, modal.inputEl, 'Synthetic');
    modal.contentEl.querySelector('[role=option]').click();
    assert.equal(workspace.dataset.picker, 'closed');
    toggle.click(); assert.equal(modal.inputEl.value, 'Synthetic');
    assert.equal(modal.contentEl.querySelector('[aria-selected=true]').title, book.bookName);
    h.plugin.cache.books = []; h.plugin.notify();
    assert.equal(workspace.dataset.picker, 'open');
    assert.equal(modal.contentEl.querySelector('.moonreader-import-actions .mod-cta').disabled, true);
});

test('reading pane keeps toolbar outside scrollable body, resets body scroll, and separates trailing-note quotes', async t => {
    const h = await harness(t);
    const notes = [
        { ...book.notes[0], id: '1', highlightText: 'Quote one', note: 'My note' },
        { ...book.notes[0], id: '2', highlightText: 'Quote two', note: '' }
    ];
    h.plugin.cache.books = [
        { ...book, bookName: 'Alpha book', notes },
        { ...book, fileHref: 'https://fixture.test/second.an', bookName: 'Beta book', notes: [notes[1]] }
    ];
    await h.plugin.updateSettings({ noteTemplate: '> {highlightText}\n\n{note}' });
    const modal = new h.BookSuggestModal(h.app, h.plugin, h.view, () => {});
    modal.open();
    const toolbar = modal.contentEl.querySelector('.moonreader-preview-toolbar');
    const body = modal.contentEl.querySelector('.moonreader-reading-body');
    const preview = modal.contentEl.querySelector('.moonreader-book-preview');
    assert.ok(toolbar && body && preview);
    assert.equal(toolbar.parentElement, body.parentElement);
    assert.equal(body.contains(toolbar), false);
    assert.equal(body.contains(preview), true);
    await until(() => preview.querySelectorAll('blockquote').length === 2);
    assert.deepEqual([...preview.querySelectorAll('blockquote')].map(el => el.textContent), ['Quote one', 'Quote two']);
    assert.deepEqual([...preview.querySelectorAll('p')].map(el => el.textContent), ['My note']);
    body.scrollTop = 120;
    button(modal.contentEl, 'Adjust template').click();
    assert.equal(body.scrollTop, 0);
    body.scrollTop = 80;
    modal.contentEl.querySelector('[role=option][title="Beta book"]').click();
    assert.equal(body.scrollTop, 0);
    modal.close();
});

test('target picker creates a new note, template draft tracks dirty/reset state, and modal shortcuts respect textarea and popover', async t => {
    const h = await harness(t), modal = await openImport(h);
    const editor = modal.contentEl.querySelector('textarea');
    const toggle = button(modal.contentEl, 'Adjust template');
    assert.ok(button(modal.contentEl, 'Settings'));
    toggle.click();
    assert.equal(toggle.textContent, 'Hide template');
    assert.equal(toggle.dataset.open, 'true');
    const reset = button(modal.contentEl, 'Reset to default');
    assert.equal(reset.disabled, true);
    change(h, editor, '{highlightText}');
    assert.equal(toggle.dataset.dirty, 'true');
    assert.match(toggle.textContent, /^Hide template · modified$/);
    assert.equal(reset.disabled, false);
    editor.setSelectionRange(0, editor.value.length);
    modal.contentEl.querySelector('button[aria-label="Conditional note {#note}…{/note}"]').click();
    assert.equal(editor.value, '{#note}{highlightText}{/note}');
    editor.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(h.state.writes, 0);
    reset.click();
    assert.equal(editor.value, h.plugin.settings.noteTemplate);
    assert.equal(toggle.dataset.dirty, 'false');
    assert.equal(reset.disabled, true);
    assert.match(modal.contentEl.querySelector('.moonreader-template-status').textContent, /Reset to default/);
    toggle.click();
    assert.equal(toggle.textContent, 'Adjust template');
    assert.equal(toggle.dataset.open, 'false');

    h.plugin.cache.books = [{ ...book, notes: Array.from({ length: 5 }, (_, i) => ({ ...book.notes[0], id: String(i + 1), highlightText: 'Note ' + (i + 1) })) }];
    h.plugin.notify();
    await until(() => !modal.contentEl.querySelector('.moonreader-preview-more').hidden);
    assert.match(modal.contentEl.querySelector('.moonreader-preview-more').textContent, /2 more notes not shown/);
    button(modal.contentEl, 'Show all 5 notes').click();
    await until(() => modal.contentEl.querySelector('.moonreader-preview-more').hidden);
    assert.match(modal.contentEl.querySelector('.moonreader-book-preview').textContent, /Note 5/);

    const details = modal.contentEl.querySelector('.moonreader-source');
    details.open = true;
    modal.modalEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(details.open, false);
    assert.equal(modal.modalEl.isConnected, true);
    details.open = true;
    modal.contentEl.querySelector('.moonreader-book-title').click();
    assert.equal(details.open, false);

    modal.contentEl.querySelector('.moonreader-destination button').click();
    const picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    const search = picker.querySelector('input');
    change(h, search, 'Brand New Book');
    search.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await until(() => modal.contentEl.querySelector('.moonreader-destination button').textContent === 'Brand New Book.md');
    await until(() => !button(modal.modalEl, 'Append all 5 notes').disabled);
    button(modal.modalEl, 'Append all 5 notes').click();
    await until(() => h.state.writes === 1);
    const created = [...h.files.keys()].find(file => file.path === 'Brand New Book.md');
    assert.ok(created);
    assert.match(h.files.get(created), /Note 5/);
});

test('target creation handles folder conflict, vault failure and busy writes; settings template updates sync cleanly', async t => {
    const h = await harness(t), modal = await openImport(h);
    const tab = settings(h);
    const settingsEditor = tab.containerEl.querySelector('textarea');
    change(h, settingsEditor, '> {highlightText}');
    button(tab.containerEl, 'Save default template').click();
    await until(() => h.plugin.settings.noteTemplate === '> {highlightText}');
    assert.equal(modal.contentEl.querySelector('textarea').value, '> {highlightText}');
    assert.equal(button(modal.contentEl, 'Adjust template').dataset.dirty, 'false');

    // Local dirty draft is preserved when default template changes elsewhere.
    change(h, modal.contentEl.querySelector('textarea'), '{note}');
    change(h, settingsEditor, '- {highlightText}');
    button(tab.containerEl, 'Save default template').click();
    await until(() => h.plugin.settings.noteTemplate === '- {highlightText}');
    assert.equal(modal.contentEl.querySelector('textarea').value, '{note}');
    assert.equal(modal.contentEl.querySelector('.moonreader-preview-controls button[aria-expanded]').dataset.dirty, 'true');

    // Folder collision keeps the existing target unchanged and notifies the user.
    const originalGet = h.app.vault.getAbstractFileByPath;
    h.app.vault.getAbstractFileByPath = path => path === 'Taken.md' ? { path } : originalGet(path);
    modal.contentEl.querySelector('.moonreader-destination button').click();
    let picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    change(h, picker.querySelector('input'), 'Taken');
    picker.querySelector('input').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await until(() => [...h.document.querySelectorAll('.notice')].some(el => /folder with that name/i.test(el.textContent)));
    assert.equal(modal.contentEl.querySelector('.moonreader-destination button').textContent, 'Target.md');
    h.app.vault.getAbstractFileByPath = originalGet;

    // Failed vault.create keeps the previous target and surfaces a notice.
    const originalCreate = h.app.vault.create;
    h.app.vault.create = async () => { throw new Error('disk full'); };
    modal.contentEl.querySelector('.moonreader-destination button').click();
    picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    change(h, picker.querySelector('input'), 'Failed Note');
    picker.querySelector('input').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await until(() => [...h.document.querySelectorAll('.notice')].some(el => /Operation failed/i.test(el.textContent)));
    assert.equal(modal.contentEl.querySelector('.moonreader-destination button').textContent, 'Target.md');

    // Pending create finishing while a write is busy cannot switch the target mid-write, and switchBook stays disabled.
    const createGate = deferred(), writeGate = deferred();
    h.app.vault.create = async (path, content) => { await createGate.promise; return originalCreate(path, content); };
    chooseMode(h, modal, 'append');
    h.state.beforeWrite = () => writeGate.promise;
    modal.contentEl.querySelector('.moonreader-destination button').click();
    picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    change(h, picker.querySelector('input'), 'Late Note');
    picker.querySelector('input').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    button(modal.modalEl, 'Append all 1 note').click();
    assert.equal(modal.contentEl.querySelector('.moonreader-switch-book').disabled, true);
    createGate.resolve();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(modal.contentEl.querySelector('.moonreader-destination button').textContent, 'Target.md');
    writeGate.resolve();
    await until(() => !modal.modalEl.isConnected);
    tab.hide();
});
