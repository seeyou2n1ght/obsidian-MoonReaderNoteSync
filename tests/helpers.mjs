import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const source = await build({ stdin: { contents: [
    "export { default as Plugin } from './src/main';",
    "export { MoonReaderWebDAVSettingTab } from './src/ui/settingTab';",
    "export { NotePreview } from './src/ui/templateBuilder';",
    "export { BookSuggestModal } from './src/ui/bookSuggestModal';",
    "export { WebDAVClient } from './src/utils/webdav';",
].join('\n'), resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false });
const hostCode = await build({ entryPoints: ['tests/fixtures/obsidian.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
function evaluate(code, window, host) {
    const module = { exports: {} };
    const globals = ['window', 'document', 'HTMLElement', 'Event', 'Option', 'DOMParser', 'location'];
    new Function('require', 'module', 'exports', ...globals, code)(
        name => name === 'obsidian' ? host : require(name), module, module.exports, ...globals.map(name => name === 'window' ? window : window[name]));
    return module.exports;
}
export async function harness(t) {
    const root = await fs.mkdtemp(join(tmpdir(), 'moonreader-integration-'));
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.test/?lang=en' });
    class FileSystemAdapter {
        constructor(base) { this.base = base; }
        async exists(path) { try { await fs.stat(join(this.base, path)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
        read(path) { return fs.readFile(join(this.base, path), 'utf8'); }
        write(path, text) { return fs.writeFile(join(this.base, path), text); }
        rename(path, next) { return fs.rename(join(this.base, path), join(this.base, next)); }
        remove(path) { return fs.unlink(join(this.base, path)); }
    }
    const host = { ...evaluate(hostCode.outputFiles[0].text, dom.window), FileSystemAdapter, Plugin: class {
        addSettingTab() {} addRibbonIcon() {} addCommand() {} registerEvent() {}
    }, requestUrl: async ({ url, method, headers }) => {
        const response = await fetch(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(3000) });
        const arrayBuffer = await response.arrayBuffer();
        return { status: response.status, arrayBuffer, text: new TextDecoder().decode(arrayBuffer) };
    } };
    const api = evaluate(source.outputFiles[0].text, dom.window, host);
    const vault = join(root, 'vault');
    const dir = '.obsidian/plugins/obsidian-moonreader-sync';
    await fs.mkdir(join(vault, dir), { recursive: true });
    const target = { path: 'Target.md', basename: 'Target' };
    const other = { path: 'Other.md', basename: 'Other' };
    const files = new Map([[target, '---\ntitle: test\n---\nOriginal body.\n'], [other, 'Other original.\n']]);
    const state = { writes: 0, failWrite: false, beforeWrite: null, saves: 0, beforeSave: null };
    const secrets = new Map();
    const secretState = { writes: 0, failWrite: false, unavailable: false };
    const app = { secretStorage: {
        getSecret: id => { if (secretState.unavailable) throw new Error('Controlled keychain failure'); return secrets.get(id) ?? null; },
        setSecret: (id, value) => { if (secretState.failWrite) throw new Error('Controlled keychain write failure'); secrets.set(id, value); secretState.writes++; }
    }, vault: {
        adapter: new FileSystemAdapter(vault),
        getMarkdownFiles: () => [...files.keys()],
        getAbstractFileByPath: path => [...files.keys()].find(f => f.path === path),
        process: async (file, callback) => {
            if (state.beforeWrite) await state.beforeWrite();
            if (state.failWrite) throw new Error('Controlled disk failure');
            files.set(file, callback(files.get(file))); state.writes++;
        }
    }, workspace: { getActiveViewOfType: () => view, getLeaf: () => ({ openFile: async () => {} }),
        on: () => ({}), getLeavesOfType: () => [{ view }], getMostRecentLeaf: () => ({ view }), getLastOpenFiles: () => [target.path] } };
    const view = Object.assign(new host.MarkdownView(), { file: target, editor: {
        getValue: () => files.get(target), getCursor: () => ({ line: 3, ch: 0 }),
        replaceRange: (text, position) => { assert.deepEqual(position, { line: 3, ch: 0 }); files.set(target, files.get(target) + text); state.writes++; }
    } });
    const plugin = new api.Plugin();
    plugin.app = app; plugin.manifest = { dir };
    plugin.loadData = async () => ({});
    plugin.saveData = async data => {
        if (state.beforeSave) await state.beforeSave();
        await fs.writeFile(join(vault, dir, 'data.json'), JSON.stringify(data)); state.saves++;
    };
    await plugin.onload();
    t.after(async () => {
        plugin.onunload(); dom.window.close();
        assert.equal(dirname(resolve(root)), resolve(tmpdir()));
        assert.ok(basename(root).startsWith('moonreader-integration-'));
        await fs.rm(root, { recursive: true, force: true });
    });
    return { ...api, host, dom, document: dom.window.document, root, vault, dir, plugin, app, view, target, other, files, state, secrets, secretState };
}
export const book = { fileHref: 'https://fixture.test/dav/book.an', bookName: 'Synthetic book', notes: [
    { id: '100', bookName: 'Synthetic book', chapter: '1', colorHex: '#ff0000', timestamp: '2026-01-01 00:00:00', highlightText: 'Highlight', note: 'Thought' }
] };
export function button(root, text) {
    const found = [...root.querySelectorAll('button')].find(el => el.textContent === text);
    assert.ok(found, 'Missing button: ' + text); return found;
}
export function input(rowRoot, name) {
    const row = [...rowRoot.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-info')?.textContent.startsWith(name));
    assert.ok(row, 'Missing setting: ' + name); return row.querySelector('input');
}
export function change(h, el, value, type = 'input') { el.value = value; el.dispatchEvent(new h.dom.window.Event(type, { bubbles: true })); }
export async function until(predicate) {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await sleep(5); }
    assert.fail('Timed out waiting for the expected state');
}
export function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
export function openImport(h, view = h.view) {
    h.plugin.cache.books = [book];
    const modal = new h.BookSuggestModal(h.app, h.plugin, view, () => {});
    modal.open(); return modal;
}
export function chooseMode(h, modal, mode) {
    button(modal.modalEl, 'More').click();
    button(h.document.querySelector('[role=menu]'), { cursor: 'Insert at cursor', append: 'Append to end', overwrite: 'Replace body…' }[mode]).click();
}
export function chooseSort(h, modal, label) {
    const control = modal.contentEl.querySelector('button[aria-label="Book order"]');
    assert.ok(control); control.click();
    button(h.document.querySelector('[role=menu]'), label).click();
}
