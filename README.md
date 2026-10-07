# MoonReader Note Sync

English | [中文](README.zh-CN.md)

Import highlights and annotations from Moon+ Reader WebDAV backups into Obsidian. Search books, preview notes, and customize the import template. The interface follows Obsidian's language setting in English or Chinese, and cached books are available offline.

Requires **Obsidian 1.13.0 or later on desktop**. Mobile is not supported. The current version is **0.3.2**; see [CHANGELOG](CHANGELOG.md) for changes.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases). Place them directly in your vault's `.obsidian/plugins/obsidian-moonreader-sync/` folder, then enable the plugin in Obsidian's community plugin settings.

GitHub's automatically generated source archives do not contain the built plugin. If you installed it under another folder name, preserve `data.json` and the cache files when updating to the folder above, and avoid duplicate installations.

## Usage

### Connect your backup

First, back up your reading annotations to WebDAV from Moon+ Reader. Check that the backup folder contains `.an` files.

1. Open the plugin settings and enter the WebDAV folder URL and username. Select an existing credential, or use **New Keychain** to enter a name and password or app password.
2. Optionally select **Test connection** to check folder access. Testing does not save settings.
3. Select **Verify and save connection**, or **Create Keychain and save connection** when creating an entry. After validation, the connection is saved; a new entry is stored in Obsidian Keychain.
4. Open the library from the ribbon button or the **Browse and import notes** command. Books are fetched automatically if there is no cache. Use the refresh button for later updates.

If setup is incomplete, refreshing shows an explanation. The library's settings button opens the connection form; import preferences and the default template are available in the full plugin settings.

The settings page has four sections: **Backup connection**, **Library display**, **Note insertion**, and **Note template**. The connection card groups the folder URL, account and credential with one test/save footer; editing does not change the active connection until you save. The URL and account stack on narrow panels. Display and insertion preferences save immediately, while template edits use **Save default template**. Each section reports its own result without replacing connection feedback.

The **Connection credential** panel labels its dropdown **Saved Keychains** and displays names only. The saved name appears separately only while switching entries or creating a new one. Unavailable passwords show an actionable warning. The **New Keychain** form includes an editable **Keychain name**, prefilled as `moonreader-<server-host-label>-<8-random-hex-digits>`. You can use a memorable name such as `moonreader-home-nas`. Names support lowercase letters, numbers and dashes, up to 64 characters. A duplicate name is rejected before testing and checked again before saving; choose the existing entry or use another name. Existing UUID names remain unchanged. Selecting a saved credential keeps its name; entering a new password with a new name creates that exact entry, even when the password is unchanged; old entries remain for manual management in Obsidian Keychain. Testing does not save credentials.

Under **Connection credential**, the dropdown only selects existing Keychain entries; it cannot create, edit or delete them. **Currently using** appears only when the draft differs from the saved connection. Healthy entries have no availability badge. Use **New Keychain** to enter a name and password. The single primary button changes to **Create Keychain and save connection** in this mode, and **Verify and save connection** when using an existing entry. Both actions validate the server before applying changes. **Test connection** never creates a credential or changes the saved connection. **Cancel creation** clears the name and password inputs and restores the previous selection. A successful save clears and hides the form; a failed save preserves the draft for retry. When changing accounts or servers, explicitly select a credential or create one. Closing the connection form discards the draft. Manage or rename existing entries separately in Obsidian Keychain.

### Upgrading from an older version

Version 0.2.0 no longer uses a separate key file or migrates old passwords. Re-enter your password once and save the connection. The server URL, username, template, and cache can be retained. Old key files are not deleted automatically.

The dropdown contains named saved Keychains only, with no placeholder option. First-time configuration requires an explicit choice, indicated outside the list; it never automatically binds the first entry. With no saved entries, the list is hidden and **No saved Keychains yet** appears beside the creation action. An empty selection reports an explanation without sending a request.

Changing the username or server clears the credential selection; explicitly choose a saved Keychain, even if there is only one. Reverting to the saved identity restores its credential. Connection checks have a 30-second timeout and a **Cancel check** action. Closing settings clears drafts and cancels checks or saves still waiting to commit. Once writing has started, the save finishes and switches the library cache even if the form closes. Obsidian cannot abort the underlying request; cancelled or timed-out responses are ignored.

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

Obsidian Keychain manages passwords locally; the plugin configuration stores only a credential name. Configure the password again on another device. Select the current credential to keep using it; changing the account or server requires explicitly selecting a credential or entering a new password. Password updates do not overwrite old credentials. Unused entries can be managed in Obsidian Keychain.

Book caches are stored as plain text in the plugin folder, separately for each server directory and account. The plugin does not require access to files outside the vault.

The cache uses the Obsidian vault adapter for temporary writes and replacement inside the plugin folder; it does not access the system filesystem directly. Replacement moves the previous cache to a `.bak` file before promoting the temporary file, since the adapter does not overwrite rename destinations. Failed promotion rolls back; an interrupted replacement recovers the backup on the next cache read or write. Cache operations for the same adapter and path are serialized. The destination picker lists Markdown file paths through Obsidian's vault API without reading all note contents. The plugin does not store data in localStorage or sessionStorage.

Settings use the Obsidian declarative API. Connection fields, display limits, import mode, and the default template appear in global settings search. Connection drafts are saved only after validation.

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

For 0.3.2, checks passed on Node 22 and 24: 53 tests passed and the private-sample test was skipped. In Windows Obsidian 1.13.7, manual checks confirmed global settings search, connection testing without saving drafts, connection saving, initial cache writes, and replacement of existing cache files using a local synthetic backup. Original connection and cache files were restored and their hashes checked afterward. Note imports and real remote services were not retested in this round.

On 2026-10-07, Windows Obsidian 1.14.4 reproduced an existing-cache refresh failure: the adapter rejected renaming over the destination. After the backup-and-promote fix, two consecutive refreshes against the configured real WebDAV service succeeded with six unchanged books and zero failures; the cache timestamp advanced and no staging or backup files remained. Note insertion was not retested in this round.

For 0.2.0, checks passed on Node 22, Node 24, and an independent installation: 44 tests passed and the private-sample test was skipped. Build hashes matched, tag and ZIP checks passed, and the dependency audit reported no known vulnerabilities. GitHub build and release workflows also passed.

Earlier manual checks in Windows Obsidian 1.13.7 covered connection testing, native password storage and retrieval, refreshes, cursor insertion, appending, replacement, repeated-import confirmation, template fields, and long titles using synthetic accounts and a local server. An earlier private-sample check compared 44 records. Real remote WebDAV services, Obsidian 1.13.0, other operating systems, and password retrieval after a full app restart remain untested.

The development `obsidian` package pins an older moment dependency; this project overrides it with the patched 2.31.0 version. It is used only for development type checking, is excluded from the release bundle, and does not replace Obsidian's own dependencies.

`skipLibCheck` skips checks inside dependency declarations because the Obsidian 1.13.1 SDK declarations omit `onHistoryBack` from three classes implementing `HistoryHandler`. Strict checking remains enabled for project code.

The 2026-10-07 review fixes passed 82 automated checks (one private-sample check skipped). Windows Obsidian 1.14.4 verified draft clearing across native settings reconstruction, choosing the sole saved Keychain, cancelling slow checks and ignoring late responses. Queue cancellation and committed saves used an isolated plugin instance with controlled persistence; overlapping preference failures used controlled saves. Import failure, deferred library updates and retry were verified using a real temporary Markdown file and the vault write API; the temporary file was removed. The original connection remained intact and its connection test found six annotation files. Cross-platform and restart credential checks were not repeated.

## Release process

1. Update `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` together. Describe the changes in `CHANGELOG.md`.
2. Run `npm ci`, `npm run check`, and `npm run check:release -- 0.4.0` with the intended version to check metadata, compatibility, licenses, and build files.
3. Commit the source and release configuration, then push a tag matching the version exactly, such as `0.4.0`, without a `v` prefix.
4. The release workflow checks the build, generates provenance attestations for `main.js`, `manifest.json`, and `styles.css`, and uploads only these three plugin files. The project license remains in the repository; third-party notices are included in `main.js`.

For a first community-directory submission, follow the [official Obsidian instructions](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin). A published GitHub release and acceptance into the community directory are separate steps.

## License

The project uses the [ISC license](LICENSE), retaining the existing copyright notice. The release bundles decompression code from [pako](https://github.com/nodeca/pako), licensed under MIT and Zlib. Full notices are in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) and are also included in `main.js`.
