import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
class FileSystemAdapter {
    constructor(base) { this.base = base; }
    async exists(path) { try { await fs.stat(join(this.base, path)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
    read(path) { return fs.readFile(join(this.base, path), 'utf8'); }
    write(path, text) { return fs.writeFile(join(this.base, path), text); }
    async rename(path, next) {
        if (await this.exists(next)) throw new Error('Destination file already exists!');
        return fs.rename(join(this.base, path), join(this.base, next));
    }
    remove(path) { return fs.unlink(join(this.base, path)); }
}
const obsidian = {
    getLanguage: () => 'en', FileSystemAdapter, normalizePath: path => path.replaceAll('\\', '/'),
    Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, SuggestModal: class {}, Component: class {}
};
const result = await build({
    stdin: { contents: [
        "export { AnParser } from './src/utils/anParser';",
        "export * from './src/utils/notes';",
        "export * from './src/utils/cache';",
        "export * from './src/utils/sync';",
        "export * from './src/utils/webdav';",
        "export { default as Plugin } from './src/main';"
    ].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    name => name === 'obsidian' ? obsidian : require(name), module, module.exports
);
const { AnParser, renderNotes, mergeNote, readCache: readVaultCache, writeCache: writeVaultCache, sourceId, isBook, syncBooks, WebDAVClient, normalizeWebDavUrl, Plugin } = module.exports;
const readCache = (path, source, url) => readVaultCache(new FileSystemAdapter(dirname(path)), basename(path), source, url);
const writeCache = (path, cache) => writeVaultCache(new FileSystemAdapter(dirname(path)), basename(path), cache);
const note = { id: '10', bookName: 'Book', chapter: '2', colorHex: '#ffeb3b', timestamp: '2026-01-01 00:00:00', note: '  thought  ', highlightText: 'A passage' };
const block = ['10', 'Book', 'path', 'path', '2', '0', '3', '8', '-256', '1767225600000', '', note.note, note.highlightText, '0', '0', '0', ''];
function compressed(lines = block) {
    const data = deflateSync(['1', 'header', 'version', '#', ...lines].join('\n'));
    return Uint8Array.from(data).buffer;
}
const remote = { href: 'https://example.test/dav/book.an', lastModified: 'Tue, 01 Jan 2026 00:00:00 GMT', contentLength: 100, isCollection: false };
const book = { fileHref: remote.href, bookName: 'Book', notes: [note], lastModified: remote.lastModified, contentLength: 100, lastSynced: '2026-01-01T00:00:00Z' };
const root = await fs.mkdtemp(join(tmpdir(), 'moonreader-regression-'));
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('parser preserves content whitespace, reads complete record and rejects corrupt data', () => {
    const parsed = AnParser.parseBuffer(compressed());
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].note, note.note);
    assert.equal(parsed[0].colorHex, '#ffff00');
    assert.throws(() => AnParser.parseBuffer(new ArrayBuffer(4)));
    assert.throws(() => AnParser.parseBuffer(compressed(block.slice(0, 15))));
    const invalid = [...block]; invalid[4] = '2oops';
    assert.throws(() => AnParser.parseBuffer(compressed(invalid)));
    const partial = [...block]; partial[16] = '#';
    assert.throws(() => AnParser.parseBuffer(compressed([...partial, ...invalid])));
    assert.deepEqual(AnParser.parseBuffer(compressed([])), []);
});
test('template replacement is literal, single-pass and HTML escaped', () => {
    const input = { ...note, highlightText: '$& $1 {note} <tag>', note: 'replacement' };
    assert.equal(renderNotes([input], '{highlightText}|{note}'), '$&amp; $1 {note} &lt;tag&gt;|replacement');
});
test('append and replacement preserve intended content and YAML edge cases', () => {
    assert.equal(mergeNote('old', 'new', 'append'), 'old\nnew');
    assert.equal(mergeNote('', 'new', 'append'), 'new');
    assert.equal(mergeNote('---\r\ntitle: T\r\n---\r\nold', 'new', 'overwrite'), '---\r\ntitle: T\r\n---\r\nnew');
    assert.equal(mergeNote('\uFEFF---\na: 1\n---', 'new', 'overwrite'), '\uFEFF---\na: 1\n---\nnew');
    assert.equal(mergeNote('plain body', 'new', 'overwrite'), 'new');
});
test('failed refresh retains old notes and metadata and retries even when metadata matches', async () => {
    let calls = 0;
    const failed = await syncBooks({ getFiles: async () => [remote], getFileBuffer: async () => { calls++; throw new Error('offline'); } }, [{ ...book, syncError: 'previous failure' }], () => {});
    assert.equal(calls, 1); assert.equal(failed.failed, 1);
    assert.deepEqual(failed.books[0].notes, book.notes);
    assert.equal(failed.books[0].lastSynced, book.lastSynced);
});
test('matching reliable metadata avoids download; missing metadata and legacy cache do not', async () => {
    let calls = 0;
    const client = { getFiles: async () => [remote], getFileBuffer: async () => { calls++; return compressed(); } };
    assert.equal((await syncBooks(client, [book], () => {})).unchanged, 1);
    assert.equal(calls, 0);
    assert.equal((await syncBooks(client, [{ ...book, lastSynced: undefined }], () => {})).updated, 1);
    assert.equal(calls, 1);
    client.getFiles = async () => [{ ...remote, lastModified: '' }];
    await syncBooks(client, [book], () => {});
    assert.equal(calls, 2);
});
test('partial refresh retains failed book, updates good book and reports new failures', async () => {
    const good = { ...remote, href: 'https://example.test/dav/good.an' };
    const fresh = { ...remote, href: 'https://example.test/dav/new.an' };
    const progress = [];
    const result = await syncBooks({ getFiles: async () => [remote, good, fresh], getFileBuffer: async href => href === good.href ? compressed() : new ArrayBuffer(2) }, [{ ...book, syncError: 'retry' }], (done, total) => progress.push([done, total]));
    assert.equal(result.updated, 1); assert.equal(result.failed, 2); assert.equal(result.books.length, 2);
    assert.equal(result.books[0].notes[0].highlightText, note.highlightText);
    assert.deepEqual(progress.at(-1), [3, 3]);
});
test('directory errors propagate without providing a replacement cache', async () => {
    await assert.rejects(syncBooks({ getFiles: async () => { throw new Error('403'); }, getFileBuffer: async () => compressed() }, [book], () => {}));
});
test('cache replaces JSON with a non-overwriting adapter, scopes accounts and migrates legacy records', async () => {
    const path = join(root, 'cache.json');
    const source = sourceId('https://example.test/dav/', 'reader');
    const cache = { version: 1, source, checkedAt: '2026-01-01T00:00:00Z', books: [book] };
    await writeCache(path, cache);
    assert.deepEqual(await readCache(path, source, 'https://example.test/dav/'), cache);
    assert.equal((await readCache(path, 'other-account', 'https://example.test/dav/')).books.length, 0);
    await writeCache(path, { ...cache, books: [] });
    assert.equal((await readCache(path, source, 'https://example.test/dav/')).books.length, 0);
    await fs.writeFile(path, JSON.stringify([{ ...book, fileHref: '/dav/book.an' }]));
    const legacy = await readCache(path, source, 'https://example.test/dav/');
    assert.equal(legacy.books[0].fileHref, remote.href); assert.equal(legacy.books[0].lastSynced, undefined);
    assert.equal(isBook({ ...book, notes: ['bad'] }), false);
    await fs.writeFile(path, '{broken');
    await assert.rejects(readCache(path, source, 'https://example.test/dav/'));
    assert.equal(await fs.readFile(path, 'utf8'), '{broken');
});
test('failed cache serialization preserves previous file and removes temporary files', async () => {
    const path = join(root, 'preserved.json');
    const cache = { version: 1, source: 'a', checkedAt: '', books: [book] };
    await writeCache(path, cache);
    const circular = { ...cache }; circular.books = [circular];
    await assert.rejects(writeCache(path, circular));
    assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), cache);
    assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
});

test('vault adapter write and rename failures preserve the previous cache and clean staging files', async () => {
    const storage = new FileSystemAdapter(root), path = 'adapter-failure.json';
    const original = { version: 1, source: 'a', checkedAt: '', books: [book] };
    await writeVaultCache(storage, path, original);
    for (const operation of ['write', 'rename']) {
        const failed = Object.create(storage);
        failed[operation] = async (...args) => {
            if (operation === 'write') await storage.write(...args);
            throw new Error('Controlled adapter failure');
        };
        await assert.rejects(writeVaultCache(failed, path, { ...original, books: [] }), /Controlled adapter failure/);
        assert.deepEqual(await readVaultCache(storage, path, 'a', 'https://example.test/dav/'), original);
        assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
    }
});
test('WebDAV URLs preserve encoded path characters and reject cross-origin download before auth', async () => {
    assert.equal(normalizeWebDavUrl('https://example.test/dav/a%23b'), 'https://example.test/dav/a%23b/');
    assert.throws(() => normalizeWebDavUrl('https://user:password@example.test/dav/'));
    assert.throws(() => normalizeWebDavUrl('file:///tmp/'));
    const client = new WebDAVClient('https://example.test/dav/', 'reader', 'test-password');
    await assert.rejects(client.getFileBuffer('https://other.test/file.an'), /another site/);
});
test('cache promotion failure rolls back; an interrupted rollback recovers on the next read', async () => {
    for (const failRollback of [false, true]) {
        const storage = new FileSystemAdapter(root), path = `rollback-${failRollback}.json`;
        const original = { version: 1, source: 'a', checkedAt: '', books: [book] };
        await writeVaultCache(storage, path, original);
        const failed = Object.create(storage);
        failed.rename = async (from, to) => {
            if (from.endsWith('.tmp') || (failRollback && from.endsWith('.bak'))) throw new Error('Promotion failure');
            return storage.rename(from, to);
        };
        await assert.rejects(writeVaultCache(failed, path, { ...original, books: [] }), /Promotion failure/);
        assert.equal(await storage.exists(path + '.bak'), failRollback);
        assert.deepEqual(await readVaultCache(storage, path, 'a', 'https://example.test/dav/'), original);
        assert.equal(await storage.exists(path + '.bak'), false);
    }
});
test('committed cache survives failed backup cleanup and concurrent reads and writes stay ordered', async () => {
    const storage = new FileSystemAdapter(root), path = 'ordered-cache.json';
    const original = { version: 1, source: 'a', checkedAt: '', books: [book] };
    await writeVaultCache(storage, path, original);
    const failed = Object.create(storage);
    failed.remove = async name => { if (name.endsWith('.bak')) throw new Error('Cleanup failure'); return storage.remove(name); };
    const next = { ...original, books: [] };
    await writeVaultCache(failed, path, next);
    assert.deepEqual(await readVaultCache(failed, path, 'a', 'https://example.test/dav/'), next);
    assert.deepEqual(await readVaultCache(storage, path, 'a', 'https://example.test/dav/'), next);
    const operations = await Promise.all([
        writeVaultCache(storage, path, original),
        readVaultCache(storage, path, 'a', 'https://example.test/dav/'),
        writeVaultCache(storage, path, next),
        readVaultCache(storage, path, 'a', 'https://example.test/dav/')
    ]);
    assert.deepEqual(operations[1], original);
    assert.deepEqual(operations[3], next);
    assert.equal(await storage.exists(path + '.bak'), false);
});
test('settings saves serialize, and a failed save does not change effective settings', async () => {
    const plugin = new Plugin();
    const values = [];
    plugin.saveData = async data => { await new Promise(resolve => setTimeout(resolve, 5)); values.push(data); };
    await Promise.all([plugin.updateSettings({ username: 'one' }), plugin.updateSettings({ noteTemplate: '{note}' })]);
    assert.equal(plugin.settings.username, 'one'); assert.equal(plugin.settings.noteTemplate, '{note}');
    assert.equal(values[1].username, 'one');
    plugin.saveData = async () => { throw new Error('disk error'); };
    await assert.rejects(plugin.updateSettings({ username: 'lost' }));
    assert.equal(plugin.settings.username, 'one');
});
test('legacy migration binds the old account and later account switches keep caches separate', async () => {
    const vault = join(root, 'migration-vault');
    const pluginDir = '.obsidian/plugins/obsidian-moonreader-sync';
    await fs.mkdir(join(vault, pluginDir), { recursive: true });
    await fs.writeFile(join(vault, pluginDir, 'moonreader_cache.json'), JSON.stringify([book]));
    const plugin = new Plugin();
    plugin.app = { vault: { adapter: new FileSystemAdapter(vault) } };
    plugin.manifest = { dir: pluginDir };
    plugin.settings = { ...plugin.settings, webDavUrl: 'https://example.test/dav/', username: 'original' };
    await plugin.loadCache();
    assert.equal(plugin.cache.books.length, 1);
    const oldSource = plugin.cache.source;
    assert.equal(JSON.parse(await fs.readFile(join(vault, pluginDir, 'moonreader_cache.json'), 'utf8')).source, oldSource);
    plugin.settings = { ...plugin.settings, username: 'other' };
    await plugin.loadCache();
    assert.equal(plugin.cache.books.length, 0);
    assert.notEqual(plugin.cache.source, oldSource);
    plugin.settings = { ...plugin.settings, username: 'original' };
    await plugin.loadCache();
    assert.equal(plugin.cache.books.length, 1);
});
test('refresh is mutually exclusive and leaves cache intact on request failure', async () => {
    const plugin = new Plugin();
    const vault = join(root, 'refresh-vault');
    await fs.mkdir(vault);
    plugin.app = { secretStorage: { getSecret: () => 'test-password' } };
    plugin.settings = { ...plugin.settings, webDavUrl: 'https://example.test/dav/', username: 'reader', secretId: 'moonreader-test' };
    plugin.cache = { version: 1, source: sourceId(plugin.settings.webDavUrl, 'reader'), checkedAt: '', books: [book] };
    const before = plugin.cache;
    let requests = 0;
    obsidian.requestUrl = async () => { requests++; await new Promise(resolve => setTimeout(resolve, 10)); return { status: 403 }; };
    await Promise.all([plugin.refresh(), plugin.refresh()]);
    assert.equal(requests, 1); assert.equal(plugin.syncing, false); assert.equal(plugin.cache, before);
    plugin.connectionSaving = true;
    await plugin.refresh();
    assert.equal(requests, 1);
});
test('local private samples agree with independently decoded full records', async context => {
    let files;
    try { files = (await fs.readdir('.testdata')).filter(name => name.endsWith('.an')); }
    catch { context.skip('No private samples available'); return; }
    if (!files.length) { context.skip('No private samples available'); return; }
    let total = 0;
    for (const file of files) {
        const input = await fs.readFile(join('.testdata', file));
        const lines = inflateSync(input).toString('utf8').split(/\r?\n/);
        const start = lines.indexOf('#') + 1;
        const expected = [];
        for (let i = start; i + 16 < lines.length; i += 17) {
            if (lines[i + 11] || lines[i + 12]) expected.push({
                id: String(Number(lines[i])), bookName: lines[i + 1], chapter: String(Number(lines[i + 4])),
                note: lines[i + 11], highlightText: lines[i + 12],
                colorHex: '#' + ((Number(lines[i + 8]) >>> 0) & 0xffffff).toString(16).padStart(6, '0'),
                timestamp: Number(lines[i + 9]) > 0 ? new Date(Number(lines[i + 9])).toISOString().replace('T', ' ').slice(0, 19) : ''
            });
        }
        assert.deepEqual(AnParser.parseBuffer(Uint8Array.from(input).buffer), expected);
        total += expected.length;
    }
    context.diagnostic(files.length + ' private sample(s); ' + total + ' complete records checked without printing their content.');
});
