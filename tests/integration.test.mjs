import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { harness, button, input, change, until, deferred, openImport, chooseMode, book } from './helpers.mjs';

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
    change(h, input(tab.containerEl, 'Password or app password'), 'synthetic-test-password');
    assert.equal(h.state.saves, 0); assert.equal(dav.state.requests.length, 0);
    button(tab.containerEl, 'Save connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(h.state.saves, 1);
    const saved = JSON.parse(await fs.readFile(join(h.vault, h.dir, 'data.json'), 'utf8'));
    assert.equal(h.app.secretStorage.getSecret(saved.secretId), 'synthetic-test-password');
    assert.ok(!JSON.stringify(saved).includes('synthetic-test-password'));
    assert.ok(!('encryptedPass' in saved)); assert.ok(!('keyFilePath' in saved));
    assert.equal(input(tab.containerEl, 'Password or app password').value, '');
    assert.match(tab.containerEl.textContent, /Connection saved/);
    tab.hide();
});
test('failed connection keeps old settings; hiding the form cancels an in-flight save', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const tab = settings(h), before = JSON.stringify(h.plugin.settings);
    dav.state.status = 403;
    button(tab.containerEl, 'Save connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(JSON.stringify(h.plugin.settings), before);
    assert.match(tab.containerEl.textContent, /Authentication or access denied/);
    dav.state.status = 207;
    const gate = deferred(); dav.state.beforeList = () => gate.promise;
    const saves = h.state.saves;
    button(tab.containerEl, 'Save connection').click();
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
    const preference = tab.containerEl.querySelector('select');
    assert.equal(preference.value, 'ask');
    change(h, preference, 'append', 'change');
    await until(() => preference.value === 'ask');
    assert.equal(JSON.stringify(h.plugin.settings), before);
    button(tab.containerEl, 'Save connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(JSON.stringify(h.plugin.settings), before);
    assert.equal(button(tab.containerEl, 'Save connection').disabled, false);
    h.state.beforeSave = null;
    button(tab.containerEl, 'Save connection').click();
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
    change(h, input(tab.containerEl, 'Password or app password'), 'synthetic-test-password');
    button(tab.containerEl, 'Test connection').click();
    button(tab.containerEl, 'Test connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(JSON.stringify(h.plugin.settings), before);
    assert.equal(h.state.saves, 0);
    assert.equal(h.secretState.writes, 0);
    assert.deepEqual(dav.state.requests.map(request => request.method), ['PROPFIND']);
    assert.equal(dav.state.authValid, true);
    assert.match(tab.containerEl.textContent, /Connection successful; found 1/);
    assert.notEqual(input(tab.containerEl, 'Password or app password').value, '');
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
    modal.contentEl.querySelectorAll('[role=option]')[1].click();
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
    modal.contentEl.querySelectorAll('[role=option]')[1].click();
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
    button(tab.containerEl, 'Save connection').click();
    await until(() => !h.plugin.connectionSaving);
    assert.equal(dav.state.requests.length, 0); assert.deepEqual(h.plugin.settings, before);
});

test('connection-only form omits preferences and marks a successful test as not saved', async t => {
    const h = await harness(t), dav = await server(t);
    const tab = new h.MoonReaderWebDAVSettingTab(h.app, h.plugin, () => {}, true);
    tab.display();
    assert.ok(!tab.containerEl.querySelector('textarea')); assert.ok(!tab.containerEl.querySelector('select'));
    assert.equal(tab.containerEl.querySelectorAll('input').length, 3);
    change(h, input(tab.containerEl, 'WebDAV folder URL'), dav.url);
    change(h, input(tab.containerEl, 'Username'), 'reader');
    change(h, input(tab.containerEl, 'Password or app password'), 'synthetic-test-password');
    button(tab.containerEl, 'Test connection').click(); await until(() => !h.plugin.connectionSaving);
    assert.equal(tab.containerEl.querySelector('[role=status]').dataset.state, 'tested');
    assert.match(tab.containerEl.textContent, /Not saved/);
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

