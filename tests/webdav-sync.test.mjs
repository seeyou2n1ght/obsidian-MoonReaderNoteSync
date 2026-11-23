import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { harness, button, input, change, until, deferred, openImport, chooseMode, chooseSort, book } from './helpers.mjs';
import { packed, entry, xml, server, connected, submitConnection, passwordInput, settings } from './webdav-helpers.mjs';

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

test('first open checks an already cached library once, even when the remote result is empty', async t => {
    const h = await harness(t), dav = await server(t), gate = deferred();
    await connected(h, dav); await h.plugin.loadCache();
    h.plugin.cache.books = [book]; dav.state.body = xml(''); dav.state.beforeList = () => gate.promise;
    assert.equal(dav.state.requests.length, 0);
    h.plugin.openLibrary(); h.plugin.openLibrary();
    const modal = h.document.querySelector('.moonreader-library');
    assert.ok(modal.querySelector('[aria-selected=true]').textContent.includes(book.bookName));
    await until(() => dav.state.requests.length === 1);
    assert.equal(modal.querySelector('progress').hidden, false);
    gate.resolve(); await until(() => !h.plugin.syncing);
    assert.equal(h.plugin.cache.books.length, 0);
    assert.match(modal.querySelector('[data-phase=ready]').textContent, /No .an files/);
    h.plugin.browser.close(); h.plugin.openLibrary();
    assert.equal(h.plugin.syncing, false);
    assert.equal(dav.state.requests.length, 1);
    assert.equal(h.document.querySelectorAll('.moonreader-library').length, 1);
});

test('failed warmup retains cached notes, manual retry updates status and a changed source gets a new check', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); await h.plugin.loadCache();
    h.plugin.cache.books = [book]; dav.state.status = 503;
    h.plugin.openLibrary(); await until(() => !h.plugin.syncing);
    const modal = h.document.querySelector('.moonreader-library');
    assert.ok(modal.querySelector('[data-phase=error]'));
    assert.ok(modal.querySelector('[aria-selected=true]'));
    h.plugin.openLibrary(); assert.equal(h.plugin.syncing, false);
    dav.state.status = 403; button(modal, 'Retry').click(); await until(() => !h.plugin.syncing);
    assert.ok(button(modal, 'Check credentials'));
    const other = await server(t);
    await h.plugin.saveConnection(other.url, 'reader', 'synthetic-test-password', () => true, 'moonreader-test');
    other.state.getStatus = 500;
    h.plugin.openLibrary(); await until(() => !h.plugin.syncing);
    assert.match(modal.querySelector('.moonreader-library-toolbar').textContent, /1 book updates failed/);
    other.state.getStatus = 200; button(modal, 'Retry').click(); await until(() => !h.plugin.syncing);
    assert.ok(modal.querySelector('[data-phase=ready]'));
    assert.equal(h.plugin.cache.books[0].notes[0].highlightText, 'Highlight');
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
    assert.match(modal.contentEl.textContent, /Showing 1 \/ 3/);
    modal.close();
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

test('refresh listing and download timeouts retain notes, release the lock and ignore late responses after retry', async t => {
    for (const method of ['PROPFIND', 'GET']) {
        const h = await harness(t), dav = await server(t);
        await connected(h, dav); await h.plugin.refresh();
        h.plugin.cache.books[0].lastSynced = undefined;
        const previousNotes = h.plugin.cache.books[0].notes;
        const gate = deferred(), request = h.host.requestUrl;
        let held = false, timedOut = false;
        h.host.requestUrl = options => {
            if (options.method === method && !held) { held = true; return gate.promise; }
            return request(options);
        };
        const timer = h.dom.window.setTimeout.bind(h.dom.window);
        h.dom.window.setTimeout = (callback, delay, ...args) => {
            assert.equal(delay, 30_000);
            return timer(() => { timedOut = true; callback(...args); }, 80);
        };
        const pending = h.plugin.refresh();
        await until(() => held);
        await h.plugin.refresh();
        assert.equal(h.plugin.syncing, true);
        await until(() => !h.plugin.syncing);
        await pending;
        assert.equal(timedOut, true);
        assert.equal(h.plugin.syncing, false);
        assert.deepEqual(h.plugin.cache.books[0].notes, previousNotes);
        assert.match(h.plugin.status, method === 'PROPFIND' ? /timed out/ : /1 failed/);
        h.dom.window.setTimeout = timer;
        await h.plugin.refresh();
        assert.match(h.plugin.status, /Refresh complete: 1 updated/);
        const committed = h.plugin.cache, status = h.plugin.status;
        const cacheFile = (await fs.readdir(join(h.vault, h.dir))).find(f => /^moonreader_cache\.[a-f0-9]+\.json$/.test(f));
        const disk = await fs.readFile(join(h.vault, h.dir, cacheFile), 'utf8');
        gate.resolve({ status: 207, text: xml(''), arrayBuffer: new ArrayBuffer(0) });
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(h.plugin.cache, committed);
        assert.equal(h.plugin.status, status);
        assert.equal(await fs.readFile(join(h.vault, h.dir, cacheFile), 'utf8'), disk);
    }
});

test('unchanged refresh writes only freshness metadata and restores it across cache loads', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); await h.plugin.refresh();
    const books = h.plugin.cache.books, snapshot = h.plugin.cache.checkedAt;
    const storage = h.app.vault.adapter, write = storage.write.bind(storage), writes = [];
    storage.write = async (path, text) => { writes.push({ path, text }); await write(path, text); };
    await h.plugin.refresh();
    assert.equal(h.plugin.cache.books, books);
    assert.equal(writes.length, 1); assert.match(writes[0].path, /\.check\..+\.tmp$/);
    assert.equal(JSON.parse(writes[0].text).snapshot, snapshot);
    const checked = h.plugin.lastChecked;
    await h.plugin.loadCache(); assert.equal(h.plugin.lastChecked, checked);
    assert.deepEqual(h.plugin.cache.books, books);
    const rename = storage.rename.bind(storage);
    storage.rename = async (from, to) => {
        if (from.endsWith('.tmp') && to.endsWith('.check')) throw new Error('controlled metadata promotion failure');
        await rename(from, to);
    };
    await h.plugin.refresh(); assert.equal(h.plugin.libraryPhase, 'error');
    storage.rename = rename;
    await h.plugin.loadCache(); assert.equal(h.plugin.lastChecked, checked);
    assert.deepEqual(h.plugin.cache.books, books);
    await storage.remove(h.plugin.cachePath(h.plugin.cache.source));
    await h.plugin.refresh(); await h.plugin.loadCache();
    assert.deepEqual(h.plugin.cache.books, books);
    dav.state.body = xml('');
    await h.plugin.refresh();
    assert.match(h.plugin.librarySummary, /1 books removed/);
    await h.plugin.loadCache();
    assert.equal(h.plugin.lastChecked, h.plugin.cache.checkedAt);
});

test('partial sync with no cached books never becomes a confirmed empty remote folder after reload', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav); dav.state.getStatus = 403;
    await h.plugin.refresh();
    assert.match(h.plugin.status, /Authentication or access denied/);
    await h.plugin.loadCache(); h.plugin.openLibrary(false);
    assert.match(h.plugin.browser.empty.textContent, /No locally cached books/);
});

test('unloading during an active refresh aborts the in-flight WebDAV request immediately', async t => {
    const h = await harness(t), dav = await server(t);
    await connected(h, dav);
    const gate = deferred();
    h.host.requestUrl = () => gate.promise;
    const startedAt = Date.now();
    const refresh = h.plugin.refresh();
    await until(() => h.plugin.syncing);
    h.plugin.onunload();
    await refresh;
    assert.ok(Date.now() - startedAt < 2000, 'Expected refresh to abort immediately on unload instead of timing out');
    assert.equal(h.plugin.syncing, false);
});
