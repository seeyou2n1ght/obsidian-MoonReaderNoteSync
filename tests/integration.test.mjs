import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { harness, button, input, change, until, deferred, openImport, chooseMode, chooseSort, book } from './helpers.mjs';

const packed = deflateSync(['1', 'header', 'version', '#', '100', 'Synthetic book', 'path', 'path', '1', '0', '0', '9', '-65536', '1767225600000', '', 'Thought', 'Highlight', '0', '0', '0', ''].join('\n'));
function entry(href = 'book%23one.an', prop = '') {
    return '<d:response><d:href>' + href + '</d:href><d:propstat><d:prop><d:getlastmodified>Thu, 01 Jan 2026 00:00:00 GMT</d:getlastmodified><d:getcontentlength>' + packed.length + '</d:getcontentlength>' + prop + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
}
const xml = body => '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' + body + '</d:multistatus>';
async function server(t) {
    const state = { status: 207, body: xml(entry()), getStatus: 200, requests: [], authValid: true, beforeList: null };
    const srv = createServer(async (req, res) => {
        state.requests.push({ method: req.method, url: req.url, depth: req.headers.depth });
        state.authValid &&= req.headers.authorization === 'Basic ' + Buffer.from('reader:synthetic-test-password').toString('base64');
        if (req.method === 'PROPFIND') {
            if (state.beforeList) await state.beforeList();
            res.writeHead(state.status, { 'Content-Type': 'application/xml' }); res.end(state.body);
        } else { res.writeHead(state.getStatus); res.end(packed); }
    });
    await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
    t.after(async () => { srv.closeAllConnections(); await new Promise(resolve => srv.close(resolve)); });
    return { state, url: 'http://127.0.0.1:' + srv.address().port + '/dav/' };
}
async function connected(h, dav) {
    h.app.secretStorage.setSecret('moonreader-test', 'synthetic-test-password');
    await h.plugin.updateSettings({ webDavUrl: dav.url, username: 'reader', secretId: 'moonreader-test' });
    return new h.WebDAVClient(dav.url, 'reader', 'synthetic-test-password');
}
function submitConnection(tab) { const button = tab.containerEl.querySelector('[data-action="save-connection"]'); assert.ok(button); return button; }
function passwordInput(tab) { return tab.containerEl.querySelector('.moonreader-new-password input[type=password]'); }
function settings(h) {
    const tab = new h.MoonReaderWebDAVSettingTab(h.app, h.plugin);
    h.document.body.append(tab.containerEl); tab.display(); return tab;
}
test('loopback WebDAV: HTTP authentication, XML, encoded href, inflate and disk cache work together', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    await h.plugin.refresh();
    assert.equal(h.plugin.cache.books.length, 1);
    assert.equal(h.plugin.cache.books[0].notes[0].highlightText, 'Highlight');
    assert.deepEqual(dav.state.requests.map(r => r.method), ['PROPFIND', 'GET']);
    assert.equal(dav.state.requests[0].depth, '1');
    assert.equal(dav.state.requests[1].url, '/dav/book%23one.an');
    assert.equal(dav.state.authValid, true);
    const cacheFiles = (await fs.readdir(join(h.vault, h.dir))).filter(f => f.startsWith('moonreader_cache.'));
    assert.equal(cacheFiles.length, 1);
    const persisted = JSON.parse(await fs.readFile(join(h.vault, h.dir, cacheFiles[0]), 'utf8'));
    assert.deepEqual(persisted, h.plugin.cache);
    await h.plugin.refresh();
    assert.equal(dav.state.requests.filter(r => r.method === 'GET').length, 1);
    assert.match(h.plugin.status, /^Refresh complete: 0 updated, 1 unchanged, 0 failed/);
    assert.deepEqual(JSON.parse(await fs.readFile(join(h.vault, h.dir, cacheFiles[0]), 'utf8')), h.plugin.cache);
});

test('a successful connection test does not hide a local cache replacement failure', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); await h.plugin.refresh();
    const before = h.plugin.cache;
    assert.equal((await h.WebDAVClient.testConnection(dav.url, 'reader', 'synthetic-test-password')).length, 1);
    const adapter = h.app.vault.adapter, rename = adapter.rename;
    adapter.rename = async (from, to) => {
        if (from.endsWith('.tmp')) throw new Error('Controlled promotion failure');
        return rename.call(adapter, from, to);
    };
    await h.plugin.refresh();
    assert.equal(h.plugin.cache, before);
    assert.match(h.plugin.status, /Remote check completed, but saving the local cache failed/);
    adapter.rename = rename;
    await h.plugin.loadCache();
    assert.deepEqual(h.plugin.cache, before);
    await h.plugin.refresh();
    assert.match(h.plugin.status, /^Refresh complete/);
});
test('WebDAV parses namespaces and split propstats, but rejects malformed and inaccessible listings', async t => {
    const h = await harness(t), dav = await server(t), client = await connected(h, dav);
    dav.state.body = xml(entry('/dav/中文%20书.an').replace('</d:response>', '<d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>'));
    assert.ok((await client.getFiles())[0].href.endsWith('/dav/%E4%B8%AD%E6%96%87%20%E4%B9%A6.an'));
    for (const body of ['<broken', '<html/>', xml(entry().replace('200 OK', '403 Forbidden'))]) {
        dav.state.body = body; await assert.rejects(client.getFiles());
    }
    dav.state.status = 403;
    await assert.rejects(client.getFiles(), error => error.status === 403);
});
test('successful-looking non-DAV XML must not erase the existing cache', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); await h.plugin.refresh();
    const before = JSON.stringify(h.plugin.cache);
    dav.state.body = '<multistatus xmlns="https://not-webdav.test"/>';
    await h.plugin.refresh();
    assert.equal(JSON.stringify(h.plugin.cache), before);
});
test('duplicate WebDAV responses must not duplicate books', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); dav.state.body = xml(entry() + entry());
    await h.plugin.refresh();
    assert.equal(h.plugin.cache.books.length, 1);
    assert.equal(dav.state.requests.filter(r => r.method === 'GET').length, 1);
});
test('unreliable last-modified metadata must force a fresh download', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    dav.state.body = xml(entry()).replace('Thu, 01 Jan 2026 00:00:00 GMT', 'unknown');
    await h.plugin.refresh(); await h.plugin.refresh();
    assert.equal(dav.state.requests.filter(r => r.method === 'GET').length, 2);
});
test('default XML namespace works and conflicting duplicate metadata preserves the cache', async t => {
    const h = await harness(t), dav = await server(t);
    const client = await connected(h, dav);
    dav.state.body = xml(entry()).replaceAll('d:', '').replace('xmlns:d', 'xmlns');
    assert.equal((await client.getFiles()).length, 1);
    await h.plugin.refresh();
    const before = JSON.stringify(h.plugin.cache);
    dav.state.body = xml(entry() + entry().replace('<d:getcontentlength>' + packed.length, '<d:getcontentlength>999'));
    await h.plugin.refresh();
    assert.equal(JSON.stringify(h.plugin.cache), before);
});
test('missing or overflowing file size cannot suppress future downloads', async t => {
    const h = await harness(t), dav = await server(t);
    const client = await connected(h, dav);
    for (const value of ['', '9007199254740993', '-1', 'invalid']) {
        dav.state.body = xml(entry()).replace('<d:getcontentlength>' + packed.length, '<d:getcontentlength>' + value);
        assert.equal((await client.getFiles())[0].contentLength, -1);
    }
});
test('unloading during listing stops subsequent downloads and cache writes', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const gate = deferred(); dav.state.beforeList = () => gate.promise;
    const refresh = h.plugin.refresh();
    await until(() => dav.state.requests.length === 1);
    h.plugin.onunload(); gate.resolve(); await refresh;
    assert.equal(dav.state.requests.filter(r => r.method === 'GET').length, 0);
    assert.equal((await fs.readdir(join(h.vault, h.dir))).some(f => f.startsWith('moonreader_cache.')), false);
});
test('configuration typing does not save; first save validates HTTP and stores only a keychain reference', async t => {
    const h = await harness(t), dav = await server(t), tab = settings(h);
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url);
    change(h, input(tab.containerEl, 'Username'), 'reader');
    button(tab.containerEl, 'New Keychain').click();
    change(h, passwordInput(tab), 'synthetic-test-password');
    assert.equal(h.state.saves, 0); assert.equal(dav.state.requests.length, 0);
    submitConnection(tab).click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(h.state.saves, 1);
    const saved = JSON.parse(await fs.readFile(join(h.vault, h.dir, 'data.json'), 'utf8'));
    assert.equal(h.app.secretStorage.getSecret(saved.secretId), 'synthetic-test-password');
    assert.ok(!JSON.stringify(saved).includes('synthetic-test-password'));
    assert.ok(!('encryptedPass' in saved)); assert.ok(!('keyFilePath' in saved));
    assert.equal(passwordInput(tab).value, '');
    assert.match(saved.secretId, /^moonreader-127-0-0-1-[a-f0-9]{8}$/);
    assert.equal(tab.containerEl.querySelector('.moonreader-credential-name').textContent, saved.secretId);
    assert.equal(tab.containerEl.querySelector('.moonreader-keychain select').value, h.plugin.settings.secretId);
    assert.match(tab.containerEl.textContent, /Connection saved/);
    tab.hide();
});
test('failed connection keeps old settings; hiding the form cancels an in-flight save', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const tab = settings(h), before = JSON.stringify(h.plugin.settings);
    dav.state.status = 403;
    submitConnection(tab).click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(JSON.stringify(h.plugin.settings), before);
    assert.match(tab.containerEl.textContent, /Authentication or access denied/);
    dav.state.status = 207;
    const gate = deferred(); dav.state.beforeList = () => gate.promise;
    const saves = h.state.saves;
    submitConnection(tab).click();
    await until(() => dav.state.requests.length === 2);
    tab.hide(); gate.resolve();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(h.state.saves, saves);
});
test('settings disk failure leaves effective settings unchanged and allows retry', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    h.plugin.settings.insertAction = 'overwrite';
    const tab = settings(h), before = JSON.stringify(h.plugin.settings);
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url + 'new/');
    h.state.beforeSave = async () => { throw new Error('Controlled settings failure'); };
    const preference = tab.containerEl.querySelector('select[aria-label^="Default import mode"]');
    assert.equal(preference.value, 'ask');
    change(h, preference, 'append', 'change');
    await until(() => preference.value === 'ask');
    assert.equal(JSON.stringify(h.plugin.settings), before);
    submitConnection(tab).click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(JSON.stringify(h.plugin.settings), before);
    assert.equal(submitConnection(tab).disabled, false);
    h.state.beforeSave = null;
    submitConnection(tab).click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.webDavUrl, dav.url + 'new/');
    tab.hide();
});
test('library defaults to cursor insertion; closing does not write; overwrite requires confirmation', async t => {
    const h = await harness(t), before = h.files.get(h.target);
    let modal = openImport(h);
    assert.equal(button(modal.modalEl, 'Insert 1 notes').disabled, false);
    modal.close();
    assert.equal(h.state.writes, 0);
    modal = openImport(h); chooseMode(h, modal, 'overwrite');
    assert.equal(button(modal.modalEl, 'Replace 1 notes').disabled, true);
    button(modal.modalEl, 'Replace 1 notes').click();
    assert.equal(h.state.writes, 0);
    button(modal.modalEl, 'Confirm replacement').click();
    await until(() => h.state.writes === 1);
    assert.ok(h.files.get(h.target).startsWith('---\ntitle: test\n---\n'));
    assert.ok(!h.files.get(h.target).includes('Original body.'));
    assert.notEqual(h.files.get(h.target), before);
});
test('import double click commits once; failed write retains target and mode; success closes with a notice', async t => {
    const h = await harness(t), modal = openImport(h), before = h.files.get(h.target);
    chooseMode(h, modal, 'append'); h.state.failWrite = true;
    button(modal.modalEl, 'Append 1 notes').click();
    await until(() => [...modal.modalEl.querySelectorAll('button')].some(el => el.textContent === 'Append 1 notes' && !el.disabled));
    assert.equal(h.files.get(h.target), before); assert.equal(h.state.writes, 0);
    assert.match(modal.contentEl.textContent, /Append to end/);
    h.state.failWrite = false;
    const gate = deferred(); h.state.beforeWrite = () => gate.promise;
    const submit = button(modal.modalEl, 'Append 1 notes');
    submit.click(); submit.click();
    assert.equal(submit.disabled, true);
    gate.resolve(); await until(() => h.state.writes === 1);
    assert.equal(h.files.get(h.target).split('Highlight').length - 1, 1);
    assert.equal(modal.modalEl.isConnected, false);
    assert.match(h.document.querySelector('.notice').textContent, /1 notes written to Target.md/);
});
test('no active note requires a target; stale cursor is refused with an append recovery action', async t => {
    const h = await harness(t);
    const empty = openImport(h, null);
    assert.equal(h.state.writes, 0);
    button(empty.modalEl, 'Choose note').click();
    const picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    picker.querySelector('input').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(h.state.writes, 0);
    button(empty.modalEl, 'Append 1 notes').click(); await until(() => h.state.writes === 1);
    const stale = openImport(h);
    h.files.set(h.target, h.files.get(h.target) + 'Concurrent edit.');
    button(stale.modalEl, 'Insert 1 notes').click();
    button(stale.modalEl, 'Import again').click();
    assert.equal(h.state.writes, 1);
    assert.match(stale.contentEl.textContent, /original note changed/i);
    button(stale.modalEl, 'Use append instead').click();
    button(stale.modalEl, 'Append 1 notes').click(); button(stale.modalEl, 'Import again').click(); await until(() => h.state.writes === 2);
    assert.match(h.files.get(h.target), /Concurrent edit/);
});
test('changing overwrite target resets confirmation and canceling picker preserves context', async t => {
    const h = await harness(t), modal = openImport(h);
    chooseMode(h, modal, 'overwrite');
    button(modal.modalEl, 'More').click(); button(h.document.querySelector('[role=menu]'), 'Change target note').click();
    let picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    picker.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(button(modal.modalEl, 'Confirm replacement').disabled, false);
    button(modal.modalEl, 'More').click(); button(h.document.querySelector('[role=menu]'), 'Change target note').click();
    picker = [...h.document.querySelectorAll('[role=dialog]')].at(-1);
    const search = picker.querySelector('input'); change(h, search, 'Other');
    search.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.match(modal.contentEl.textContent, /Other.md/);
    assert.equal(modal.contentEl.querySelector('.moonreader-confirmation').hidden, true);
    assert.equal(button(modal.modalEl, 'Append 1 notes').disabled, false);
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

test('testing draft connection authenticates without saving settings, writing keychain or downloading books', async t => {
    const h = await harness(t), dav = await server(t), tab = settings(h);
    const before = JSON.stringify(h.plugin.settings);
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url);
    change(h, input(tab.containerEl, 'Username'), 'reader');
    button(tab.containerEl, 'New Keychain').click();
    change(h, passwordInput(tab), 'synthetic-test-password');
    button(tab.containerEl, 'Test connection').click();
    button(tab.containerEl, 'Test connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(JSON.stringify(h.plugin.settings), before);
    assert.equal(h.state.saves, 0);
    assert.equal(h.secretState.writes, 0);
    assert.deepEqual(dav.state.requests.map(request => request.method), ['PROPFIND']);
    assert.equal(dav.state.authValid, true);
    assert.match(tab.containerEl.textContent, /Connection successful; found 1/);
    assert.notEqual(passwordInput(tab).value, '');
    tab.hide();
});

test('testing saved credentials uses keychain and surfaces access failures without changing settings', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const tab = settings(h), before = JSON.stringify(h.plugin.settings), saves = h.state.saves;
    const keyBefore = new Map(h.secrets);
    dav.state.status = 403;
    button(tab.containerEl, 'Test connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.match(tab.containerEl.textContent, /Authentication or access denied/);
    assert.equal(h.state.saves, saves);
    assert.equal(JSON.stringify(h.plugin.settings), before);
    assert.deepEqual(h.secrets, keyBefore);
    assert.equal(button(tab.containerEl, 'Test connection').disabled, false);
    tab.hide();
});

test('selection and search update the preview in the same dialog and no matches disables insertion', async t => {
    const h = await harness(t), modal = openImport(h);
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
    assert.equal(button(modal.modalEl, 'Insert 0 notes').disabled, true);
    assert.equal(modal.contentEl.querySelector('.moonreader-reading > div').hidden, true);
    change(h, modal.inputEl, 'Synthetic');
    button(modal.modalEl, 'Insert 1 notes').click();
    assert.equal(h.state.writes, 1);
    assert.equal(modal.modalEl.isConnected, false);
});

test('refresh without saved credentials reports inline and only settings opens the connection form', async t => {
    const h = await harness(t), modal = openImport(h);
    const cache = h.plugin.cache;
    let requests = 0;
    h.host.requestUrl = async () => { requests++; throw new Error('Unexpected request'); };
    modal.contentEl.querySelector('button[aria-label="Refresh library"]').click();
    await until(() => modal.contentEl.querySelector('[role=status]').textContent.includes('Cannot refresh'));
    assert.equal(h.document.querySelectorAll('[role=dialog]').length, 1);
    assert.equal(h.plugin.cache, cache);
    assert.equal(requests, 0);
    assert.equal(h.state.saves, 0);
    modal.contentEl.querySelector('button[aria-label="Connection settings"]').click();
    assert.equal(h.document.querySelectorAll('[role=dialog]').length, 2);
    assert.ok(button(h.document.querySelector('.moonreader-connection'), 'Test connection'));
});

test('keyboard cannot bypass overwrite confirmation; choosing another book cancels replacement', async t => {
    const h = await harness(t), modal = openImport(h);
    chooseMode(h, modal, 'overwrite');
    modal.inputEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(h.state.writes, 0);
    h.plugin.cache.books = [book, { ...book, fileHref: 'https://fixture.test/other.an', bookName: 'Second book' }];
    h.plugin.notify();
    modal.contentEl.querySelector('[role=option][title="Second book"]').click();
    assert.equal(modal.contentEl.querySelector('.moonreader-confirmation').hidden, true);
    assert.equal(button(modal.modalEl, 'Append 1 notes').disabled, false);
});

test('close waits for the pending write and prevents repeated submission and selection changes', async t => {
    const h = await harness(t), modal = openImport(h), gate = deferred();
    chooseMode(h, modal, 'append'); h.state.beforeWrite = () => gate.promise;
    button(modal.modalEl, 'Append 1 notes').click();
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
    const h = await harness(t), modal = openImport(h), editor = modal.contentEl.querySelector('textarea');
    change(h, editor, '{highlightText}'); editor.setSelectionRange(0, editor.value.length);
    const field = modal.contentEl.querySelector('button[aria-label="Book {bookName}"]');
    field.click();
    assert.equal(editor.value, '{bookName}');
    assert.equal(h.document.activeElement, editor);
    await until(() => modal.contentEl.querySelector('.moonreader-preview').textContent.includes('Synthetic book'));
    assert.equal(h.state.saves, 0);
});

test('credential save failures never replace the old reference or password; retry commits only a reference', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const before = { ...h.plugin.settings }, oldPassword = h.app.secretStorage.getSecret(before.secretId);
    h.secretState.failWrite = true;
    await assert.rejects(h.plugin.saveConnection(dav.url, 'reader', 'new-password', () => true));
    assert.deepEqual(h.plugin.settings, before);
    assert.equal(h.app.secretStorage.getSecret(before.secretId), oldPassword);
    h.secretState.failWrite = false;
    h.state.beforeSave = async () => { throw new Error('Controlled disk failure'); };
    await assert.rejects(h.plugin.saveConnection(dav.url, 'reader', 'new-password', () => true));
    assert.deepEqual(h.plugin.settings, before);
    assert.equal(h.app.secretStorage.getSecret(before.secretId), oldPassword);
    assert.ok([...h.secrets].filter(([id]) => id !== before.secretId).every(([, value]) => value === ''));
    h.state.beforeSave = null;
    await h.plugin.saveConnection(dav.url, 'reader', 'new-password', () => true);
    assert.notEqual(h.plugin.settings.secretId, before.secretId);
    assert.equal(h.app.secretStorage.getSecret(h.plugin.settings.secretId), 'new-password');
    assert.equal(h.app.secretStorage.getSecret(before.secretId), oldPassword);
    const writes = h.secretState.writes;
    await h.plugin.saveConnection(dav.url + 'other/', 'reader', 'new-password', () => true);
    assert.equal(h.secretState.writes, writes, 'Unchanged credentials must reuse the existing entry');
});

test('settings display legacy credential names without migration, drafts or password disclosure', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const legacyId = 'moonreader-12345678-1234-1234-1234-123456789abc';
    h.secrets.set(legacyId, 'synthetic-test-password');
    h.plugin.settings.secretId = legacyId;
    const tab = settings(h), details = () => tab.containerEl.querySelector('.moonreader-keychain').textContent;
    assert.ok(details().includes(legacyId));
    assert.equal(tab.containerEl.querySelector('.moonreader-keychain select').value, h.plugin.settings.secretId);
    assert.ok(!tab.containerEl.textContent.includes('synthetic-test-password'));
    button(tab.containerEl, 'New Keychain').click();
    change(h, passwordInput(tab), 'unsaved-password');
    assert.ok(details().includes(legacyId));
    assert.equal(tab.containerEl.querySelector('.moonreader-credential').hidden, false);
    button(tab.containerEl, 'Cancel creation').click();
    assert.ok(details().includes(legacyId));
    assert.equal(tab.containerEl.querySelector('.moonreader-keychain select').value, h.plugin.settings.secretId);
    const writes = h.secretState.writes;
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.secretId, legacyId);
    assert.equal(h.secretState.writes, writes);
    h.secrets.delete(legacyId);
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.match(details(), /Password unavailable/);
    h.secretState.unavailable = true;
    tab.hide(); tab.display();
    assert.match(details(), /Password unavailable/);
    h.plugin.settings.secretId = '';
    tab.hide(); tab.display();
    assert.equal(tab.containerEl.querySelector('.moonreader-keychain select').selectedIndex, -1);
    assert.equal(tab.containerEl.querySelector('.moonreader-credential-name').hidden, true);
    tab.hide();
});

test('new credential names use a bounded server label, omit account and path, and keep old entries', async t => {
    const h = await harness(t);
    await h.plugin.saveConnection('https://NAS.Example.test/private-folder/', 'private-account', 'synthetic-password', () => true);
    const first = h.plugin.settings.secretId;
    assert.match(first, /^moonreader-nas-example-test-[a-f0-9]{8}$/);
    await h.plugin.saveConnection('https://NAS.Example.test/private-folder/', 'private-account', 'replacement-password', () => true);
    assert.notEqual(h.plugin.settings.secretId, first);
    assert.equal(h.secrets.get(first), 'synthetic-password');
    await h.plugin.saveConnection(`https://${'a'.repeat(60)}.test/`, 'private-account', 'synthetic-password', () => true);
    assert.match(h.plugin.settings.secretId, /^moonreader-a{40}-[a-f0-9]{8}$/);
    await h.plugin.saveConnection('http://[::1]/dav/', 'private-account', 'synthetic-password', () => true);
    assert.match(h.plugin.settings.secretId, /^moonreader-1-[a-f0-9]{8}$/);
});

test('choosing and testing an existing credential writes nothing; saving uses its exact reference', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const oldId = h.plugin.settings.secretId, chosen = 'shared-webdav';
    h.secrets.set(chosen, 'synthetic-test-password');
    const tab = settings(h), picker = tab.containerEl.querySelector('.moonreader-keychain select');
    const writes = h.secretState.writes, saves = h.state.saves;
    change(h, picker, chosen, 'change');
    assert.equal(h.plugin.settings.secretId, oldId);
    assert.ok(tab.containerEl.querySelector('.moonreader-credential').textContent.includes(oldId));
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.state.saves, saves); assert.equal(h.secretState.writes, writes);
    assert.equal(h.plugin.settings.secretId, oldId);
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.secretId, chosen);
    assert.equal(h.secretState.writes, writes);
    assert.ok(tab.containerEl.querySelector('.moonreader-credential').textContent.includes(chosen));
    assert.equal(h.secrets.get(oldId), 'synthetic-test-password');
    const persisted = JSON.parse(await fs.readFile(join(h.vault, h.dir, 'data.json'), 'utf8'));
    assert.equal(persisted.secretId, chosen);
    tab.hide();
});

test('credential modes are exclusive; blank new password cannot fall back, and cancel restores the draft selection', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    h.secrets.set('shared-webdav', 'synthetic-test-password');
    const tab = settings(h), picker = tab.containerEl.querySelector('.moonreader-keychain select');
    const existing = tab.containerEl.querySelector('.moonreader-existing-credential');
    const newPassword = tab.containerEl.querySelector('.moonreader-new-password');
    assert.equal(submitConnection(tab).textContent, 'Verify and save connection');
    assert.equal(existing.hidden, false); assert.equal(newPassword.hidden, true);
    assert.equal(passwordInput(tab).disabled, true);
    change(h, picker, 'shared-webdav', 'change');
    button(tab.containerEl, 'New Keychain').click();
    assert.equal(submitConnection(tab).textContent, 'Create Keychain and save connection');
    assert.equal(existing.hidden, true); assert.equal(newPassword.hidden, false);
    assert.equal(picker.disabled, true); assert.equal(passwordInput(tab).disabled, false);
    assert.equal(h.document.activeElement, tab.containerEl.querySelector('input[aria-label="Keychain name"]'));
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.match(tab.containerEl.textContent, /Enter your new password/);
    assert.equal(dav.state.requests.length, 0);
    change(h, passwordInput(tab), 'discarded-password');
    button(tab.containerEl, 'Cancel creation').click();
    assert.equal(passwordInput(tab).value, ''); assert.equal(passwordInput(tab).disabled, true);
    assert.equal(existing.hidden, false); assert.equal(newPassword.hidden, true);
    assert.equal(picker.value, 'shared-webdav'); assert.equal(picker.disabled, false);
    assert.equal(submitConnection(tab).textContent, 'Verify and save connection');
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.secretId, 'shared-webdav');
    tab.hide();
});

test('credential feedback distinguishes the saved entry from drafts and clears reverted changes', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    h.secrets.set('shared-webdav', 'synthetic-test-password');
    const tab = settings(h), oldId = h.plugin.settings.secretId;
    const status = () => tab.containerEl.querySelector('.moonreader-status');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.ok(!status().textContent.toLowerCase().includes('not saved'));
    button(tab.containerEl, 'New Keychain').click();
    assert.equal(status().dataset.state, 'dirty');
    button(tab.containerEl, 'Cancel creation').click();
    assert.equal(status().dataset.state, 'saved');
    assert.equal(tab.containerEl.querySelector('.moonreader-credential').hidden, true);
    change(h, input(tab.containerEl, 'Username'), 'changed-reader');
    assert.equal(status().dataset.state, 'dirty');
    change(h, input(tab.containerEl, 'Username'), 'reader');
    assert.equal(status().dataset.state, 'saved');
    change(h, tab.containerEl.querySelector('.moonreader-keychain select'), 'shared-webdav', 'change');
    assert.equal(tab.containerEl.querySelector('.moonreader-credential-name').textContent, oldId);
    assert.equal(tab.containerEl.querySelector('.moonreader-credential').hidden, false);
    assert.equal(tab.containerEl.querySelector('.moonreader-keychain select').value, 'shared-webdav');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.match(status().textContent, /Changes not saved/);
    assert.equal(h.plugin.settings.secretId, oldId);
    tab.hide();
});

test('failed new password save keeps the draft; retry commits and returns to existing credential mode', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const oldId = h.plugin.settings.secretId, tab = settings(h);
    button(tab.containerEl, 'New Keychain').click();
    change(h, passwordInput(tab), 'replacement-password');
    dav.state.status = 403;
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.secretId, oldId);
    assert.equal(passwordInput(tab).value, 'replacement-password');
    assert.equal(tab.containerEl.querySelector('.moonreader-new-password').hidden, false);
    dav.state.status = 207;
    const gate = deferred(); dav.state.beforeList = () => gate.promise;
    submitConnection(tab).click(); await until(() => dav.state.requests.length === 2);
    assert.equal(passwordInput(tab).disabled, true);
    assert.equal(button(tab.containerEl, 'Cancel creation').disabled, true);
    gate.resolve(); await until(() => !h.plugin.connectionSaving);
    assert.notEqual(h.plugin.settings.secretId, oldId);
    assert.equal(h.secrets.get(oldId), 'synthetic-test-password');
    assert.equal(passwordInput(tab).value, ''); assert.equal(passwordInput(tab).disabled, true);
    assert.equal(tab.containerEl.querySelector('.moonreader-new-password').hidden, true);
    assert.equal(tab.containerEl.querySelector('.moonreader-existing-credential').hidden, false);
    assert.equal(tab.containerEl.querySelector('.moonreader-keychain select').value, h.plugin.settings.secretId);
    tab.hide();
});

test('selected credential failures preserve the old reference and never modify shared secrets', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const before = { ...h.plugin.settings }, chosen = 'shared-webdav';
    h.secrets.set(chosen, 'synthetic-test-password');
    const tab = settings(h), picker = tab.containerEl.querySelector('.moonreader-keychain select');
    change(h, picker, chosen, 'change');
    const writes = h.secretState.writes;
    dav.state.status = 403;
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.deepEqual(h.plugin.settings, before);
    dav.state.status = 207;
    h.state.beforeSave = async () => { throw new Error('Controlled settings failure'); };
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.deepEqual(h.plugin.settings, before);
    h.state.beforeSave = null;
    dav.state.beforeList = async () => { h.secrets.set(chosen, 'changed-during-test'); };
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.deepEqual(h.plugin.settings, before);
    assert.match(tab.containerEl.textContent, /selected credential changed/);
    dav.state.beforeList = null;
    h.secrets.delete(chosen);
    const requests = dav.state.requests.length;
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(dav.state.requests.length, requests);
    assert.deepEqual(h.plugin.settings, before);
    assert.equal(h.secretState.writes, writes);
    tab.hide();
});

test('closing the form cancels selection; pending validation disables the picker and cancels saving', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const oldId = h.plugin.settings.secretId, chosen = 'shared-webdav';
    h.secrets.set(chosen, 'synthetic-test-password');
    const tab = settings(h);
    change(h, tab.containerEl.querySelector('.moonreader-keychain select'), chosen, 'change');
    tab.hide(); tab.display();
    const picker = tab.containerEl.querySelector('.moonreader-keychain select');
    assert.equal(picker.value, oldId);
    change(h, picker, chosen, 'change');
    const gate = deferred(); dav.state.beforeList = () => gate.promise;
    submitConnection(tab).click(); await until(() => dav.state.requests.length === 1);
    assert.equal(picker.disabled, true);
    tab.hide(); gate.resolve(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.secretId, oldId);
    assert.equal(h.state.saves, 1);
});

test('missing or unavailable keychain preserves cache and cancellation performs no credential write', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); h.plugin.cache.books = [book];
    const cache = h.plugin.cache, writes = h.secretState.writes;
    await h.plugin.saveConnection(dav.url, 'reader', 'unused', () => false);
    assert.equal(h.secretState.writes, writes);
    h.secrets.delete(h.plugin.settings.secretId);
    assert.equal(h.plugin.configured(), false);
    assert.match(h.plugin.connectionStatus(), /password unavailable/);
    await h.plugin.refresh();
    assert.equal(h.plugin.cache, cache); assert.equal(dav.state.requests.length, 0);
    h.secretState.unavailable = true;
    await h.plugin.refresh();
    assert.equal(h.plugin.cache, cache); assert.equal(dav.state.requests.length, 0);
});

test('changing accounts or servers requires a newly entered password before any request', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); const tab = settings(h), before = { ...h.plugin.settings };
    change(h, input(tab.containerEl, 'Username'), 'another-reader');
    button(tab.containerEl, 'Test connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(dav.state.requests.length, 0); assert.deepEqual(h.plugin.settings, before);
    change(h, input(tab.containerEl, 'Username'), 'reader');
    change(h, input(tab.containerEl, 'WebDAV folder URL'), 'http://127.0.0.1:1/dav/');
    submitConnection(tab).click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(dav.state.requests.length, 0); assert.deepEqual(h.plugin.settings, before);
});

test('connection-only form omits preferences and marks a successful test as not saved', async t => {
    const h = await harness(t), dav = await server(t);
    const tab = new h.MoonReaderWebDAVSettingTab(h.app, h.plugin, () => {}, true);
    tab.display();
    assert.ok(!tab.containerEl.querySelector('textarea')); assert.ok(!tab.containerEl.querySelector('select[aria-label^="Default import mode"]'));
    assert.equal(tab.containerEl.querySelectorAll('input').length, 4);
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url);
    change(h, input(tab.containerEl, 'Username'), 'reader');
    button(tab.containerEl, 'New Keychain').click();
    change(h, passwordInput(tab), 'synthetic-test-password');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(tab.containerEl.querySelector('.moonreader-status').dataset.state, 'tested');
    assert.match(tab.containerEl.textContent, /not saved/i);
    assert.equal(h.secretState.writes, 0); assert.equal(h.state.saves, 0);
    tab.hide();
});

test('library falls back to an open Markdown note but does not use a closed recent view', async t => {
    const h = await harness(t);
    h.plugin.cache.books = [book]; h.app.workspace.getActiveViewOfType = () => null;
    h.app.workspace.getMostRecentLeaf = () => ({ view: {} });
    h.plugin.openLibrary(false);
    assert.ok(button(h.document.querySelector('.moonreader-library'), 'Insert 1 notes'));
    h.plugin.browser.close();
    h.plugin.recentMarkdownView = h.view;
    h.app.workspace.getLeavesOfType = () => [];
    h.plugin.openLibrary(false);
    assert.ok(button(h.document.querySelector('.moonreader-library'), 'Choose note'));
    assert.equal(h.state.writes, 0);
});

test('repeated imports require explicit confirmation and keyboard/cancel cannot duplicate content', async t => {
    const h = await harness(t);
    let modal = openImport(h); chooseMode(h, modal, 'append');
    button(modal.modalEl, 'Append 1 notes').click(); await until(() => h.state.writes === 1);
    modal = openImport(h); chooseMode(h, modal, 'append');
    assert.match(modal.contentEl.querySelector('.moonreader-warning').textContent, /already imported/);
    button(modal.modalEl, 'Append 1 notes').click();
    modal.inputEl.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    assert.equal(h.state.writes, 1);
    button(modal.modalEl, 'Cancel').click(); assert.equal(h.state.writes, 1);
    button(modal.modalEl, 'Append 1 notes').click(); button(modal.modalEl, 'Import again').click();
    await until(() => h.state.writes === 2);
    assert.equal(h.files.get(h.target).split('Highlight').length - 1, 2);
});

test('returning to an already open empty library fetches once without creating another panel', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    h.plugin.openLibrary(false);
    let refreshes = 0; h.plugin.refresh = async () => { refreshes++; };
    h.plugin.openLibrary();
    assert.equal(refreshes, 1);
    assert.equal(h.document.querySelectorAll('.moonreader-library').length, 1);
    h.plugin.cache.books = [book]; h.plugin.openLibrary();
    assert.equal(refreshes, 1);
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
    assert.match(modal.contentEl.textContent, /Books 1\/4/);
    change(h, modal.inputEl, 'Alpha');
    assert.deepEqual(titles(), ['Alpha']);
    change(h, modal.inputEl, 'absent');
    assert.deepEqual(titles(), []); assert.equal(button(modal.modalEl, 'Insert 0 notes').disabled, true);
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

test('display limits do not reduce WebDAV downloads or cached books', async t => {
    const h = await harness(t), dav = await server(t);
    dav.state.body = xml(entry('one.an') + entry('two.an') + entry('three.an'));
    await connected(h, dav);
    await h.plugin.updateSettings({ bookListLimit: 1 });
    await h.plugin.refresh();
    assert.equal(dav.state.requests.filter(request => request.method === 'GET').length, 3);
    assert.equal(h.plugin.cache.books.length, 3);
    const modal = new h.BookSuggestModal(h.app, h.plugin, h.view, () => {}); modal.open();
    assert.equal(modal.contentEl.querySelectorAll('[role=option]').length, 1);
    assert.match(modal.contentEl.textContent, /Books 1\/3/);
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
    chooseSort(h, modal, 'Title'); await until(() => h.plugin.settings.bookListSort === 'title');
    assert.deepEqual(titles(), ['Book A', 'Book M', 'Book X', 'Book Z']);
    assert.equal(modal.inputEl.value, 'Book'); assert.equal(modal.contentEl.querySelector('[aria-selected=true]').title, 'Book Z');
    chooseSort(h, modal, 'Descending'); await until(() => h.plugin.settings.bookListDirection === 'desc');
    assert.deepEqual(titles(), ['Book Z', 'Book X', 'Book M', 'Book A']);
    chooseSort(h, modal, 'Modification time'); await until(() => h.plugin.settings.bookListSort === 'backup-date');
    assert.deepEqual(titles(), ['Book Z', 'Book A', 'Book M', 'Book X']);
    chooseSort(h, modal, 'Ascending'); await until(() => h.plugin.settings.bookListDirection === 'asc');
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

test('library hides healthy connection status and shortens the target without hiding replacement details', async t => {
    const h = await harness(t);
    h.target.path = 'Folder/Target.md';
    const modal = openImport(h);
    const destination = modal.contentEl.querySelector('.moonreader-destination > div');
    assert.equal(destination.textContent, 'Target.md'); assert.equal(destination.title, h.target.path);
    assert.ok(destination.getAttribute('aria-label').includes(h.target.path));
    assert.equal(modal.contentEl.querySelector('.moonreader-connection-status').hidden, false);
    h.secrets.set('synthetic', 'synthetic-password');
    await h.plugin.updateSettings({ username: 'reader', secretId: 'synthetic' }); h.plugin.notify();
    assert.equal(modal.contentEl.querySelector('.moonreader-connection-status').hidden, true);
    chooseMode(h, modal, 'overwrite');
    assert.ok(modal.contentEl.querySelector('.moonreader-confirmation').textContent.includes(h.target.path));
    assert.equal(h.state.writes, 0); modal.close();
});

test('list preferences persist, reject invalid limits and recover from a failed save', async t => {
    const h = await harness(t), tab = settings(h);
    const limit = input(tab.containerEl, 'Books shown');
    assert.equal(limit.value, '0');
    change(h, limit, '2'); await until(() => h.plugin.settings.bookListLimit === 2);
    const modal = openImport(h);
    const order = modal.contentEl.querySelector('button[aria-label="Book order"]');
    assert.ok(modal.contentEl.querySelector('.moonreader-sidebar').contains(order));
    assert.ok(order.compareDocumentPosition(modal.contentEl.querySelector('[role=listbox]')) & h.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(!tab.containerEl.querySelector('select[aria-label="Book order"]'));
    chooseSort(h, modal, 'Title'); await until(() => !order.disabled);
    const saved = JSON.parse(await fs.readFile(join(h.vault, h.dir, 'data.json'), 'utf8'));
    assert.equal(saved.bookListLimit, 2); assert.equal(saved.bookListSort, 'title');
    const saves = h.state.saves;
    for (const invalid of ['-1', '1.5', '', '9007199254740992']) change(h, limit, invalid);
    assert.equal(h.state.saves, saves); assert.equal(h.plugin.settings.bookListLimit, 2);
    h.state.beforeSave = async () => { throw new Error('Controlled preference save failure'); };
    chooseSort(h, modal, 'Modification time'); await until(() => !order.disabled);
    assert.equal(order.textContent, 'Title ↑'); assert.equal(h.plugin.settings.bookListSort, 'title');
    change(h, limit, '3'); await until(() => limit.value === '2');
    assert.equal(h.plugin.settings.bookListLimit, 2);
    h.state.beforeSave = null;
    change(h, limit, '0'); await until(() => h.plugin.settings.bookListLimit === 0);
    tab.hide();
    modal.close();
});

test('list defaults survive old configurations and invalid persisted preferences', async t => {
    const h = await harness(t);
    for (const data of [{}, { bookListLimit: -1, bookListSort: 'unknown' }, { bookListLimit: 1.5 }, { bookListLimit: '20' }]) {
        h.plugin.loadData = async () => data; await h.plugin.onload();
        assert.equal(h.plugin.settings.bookListLimit, 0); assert.equal(h.plugin.settings.bookListSort, 'backup-date');
    }
    h.plugin.loadData = async () => ({ bookListLimit: 20, bookListSort: 'title' }); await h.plugin.onload();
    assert.equal(h.plugin.settings.bookListLimit, 20); assert.equal(h.plugin.settings.bookListSort, 'title');
});

test('malformed persisted configuration cannot become runtime settings', async t => {
    const h = await harness(t);
    for (const data of [null, [], 'invalid', { webDavUrl: 42, username: {}, secretId: false, insertAction: 'invalid', noteTemplate: [] }]) {
        h.plugin.loadData = async () => data;
        await h.plugin.onload();
        assert.equal(typeof h.plugin.settings.webDavUrl, 'string');
        assert.equal(h.plugin.settings.username, '');
        assert.equal(h.plugin.settings.secretId, '');
        assert.equal(h.plugin.settings.insertAction, 'ask');
        assert.equal(typeof h.plugin.settings.noteTemplate, 'string');
        assert.ok(h.plugin.settings.noteTemplate.trim());
    }
});

test('declarative settings index every editable field without creating UI or saving drafts', async t => {
    const h = await harness(t);
    const tab = new h.MoonReaderWebDAVSettingTab(h.app, h.plugin);
    const definitions = tab.getSettingDefinitions();
    const names = definitions.flatMap(group => group.items || [group]).map(item => item.name);
    assert.ok(names.includes('WebDAV folder URL'));
    assert.ok(names.includes('Username'));
    assert.ok(names.includes('Connection credential'));
    assert.ok(!names.includes('Password or app password'));
    assert.ok(names.includes('Books shown'));
    assert.ok(names.includes('Default import mode'));
    assert.ok(names.includes('Default note template'));
    assert.equal(tab.containerEl.childElementCount, 0);
    assert.equal(h.state.saves, 0); assert.equal(h.secretState.writes, 0);
    h.document.body.append(tab.containerEl); tab.display();
    change(h, input(tab.containerEl, 'Username'), 'unsaved-draft');
    tab.getSettingDefinitions();
    assert.equal(input(tab.containerEl, 'Username').value, 'unsaved-draft');
    tab.hide(); tab.display();
    assert.equal(input(tab.containerEl, 'Username').value, h.plugin.settings.username);
    assert.equal(h.state.saves, 0); tab.hide();
});

test('custom credential names are drafts until saved and use the exact name without replacing the old entry', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    const tab = settings(h), oldId = h.plugin.settings.secretId;
    button(tab.containerEl, 'New Keychain').click();
    const name = tab.containerEl.querySelector('input[aria-label="Keychain name"]');
    assert.match(name.value, /^moonreader-127-0-0-1-[a-f0-9]{8}$/);
    assert.equal(name.selectionStart, 0); assert.equal(name.selectionEnd, name.value.length);
    change(h, name, 'moonreader-home-nas'); change(h, passwordInput(tab), 'synthetic-test-password');
    const writes = h.secretState.writes;
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.secretState.writes, writes); assert.equal(h.plugin.settings.secretId, oldId);
    assert.equal(name.value, 'moonreader-home-nas');
    submitConnection(tab).click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.secretId, 'moonreader-home-nas');
    assert.equal(h.secrets.get('moonreader-home-nas'), 'synthetic-test-password');
    assert.equal(h.secrets.get(oldId), 'synthetic-test-password');
    assert.equal(name.value, ''); assert.equal(name.disabled, true);
    tab.hide();
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

test('custom name save failures retain the previous connection and do not clear another writer replacement', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    const before = { ...h.plugin.settings };
    h.state.beforeSave = async () => { throw new Error('Controlled disk failure'); };
    await assert.rejects(h.plugin.saveConnection(dav.url, 'reader', 'new-password', () => true, undefined, 'moonreader-home-nas'));
    assert.deepEqual(h.plugin.settings, before);
    assert.ok(!h.secrets.get('moonreader-home-nas'));
    h.state.beforeSave = null;
    await h.plugin.saveConnection(dav.url, 'reader', 'new-password', () => true, undefined, 'moonreader-home-nas');
    assert.equal(h.plugin.settings.secretId, 'moonreader-home-nas');
    const beforeForeignWrite = { ...h.plugin.settings };
    h.state.beforeSave = async () => {
        h.secrets.set('moonreader-home-nas-2', 'other-writer-password');
        throw new Error('Controlled disk failure');
    };
    await assert.rejects(h.plugin.saveConnection(dav.url, 'reader', 'new-password', () => true, undefined, 'moonreader-home-nas-2'));
    assert.equal(h.secrets.get('moonreader-home-nas-2'), 'other-writer-password');
    assert.deepEqual(h.plugin.settings, beforeForeignWrite);
});

test('settings group the connection fields and keep preference feedback out of connection state', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const tab = settings(h);
    const headings = tab.getSettingDefinitions().filter(item => item.type === 'group').map(item => item.heading);
    assert.deepEqual(headings, ['Backup connection', 'Library display', 'Note insertion', 'Note template']);
    const card = tab.containerEl.querySelector('.moonreader-connection-card');
    assert.ok(card.contains(input(tab.containerEl, 'WebDAV folder URL')));
    assert.ok(card.contains(input(tab.containerEl, 'Username')));
    assert.ok(card.contains(tab.containerEl.querySelector('.moonreader-keychain')));
    assert.ok(card.contains(submitConnection(tab)));
    change(h, input(tab.containerEl, 'Username'), 'draft-reader');
    const status = card.querySelector('.moonreader-status'), before = status.textContent;
    const limit = input(tab.containerEl, 'Books shown');
    change(h, limit, '-1');
    assert.match(limit.closest('.setting-item').querySelector('.moonreader-preference-feedback').textContent, /non-negative integer/);
    assert.equal(status.textContent, before); assert.equal(status.dataset.state, 'dirty');
    change(h, limit, '3'); await until(() => h.plugin.settings.bookListLimit === 3);
    assert.equal(limit.closest('.setting-item').querySelector('.moonreader-preference-feedback').textContent, 'Saved.');
    assert.equal(status.textContent, before); assert.equal(h.plugin.settings.username, 'reader');
    const mode = tab.containerEl.querySelector('select[aria-label^="Default import mode"]');
    change(h, mode, 'append', 'change'); await until(() => h.plugin.settings.insertAction === 'append');
    assert.equal(mode.closest('.setting-item').querySelector('.moonreader-preference-feedback').textContent, 'Saved.');
    assert.equal(status.textContent, before);
    const editor = tab.containerEl.querySelector('.moonreader-settings-template textarea');
    change(h, editor, '');
    button(tab.containerEl, 'Save default template').click();
    assert.match(editor.closest('.moonreader-settings-template').querySelector('.moonreader-preference-feedback').textContent, /cannot be empty/);
    change(h, editor, '{note}');
    button(tab.containerEl, 'Save default template').click(); await until(() => h.plugin.settings.noteTemplate === '{note}');
    assert.equal(editor.closest('.moonreader-settings-template').querySelector('.moonreader-preference-feedback').textContent, 'Default template saved.');
    assert.equal(status.textContent, before);
    tab.hide();
});

test('existing credential list offers only references, refreshes on focus and never exposes passwords', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    const tab = settings(h), picker = tab.containerEl.querySelector('.moonreader-keychain select');
    assert.deepEqual([...picker.options].map(option => option.value), [h.plugin.settings.secretId]);
    assert.equal(picker.getAttribute('aria-label'), 'Saved Keychains');
    assert.equal(picker.options[0].textContent, h.plugin.settings.secretId);
    assert.equal(tab.containerEl.querySelector('.moonreader-credential').hidden, true);
    h.secrets.set('shared-webdav', 'private-synthetic-password');
    picker.focus();
    assert.ok([...picker.options].some(option => option.value === 'shared-webdav'));
    assert.ok(!tab.containerEl.textContent.includes('private-synthetic-password'));
    assert.ok(!tab.containerEl.textContent.includes('Password readable'));
    assert.deepEqual([...tab.containerEl.querySelector('.moonreader-existing-credential').querySelectorAll('button')].map(button => button.textContent), ['New Keychain']);
    assert.equal(h.state.saves, 1); assert.equal(h.secretState.writes, 1);
    tab.hide();
});

test('reused settings controls after hide report empty selection immediately and can test again', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    const tab = settings(h), picker = tab.containerEl.querySelector('.moonreader-keychain select');
    const before = { ...h.plugin.settings }, writes = h.secretState.writes;
    tab.hide(); // Native host may retain and reattach these controls without rerendering.
    assert.equal(tab.owner, null);
    change(h, picker, '', 'change');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    const status = tab.containerEl.querySelector('.moonreader-status');
    assert.equal(status.dataset.state, 'error'); assert.match(status.textContent, /No credential selected/);
    assert.equal(dav.state.requests.length, 0); assert.equal(picker.disabled, false);
    assert.equal(tab.saving, false); assert.deepEqual(h.plugin.settings, before); assert.equal(h.secretState.writes, writes);
    change(h, picker, before.secretId, 'change');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(status.dataset.state, 'tested'); assert.equal(dav.state.requests.length, 1);
    tab.hide();
});

test('old credential fields are excluded on load and preferences survive without secret migration', async t => {
    const h = await harness(t);
    h.plugin.loadData = async () => ({ webDavUrl: 'https://fixture.test/dav/', username: 'reader', encryptedPass: 'legacy-ciphertext', keyFilePath: 'unused.key', noteTemplate: '{note}', insertAction: 'append' });
    await h.plugin.onload();
    assert.equal(h.plugin.settings.secretId, '');
    assert.equal(h.plugin.settings.noteTemplate, '{note}');
    assert.equal(h.plugin.settings.insertAction, 'append');
    assert.ok(!('encryptedPass' in h.plugin.settings)); assert.ok(!('keyFilePath' in h.plugin.settings));
    assert.equal(h.secretState.writes, 0); assert.equal(h.state.saves, 0);
});



test('first connection explicitly selects saved Keychains and empty state offers only creation', async t => {
    const h = await harness(t);
    let tab = settings(h), picker = tab.containerEl.querySelector('.moonreader-keychain select');
    assert.equal(picker.options.length, 0); assert.equal(picker.hidden, true);
    assert.equal(tab.containerEl.querySelector('.moonreader-selection-hint').textContent, 'No saved Keychains yet');
    assert.equal(tab.containerEl.querySelector('.moonreader-selection-hint').hidden, false);
    button(tab.containerEl, 'New Keychain').click();
    assert.equal(tab.containerEl.querySelector('.moonreader-existing-credential').hidden, true);
    assert.equal(submitConnection(tab).textContent, 'Create Keychain and save connection');
    button(tab.containerEl, 'Cancel creation').click();
    assert.equal(tab.containerEl.querySelector('.moonreader-new-password').hidden, true);
    tab.hide();
    h.secrets.set('home-nas', 'synthetic-password');
    tab = settings(h); picker = tab.containerEl.querySelector('.moonreader-keychain select');
    assert.deepEqual([...picker.options].map(option => option.textContent), ['home-nas']);
    assert.equal(picker.value, ''); assert.equal(picker.selectedIndex, -1);
    assert.equal(tab.containerEl.querySelector('.moonreader-selection-hint').textContent, 'Choose a saved Keychain');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.match(tab.containerEl.querySelector('.moonreader-status').textContent, /No credential selected/);
    change(h, picker, 'home-nas', 'change');
    assert.equal(tab.containerEl.querySelector('.moonreader-selection-hint').hidden, true);
    assert.equal(h.plugin.settings.secretId, ''); assert.equal(h.state.saves, 0); assert.equal(h.secretState.writes, 0);
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


test('closing before queued connection commit cancels the save and clears only its new credential', async t => {
    for (const createNew of [false, true]) {
        const h = await harness(t), dav = await server(t); await connected(h, dav);
        const before = { ...h.plugin.settings }, cache = h.plugin.cache;
        const gate = deferred(); let entered = false;
        h.state.beforeSave = async () => { if (!entered) { entered = true; await gate.promise; } };
        const preference = h.plugin.updateSettings({ bookListLimit: 5 }); await until(() => entered);
        const tab = settings(h); change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url + 'new/');
        if (createNew) {
            button(tab.containerEl, 'New Keychain').click();
            change(h, tab.containerEl.querySelector('.moonreader-new-password input[type=text]'), 'queued-new-key');
            change(h, passwordInput(tab), 'synthetic-test-password');
        }
        submitConnection(tab).click();
        await until(() => dav.state.requests.length === 1);
        await new Promise(resolve => setTimeout(resolve, 20));
        tab.hide(); gate.resolve(); await preference; await until(() => !h.plugin.connectionSaving);
        assert.equal(h.plugin.settings.webDavUrl, before.webDavUrl);
        assert.equal(h.plugin.settings.secretId, before.secretId);
        assert.equal(h.plugin.settings.bookListLimit, 5);
        assert.equal(h.plugin.cache, cache); assert.equal(h.state.saves, 2);
        if (createNew) { await until(() => h.secrets.get('queued-new-key') === ''); assert.equal(h.secrets.get('queued-new-key'), ''); }
    }
});

test('a connection commit already writing completes its cache switch after the form closes', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    h.plugin.cache.books = [book]; const oldSource = h.plugin.cache.source;
    const gate = deferred(); let entered = false;
    h.state.beforeSave = async () => { entered = true; await gate.promise; };
    const tab = settings(h); change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url + 'new/');
    submitConnection(tab).click(); await until(() => entered);
    tab.hide(); gate.resolve(); await until(() => !h.plugin.connectionSaving);
    assert.equal(h.plugin.settings.webDavUrl, dav.url + 'new/');
    assert.notEqual(h.plugin.cache.source, oldSource); assert.equal(h.plugin.cache.books.length, 0);
});


test('changing connection identity permits explicitly choosing the sole saved Keychain', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    const tab = settings(h), picker = tab.containerEl.querySelector('.moonreader-keychain select');
    const id = h.plugin.settings.secretId, writes = h.secretState.writes;
    change(h, input(tab.containerEl, 'Username'), 'another-reader');
    assert.equal(picker.options.length, 1); assert.equal(picker.selectedIndex, -1);
    assert.equal(tab.containerEl.querySelector('.moonreader-selection-hint').hidden, false);
    change(h, picker, id, 'change');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(dav.state.requests.length, 1); assert.equal(h.secretState.writes, writes);
    assert.equal(h.plugin.settings.username, 'reader');
    change(h, input(tab.containerEl, 'WebDAV folder URL'), 'http://127.0.0.1:1/dav/');
    assert.equal(picker.selectedIndex, -1);
    change(h, input(tab.containerEl, 'Username'), 'reader');
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url);
    assert.equal(picker.value, id);
    tab.hide();
});


test('cancelling or closing a check releases its lock and its late completion cannot release a new check', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    const originalStatus = h.plugin.status;
    const first = deferred(), second = deferred(); let calls = 0;
    h.WebDAVClient.testConnection = () => ++calls === 1 ? first.promise : second.promise;
    const oldTab = settings(h);
    button(oldTab.containerEl, 'Test connection').click();
    assert.equal(h.plugin.connectionOperation, 'test');
    assert.equal(button(oldTab.containerEl, 'Cancel check').hidden, false);
    const otherTab = settings(h);
    button(otherTab.containerEl, 'Test connection').click();
    assert.match(otherTab.containerEl.querySelector('.moonreader-status').textContent, /Another window is testing/);
    await h.plugin.refresh(); assert.match(h.plugin.status, /being tested/);
    oldTab.hide(); assert.equal(h.plugin.connectionSaving, false); assert.equal(h.plugin.status, originalStatus);
    button(otherTab.containerEl, 'Test connection').click();
    assert.equal(calls, 2); assert.equal(h.plugin.connectionSaving, true);
    first.resolve([]); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.plugin.connectionSaving, true);
    assert.match(otherTab.containerEl.querySelector('.moonreader-status').textContent, /Checking connection/);
    button(otherTab.containerEl, 'Cancel check').click();
    assert.equal(h.plugin.connectionSaving, false);
    assert.match(otherTab.containerEl.querySelector('.moonreader-status').textContent, /Check cancelled/);
    assert.equal(button(otherTab.containerEl, 'Test connection').disabled, false);
    second.resolve([]); await new Promise(resolve => setTimeout(resolve, 10));
    assert.match(otherTab.containerEl.querySelector('.moonreader-status').textContent, /Check cancelled/);
    assert.equal(h.state.saves, 1); otherTab.hide();
});

test('WebDAV connection checks time out, abort without a request when already cancelled, and allow retry', async t => {
    const h = await harness(t), dav = await server(t);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(h.WebDAVClient.testConnection(dav.url, 'reader', 'synthetic-password', aborted.signal), /cancelled/);
    assert.equal(dav.state.requests.length, 0);
    const gate = deferred(); dav.state.beforeList = () => gate.promise;
    await assert.rejects(h.WebDAVClient.testConnection(dav.url, 'reader', 'synthetic-password', undefined, 40), /timed out/);
    const cancel = new AbortController();
    const pending = h.WebDAVClient.testConnection(dav.url, 'reader', 'synthetic-password', cancel.signal);
    const rejection = assert.rejects(pending, /cancelled/);
    await until(() => dav.state.requests.length === 2); cancel.abort(); await rejection;
    gate.resolve(); dav.state.beforeList = null;
    const files = await h.WebDAVClient.testConnection(dav.url, 'reader', 'synthetic-password');
    assert.equal(files.length, 1);
});


test('preference feedback belongs to the latest edit across overlapping saves and failures', async t => {
    for (const latestFails of [false, true]) {
        const h = await harness(t), tab = settings(h), gate = deferred(); let calls = 0;
        h.state.beforeSave = async () => {
            const call = ++calls; if (call === 1) await gate.promise;
            if (call === (latestFails ? 2 : 1)) throw new Error('Controlled overlapping save failure');
        };
        const limit = input(tab.containerEl, 'Books shown');
        change(h, limit, '1'); change(h, limit, '10'); gate.resolve();
        const expected = latestFails ? 1 : 10;
        await until(() => h.plugin.settings.bookListLimit === expected && calls === 2);
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(limit.value, String(expected));
        const feedback = limit.closest('.setting-item').querySelector('.moonreader-preference-feedback').textContent;
        assert.ok(latestFails ? feedback.includes('Operation failed') : feedback === 'Saved.'); tab.hide();
    }
    const h = await harness(t), tab = settings(h), gate = deferred();
    h.state.beforeSave = () => gate.promise;
    const limit = input(tab.containerEl, 'Books shown'); change(h, limit, '1'); change(h, limit, '');
    gate.resolve(); await until(() => h.plugin.settings.bookListLimit === 1);
    assert.equal(limit.value, '');
    assert.match(limit.closest('.setting-item').querySelector('.moonreader-preference-feedback').textContent, /non-negative integer/);
    tab.hide();
});

test('older default-mode failures cannot undo a later successful choice', async t => {
    const h = await harness(t), tab = settings(h), gate = deferred(); let calls = 0;
    h.state.beforeSave = async () => { if (++calls === 1) { await gate.promise; throw new Error('Controlled first failure'); } };
    const mode = tab.containerEl.querySelector('select[aria-label^="Default import mode"]');
    change(h, mode, 'append', 'change'); change(h, mode, 'ask', 'change'); change(h, mode, 'append', 'change');
    gate.resolve(); await until(() => calls === 3 && h.plugin.settings.insertAction === 'append');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(mode.value, 'append');
    assert.equal(mode.closest('.setting-item').querySelector('.moonreader-preference-feedback').textContent, 'Saved.'); tab.hide();
});

test('a failed import catches up deferred cache, selection and preference changes before retry', async t => {
    const h = await harness(t), modal = openImport(h), gate = deferred();
    chooseMode(h, modal, 'append'); h.state.beforeWrite = () => gate.promise;
    button(modal.contentEl, 'Append 1 notes').click(); await until(() => modal.panel.busy);
    h.plugin.cache.books = [{ ...book, fileHref: 'https://fixture.test/dav/replacement.an', bookName: 'Replacement book', notes: [{ ...book.notes[0], highlightText: 'New highlight' }] }];
    h.plugin.settings.bookListLimit = 1; h.plugin.notify();
    assert.equal(modal.contentEl.querySelector('.moonreader-book-title').textContent, book.bookName);
    h.state.failWrite = true; gate.resolve(); await until(() => !modal.panel.busy);
    assert.equal(modal.contentEl.querySelector('.moonreader-book-item span').textContent, 'Replacement book');
    assert.equal(modal.contentEl.querySelector('.moonreader-book-title').textContent, 'Replacement book');
    assert.match(modal.contentEl.querySelector('.moonreader-import-feedback .moonreader-status').textContent, /Operation failed/);
    await until(() => modal.contentEl.querySelector('.moonreader-preview').textContent.includes('New highlight'));
    h.state.failWrite = false; h.state.beforeWrite = null;
    button(modal.contentEl, 'Append 1 notes').click(); await until(() => h.state.writes === 1);
    assert.ok(h.files.get(h.target).includes('New highlight')); assert.ok(!h.files.get(h.target).includes('> Highlight'));
});

test('an import records the source captured before a concurrent cache switch', async t => {
    const h = await harness(t); h.plugin.cache.source = 'old-source';
    const modal = openImport(h), gate = deferred(); chooseMode(h, modal, 'append'); h.state.beforeWrite = () => gate.promise;
    button(modal.contentEl, 'Append 1 notes').click(); await until(() => modal.panel.busy);
    h.plugin.cache = { ...h.plugin.cache, source: 'new-source', books: [] }; h.plugin.notify();
    gate.resolve(); await until(() => !modal.panel.busy);
    assert.ok(h.plugin.sessionImports.has(JSON.stringify(['old-source', book.fileHref, h.target.path])));
    assert.ok(!h.plugin.sessionImports.has(JSON.stringify(['new-source', book.fileHref, h.target.path])));
});


test('reopening during a committed connection write stays disabled and then shows the committed identity', async t => {
    const h = await harness(t), dav = await server(t); await connected(h, dav);
    const tab = settings(h), definitions = tab.getSettingDefinitions(), gate = deferred(); let writing = false;
    const render = () => {
        tab.containerEl.empty();
        for (const definition of definitions) {
            const group = new h.host.SettingGroup(tab.containerEl).setHeading(definition.heading || '');
            for (const item of definition.items || []) item.render?.(new h.host.Setting(group.listEl).setName(item.name).setDesc(item.desc || ''), group);
        }
    };
    tab.hide(); render();
    h.state.beforeSave = async () => { writing = true; await gate.promise; };
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url + 'committed/');
    submitConnection(tab).click(); await until(() => writing);
    assert.equal(button(tab.containerEl, 'Cancel check').hidden, true);
    tab.hide(); render();
    assert.equal(h.plugin.connectionSaving, true);
    assert.equal(input(tab.containerEl, 'WebDAV folder URL').disabled, true);
    assert.equal(input(tab.containerEl, 'Username').disabled, true);
    assert.equal(submitConnection(tab).disabled, true);
    gate.resolve(); await until(() => !h.plugin.connectionSaving);
    assert.equal(input(tab.containerEl, 'WebDAV folder URL').value, dav.url + 'committed/');
    assert.equal(input(tab.containerEl, 'WebDAV folder URL').disabled, false);
    assert.equal(tab.containerEl.querySelector('.moonreader-keychain select').value, h.plugin.settings.secretId);
    tab.hide();
});
