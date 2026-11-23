import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

export const packed = deflateSync(['1', 'header', 'version', '#', '100', 'Synthetic book', 'path', 'path', '1', '0', '0', '9', '-65536', '1767225600000', '', 'Thought', 'Highlight', '0', '0', '0', ''].join('\n'));

export function entry(href = 'book%23one.an', prop = '') {
    return '<d:response><d:href>' + href + '</d:href><d:propstat><d:prop><d:getlastmodified>Thu, 01 Jan 2026 00:00:00 GMT</d:getlastmodified><d:getcontentlength>' + packed.length + '</d:getcontentlength>' + prop + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
}

export const xml = body => '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' + body + '</d:multistatus>';

export async function server(t) {
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

export async function connected(h, dav) {
    h.app.secretStorage.setSecret('moonreader-test', 'synthetic-test-password');
    await h.plugin.updateSettings({ webDavUrl: dav.url, username: 'reader', secretId: 'moonreader-test' });
    return new h.WebDAVClient(dav.url, 'reader', 'synthetic-test-password');
}

export function submitConnection(tab) {
    const btn = tab.containerEl.querySelector('[data-action="save-connection"]');
    assert.ok(btn);
    return btn;
}

export function passwordInput(tab) {
    return tab.containerEl.querySelector('.moonreader-new-password input[type=password]');
}

export function settings(h) {
    const tab = new h.MoonReaderWebDAVSettingTab(h.app, h.plugin);
    h.document.body.append(tab.containerEl);
    tab.display();
    return tab;
}
