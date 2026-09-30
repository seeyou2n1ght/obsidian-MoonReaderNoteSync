# MoonReader Note Sync

English | [中文](README.md)

Import highlights and annotations from Moon+ Reader WebDAV backups into Obsidian. Search books, preview notes, and customize the import template. The interface follows Obsidian's language setting in English or Chinese, and cached books are available offline.

Requires **Obsidian 1.11.5 or later on desktop**. Mobile is not supported. The current version is **0.3.0**; see [CHANGELOG](CHANGELOG.md) for changes.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases). Place them directly in your vault's `.obsidian/plugins/moonreader-note-sync/` folder, then enable the plugin in Obsidian's community plugin settings.

You can also extract the release ZIP into that folder. GitHub's automatically generated source archives do not contain the built plugin. If you previously installed it under another folder name, update that folder to avoid a duplicate installation.

## Connect your backup

First, back up your reading annotations to WebDAV from Moon+ Reader. Check that the backup folder contains `.an` files.

1. Open the plugin settings and enter the WebDAV folder URL, username, and password or app password.
2. Optionally select **Test connection** to check folder access. Testing does not save settings.
3. Select **Save connection**. After validation, the password is stored in Obsidian Keychain.
4. Open the library from the ribbon button or the **Browse and import notes** command. Books are fetched automatically if there is no cache. Use the refresh button for later updates.

If setup is incomplete, refreshing shows an explanation. The library's settings button opens the connection form; import preferences and the default template are available in the full plugin settings.

### Upgrading from an older version

Version 0.2.0 no longer uses a separate key file or migrates old passwords. Re-enter your password once and save the connection. The server URL, username, template, and cache can be retained. Old key files are not deleted automatically.

## Import notes

Search or select a book on the left. The right pane previews the first three annotations, and the footer shows the destination and insertion mode. **Insert N notes** imports all annotations from the selected book.

- By default, notes are inserted at the cursor position captured when the panel opened. Selected text is not replaced. If another pane has focus, the plugin uses the most recent Markdown note that is still open.
- If no destination note is open, select **Choose note**, choose a file, then select **Append N notes**.
- **More** lets you append, change the destination, or replace the body. Replacement requires confirmation and preserves the file's leading YAML properties.
- **Adjust template** shows available fields. Click or drag a field into the template. Changes apply to this import unless you select **Save as default template**.
- Importing the same book into the same note again during one plugin session requires **Import again** confirmation. Canceling or closing before writing does not write anything; closing during a write waits for it to finish.

Use the arrow keys in the search field to select a book. Enter focuses the import button. Ctrl/Cmd+Enter inserts or appends; it cannot bypass replacement or repeated-import confirmation.

**There is no deduplication across sessions or two-way synchronization.** Repeated imports may create duplicate content and block IDs. Importing does not delete or modify remote backups.

### Library display settings

The row above the book list shows the count and current order, such as **Modified ↓**. Click the order button to choose modification time or title, and ascending or descending order, from an Obsidian native menu. Changes apply immediately and are saved for the next time you open the library. **Books shown** remains in the full plugin settings. The defaults show all books, ordered by backup modification time, newest first.

- Enter a non-negative integer for the display limit. `0` shows all books. This changes only the list, not refreshes, downloads, or the cache. The list shows the visible count and the total number of matches.
- Search matches all cached books before sorting and applying the limit, so books beyond the limit can still be found by searching.
- Date means the **WebDAV backup file's modification time**, not reading time, annotation time, or download time. Books with missing or invalid dates appear last. Equal dates are ordered by title.
- Switching to title defaults to ascending order, ignores case, and compares embedded numbers numerically: Book 2 precedes Book 10. Letter order follows the system locale. Switching to modification time defaults to descending order. Both directions are available for either field.
- Sorting preserves the search and selected book. If the display limit hides that book, the first visible book is selected and its preview appears. Connection hints are hidden once configured. The footer shows the destination filename, with the full path on hover; replacement confirmation still shows the full path.

These features are available from 0.3.0. Handling of missing books has not changed.

Checks for these additions passed on Node 22 and 24: 50 tests passed and the private-sample test was skipped. Coverage includes limits, both sort directions, selection retention, search across all books, unrestricted downloads, failed saves, and defaults for old configurations. Manual checks in Windows Obsidian 1.13.7 covered the native menu, order changes, selection retention, and the simplified layout. Remote refreshes and note writes were not repeated in this round.

## Template fields

| Field | Value |
| --- | --- |
| `{bookName}` | Book title |
| `{chapter}` | Chapter index |
| `{highlightText}` | Highlighted text |
| `{note}` | Personal annotation |
| `{color}` | RGB hexadecimal color |
| `{timestamp}` | UTC time text |
| `{id}` | Original annotation ID |

Templates support Markdown and HTML. Field values are HTML-escaped. Preview and import use the same substitution logic.

## Data and network access

The plugin connects to the WebDAV service you configure, using that service's account to read the backup directory and `.an` files. It has no telemetry, advertisements, or additional network services.

Obsidian Keychain manages passwords locally; the plugin configuration stores only a credential name. Configure the password again on another device. Leave the password field blank to keep an existing password; changing the account or server requires re-entering it. Password updates do not overwrite old credentials. Unused entries can be managed in Obsidian Keychain.

Book caches are stored as plain text in the plugin folder, separately for each server directory and account. The plugin does not require access to files outside the vault.

## Troubleshooting

- **No books found:** Point the URL directly to the WebDAV folder containing `.an` files. If the connection succeeds but finds no annotation files, check Moon+ Reader's backup location.
- **Authentication or access denied:** Check the username, app password, and folder read permissions. Re-enter and save the password if the stored credential is unavailable.
- **A book fails to update:** Its previous cache is retained and marked as failed. Refresh again to retry. If the entire directory cannot be read, all cached books are retained.
- **A book was removed remotely:** After a successful refresh it disappears from the cached list. Imported Markdown files are unchanged.
- **The original note changed:** If the note changes after opening the panel, insertion at the old cursor is refused. You can switch to appending instead.
- **Unsupported backup format:** The parser currently supports the verified fixed 17-line record format. Corrupt or incomplete records cause an error, preventing partial data from overwriting a complete cache.

## Development and validation

Use Node.js 22:

```sh
npm ci
npm run check
npm run dev
```

`npm run check` runs type checking, automated tests, a production build, and release file checks. Tests cover parser/cache regressions and HTTP/UI integration. UI tests use jsdom and explicit Obsidian substitutes; they do not replace testing in the actual app. Private `.an` samples can be placed in the ignored `.testdata/` folder. That test is skipped when no samples are present.

For manual testing in Obsidian, run `node tests/fixtures/webdav-server.mjs`. It listens only on `127.0.0.1:60923`, serves `/dav/`, and uses the synthetic username `native-qa` and password `synthetic-native-password`. Its data is checked by the actual parser before startup. Use a separate test note to check connection testing, saving, refreshing, and import modes. Restore your connection and stop the service afterward.

For 0.2.0, checks passed on Node 22, Node 24, and an independent installation: 44 tests passed and the private-sample test was skipped. Build hashes matched, tag and ZIP checks passed, and the dependency audit reported no known vulnerabilities. GitHub build and release workflows also passed.

Earlier manual checks in Windows Obsidian 1.13.7 covered connection testing, native password storage and retrieval, refreshes, cursor insertion, appending, replacement, repeated-import confirmation, template fields, and long titles using synthetic accounts and a local server. An earlier private-sample check compared 44 records. Real remote WebDAV services, Obsidian 1.11.5, other operating systems, and password retrieval after a full app restart remain untested.

The development `obsidian` package pins an older moment dependency; this project overrides it with the patched 2.31.0 version. It is used only for development type checking, is excluded from the release bundle, and does not replace Obsidian's own dependencies.

## Release process

1. Update `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` together. Describe the changes in `CHANGELOG.md`.
2. Run `npm ci`, `npm run check`, and `npm run check:release -- 0.3.0` with the intended version to check metadata, compatibility, licenses, and build files.
3. Commit the source and release configuration, then push a tag matching the version exactly, such as `0.3.0`, without a `v` prefix.
4. The release workflow checks the build and uploads `main.js`, `manifest.json`, `styles.css`, and an installation ZIP. The ZIP also includes project and third-party licenses. The three plugin files must remain separate release attachments as well.

For a first community-directory submission, follow the [official Obsidian instructions](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin). A published GitHub release and acceptance into the community directory are separate steps.

## License

The project uses the [ISC license](LICENSE), retaining the existing copyright notice. The release bundles decompression code from [pako](https://github.com/nodeca/pako), licensed under MIT and Zlib. Full notices are in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) and are also included in `main.js`.
