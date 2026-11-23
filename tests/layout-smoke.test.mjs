import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function findChromium() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].filter(Boolean);
    return candidates.find(path => existsSync(path)) || null;
}

async function waitForDebugger(port) {
    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            const targets = await res.json();
            const page = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
            if (page) return page.webSocketDebuggerUrl;
        } catch { /* browser still starting */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for headless Chrome DevTools endpoint');
}

async function openCdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    let nextId = 1;
    const inflight = new Map();
    ws.addEventListener('message', event => {
        const msg = JSON.parse(String(event.data));
        if (msg.id && inflight.has(msg.id)) {
            const { resolve, reject } = inflight.get(msg.id);
            inflight.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        }
    });
    return {
        send(method, params = {}) {
            const id = nextId++;
            return new Promise((resolve, reject) => {
                inflight.set(id, { resolve, reject });
                ws.send(JSON.stringify({ id, method, params }));
            });
        },
        close() { ws.close(); }
    };
}

test('CSS layout keeps modal height fixed on preview expand, clips scroll below toolbar, and fixes settings card', async t => {
    const browserPath = findChromium();
    if (!browserPath) { t.skip('No Chromium binary found'); return; }
    const styles = await readFile('styles.css', 'utf8');
    const profileDir = await mkdtemp(join(tmpdir(), 'moonreader-layout-'));
    const port = 9300 + Math.floor(Math.random() * 600);
    const proc = spawn(browserPath, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        'about:blank'
    ], { stdio: 'ignore' });
    let cdp = null;
    t.after(async () => {
        cdp?.close();
        proc.kill();
        await new Promise(resolve => setTimeout(resolve, 150));
        await rm(profileDir, { recursive: true, force: true });
    });

    const wsUrl = await waitForDebugger(port);
    cdp = await openCdp(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        :root {
            --background-primary: #1e1e24;
            --background-secondary: #18181d;
            --background-modifier-border: #33343d;
            --background-modifier-border-hover: #4a4c58;
            --background-modifier-hover: #2a2b34;
            --background-modifier-active-hover: #323442;
            --background-modifier-error: #7a2323;
            --interactive-accent: #e05252;
            --text-normal: #e8e8ee;
            --text-muted: #9899a6;
            --text-accent: #e05252;
            --text-warning: #e0a040;
            --text-error: #e05252;
            --text-success: #50b878;
            --radius-s: 4px;
            --radius-m: 8px;
            --font-ui-small: 13px;
            --font-ui-smaller: 12px;
            --font-monospace: monospace;
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: #141418; color: var(--text-normal); font-family: sans-serif; }
        /* Simulate Obsidian 1.15 setting-item separator rule */
        .setting-item { display: flex; align-items: center; padding: 12px 0; }
        .setting-item + .setting-item { border-top: 1px solid var(--background-modifier-border); }
        ${styles}
    </style></head><body>
        <section class="modal moonreader-library">
            <h2>Reading notes</h2>
            <div class="modal-content">
                <div class="moonreader-library-toolbar">
                    <div class="moonreader-meta" data-phase="ready">Today · Checked</div>
                    <button type="button">Refresh</button>
                    <button type="button">Settings</button>
                </div>
                <div class="moonreader-workspace" data-picker="closed">
                    <button class="moonreader-switch-book" type="button">Switch book</button>
                    <div class="moonreader-sidebar">
                        <input type="search">
                        <div class="moonreader-book-list">
                            <button class="moonreader-book-item" aria-selected="true"><span>Book A</span><small class="moonreader-meta">172</small></button>
                        </div>
                    </div>
                    <div class="moonreader-reading">
                        <div class="moonreader-reading-panel">
                            <div class="moonreader-preview-toolbar">
                                <h3 class="moonreader-book-title">Book A</h3>
                                <div class="moonreader-preview-range">
                                    <div class="moonreader-meta">Preview 3 / 172 notes</div>
                                    <button type="button">Preview all</button>
                                </div>
                                <div class="moonreader-preview-controls">
                                    <label>Note order <select><option>Chapter</option></select></label>
                                    <button type="button">Adjust template</button>
                                </div>
                            </div>
                            <div class="moonreader-reading-body">
                                <div class="moonreader-preview moonreader-book-preview">
                                    <div class="markdown-rendered" id="notes"></div>
                                </div>
                                <div class="moonreader-preview-more" id="more"><span>169 more</span><button>Show all</button></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="moonreader-footer">
                    <div class="moonreader-import-actions">
                        <div class="moonreader-destination"><span class="moonreader-meta">Write to</span><button>Target.md</button></div>
                        <button>At cursor ▾</button>
                        <button class="mod-cta">Insert all 172 notes</button>
                    </div>
                </div>
            </div>
        </section>
        <div class="moonreader-settings moonreader-connection-group" style="width: 680px; margin-top: 24px;">
            <div class="moonreader-connection-card">
                <div class="setting-item moonreader-connection-field moonreader-connection-url"><div class="setting-item-info">URL</div><div class="setting-item-control"><input type="text"></div></div>
                <div class="setting-item moonreader-connection-field" id="username-item"><div class="setting-item-info">Username</div><div class="setting-item-control"><input type="text"></div></div>
                <div class="setting-item moonreader-keychain"><div class="setting-item-info">Keychain</div><div class="setting-item-control"></div></div>
                <div class="setting-item moonreader-connection-actions"><div class="setting-item-control"></div></div>
            </div>
        </div>
    </body></html>`;

    await cdp.send('Page.setDocumentContent', { frameId: (await cdp.send('Page.getFrameTree')).frameTree.frame.id, html });

    const evalJs = async expression => {
        const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
        return res.result.value;
    };

    const desktop = await evalJs(`(() => {
        const notes = document.getElementById('notes');
        notes.innerHTML = Array.from({ length: 3 }, (_, i) => '<blockquote>Note ' + i + '</blockquote>').join('');
        const modal = document.querySelector('.moonreader-library');
        const h3 = modal.getBoundingClientRect().height;
        notes.innerHTML = Array.from({ length: 172 }, (_, i) => '<blockquote>Note ' + i + ' line text</blockquote>').join('');
        document.getElementById('more').hidden = true;
        const h172 = modal.getBoundingClientRect().height;
        const body = document.querySelector('.moonreader-reading-body');
        const toolbar = document.querySelector('.moonreader-preview-toolbar');
        const reading = document.querySelector('.moonreader-reading');
        body.scrollTop = 400;
        const tRect = toolbar.getBoundingClientRect();
        const bRect = body.getBoundingClientRect();
        const rRect = reading.getBoundingClientRect();
        const card = document.querySelector('.moonreader-connection-card');
        const urlEl = document.querySelector('.moonreader-connection-url');
        const userEl = document.getElementById('username-item');
        return {
            h3, h172,
            scrollTop: body.scrollTop,
            toolbarBottom: tRect.bottom,
            bodyTop: bRect.top,
            toolbarWidth: tRect.width,
            readingWidth: rRect.width,
            modalOverflowX: modal.scrollWidth > modal.clientWidth,
            bodyOverflowX: body.scrollWidth > body.clientWidth,
            urlWidth: urlEl.getBoundingClientRect().width,
            cardInnerWidth: card.clientWidth - 36,
            usernameBorderTop: getComputedStyle(userEl).borderTopWidth
        };
    })()`);

    assert.equal(desktop.h3, desktop.h172, 'Modal height must stay stable between 3 and 172 notes');
    assert.ok(desktop.scrollTop > 0, 'Reading body must scroll independently');
    assert.ok(desktop.toolbarBottom <= desktop.bodyTop + 1, 'Toolbar must never overlap the scrolled reading body');
    assert.ok(Math.abs(desktop.toolbarWidth - desktop.readingWidth) <= 1, 'Toolbar must span the full reading pane width');
    assert.equal(desktop.modalOverflowX, false);
    assert.equal(desktop.bodyOverflowX, false);
    assert.ok(desktop.urlWidth >= desktop.cardInnerWidth - 2, 'WebDAV URL field must span full connection card width');
    assert.equal(desktop.usernameBorderTop, '0px', 'Username field must not show a stray top divider');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 700, deviceScaleFactor: 1, mobile: false });
    const narrow = await evalJs(`(() => {
        const modal = document.querySelector('.moonreader-library');
        const sw = document.querySelector('.moonreader-switch-book');
        const sidebar = document.querySelector('.moonreader-sidebar');
        return {
            switchDisplay: getComputedStyle(sw).display,
            sidebarDisplay: getComputedStyle(sidebar).display,
            modalOverflowX: modal.scrollWidth > modal.clientWidth
        };
    })()`);
    assert.equal(narrow.switchDisplay, 'block');
    assert.equal(narrow.sidebarDisplay, 'none');
    assert.equal(narrow.modalOverflowX, false);
});
