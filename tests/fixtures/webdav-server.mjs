// Loopback-only synthetic service for manual verification in the real Obsidian host.
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const title = 'MoonReader Keychain QA - A deliberately long book title to verify two-line truncation in the native library';
const block = (id, text) => [id, title, 'path', 'path', '1', '0', '0', '9', '-65536', '1790740800000', '', 'Synthetic native credential and import test.', text, '0', '0', '0', ''];
const packed = deflateSync(['1', 'header', 'version', '#', ...block('9001', 'Native secret storage acceptance.'), ...block('9002', 'Repeat imports require an explicit choice.')].join('\n'));
const compiled = await build({ entryPoints: ['src/utils/anParser.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const fixtureModule = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), fixtureModule, fixtureModule.exports);
assert.equal(fixtureModule.exports.AnParser.parseBuffer(Uint8Array.from(packed).buffer).length, 2);
const xml = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/keychain-qa.an</d:href><d:propstat><d:prop><d:getlastmodified>Wed, 30 Sep 2026 12:00:00 GMT</d:getlastmodified><d:getcontentlength>' + packed.length + '</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
const server = createServer((req, res) => {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('native-qa:synthetic-native-password').toString('base64')) {
        res.writeHead(401); res.end(); return;
    }
    console.log('Native fixture ' + req.method);
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); res.end(xml); }
    else if (req.method === 'GET' && req.url === '/dav/keychain-qa.an') { res.writeHead(200); res.end(packed); }
    else { res.writeHead(404); res.end(); }
});
server.listen(60923, '127.0.0.1', () => console.log('Validated native fixture: http://127.0.0.1:60923/dav/'));
