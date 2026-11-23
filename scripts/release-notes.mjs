import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function extractReleaseNotes(changelog, version) {
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex(line => line.trim() === '## ' + version);
    if (start < 0) throw new Error('Missing changelog section for ' + version);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) { end = i; break; }
    }
    const body = lines.slice(start, end).join('\n').trim();
    const contentLines = lines.slice(start + 1, end).filter(line => line.trim() !== '');
    if (!contentLines.length) throw new Error('Empty changelog section for ' + version);
    return body + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const version = process.argv[2];
    if (!version) {
        console.error('Usage: node scripts/release-notes.mjs <version> [--out <file>]');
        process.exit(1);
    }
    const outIndex = process.argv.indexOf('--out');
    const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';
    const changelog = await readFile('CHANGELOG.md', 'utf8');
    const notes = extractReleaseNotes(changelog, version);
    if (outPath) await writeFile(outPath, notes, 'utf8');
    else process.stdout.write(notes);
}
