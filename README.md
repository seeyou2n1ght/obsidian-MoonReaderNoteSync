# MoonReader Note Sync

English | [中文](README.zh-CN.md)

Import highlights and annotations from Moon+ Reader WebDAV backups into Obsidian. Search books, preview notes, customize templates, and browse cached books offline. The interface follows Obsidian's English or Chinese language setting.

Requires **Obsidian 1.13.0 or later on desktop**. Mobile is not supported. See [release notes](CHANGELOG.md) for changes.

## Installation

### Obsidian community plugins

1. Open **Settings → Community plugins** and turn on community plugins if needed.
2. Select **Browse** and search for **MoonReader Note Sync**.
3. Select **Install**, then **Enable**.

For updates, use **Check for updates** in Community plugins.

### Manual download

1. Open the [latest GitHub release](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/releases/latest). Under **Assets**, download `main.js`, `manifest.json`, and `styles.css`.
2. Place all three files directly in your vault's `.obsidian/plugins/obsidian-moonreader-sync/` folder. Create the folder if needed.
3. Restart Obsidian or reload the plugin, then enable it in **Settings → Community plugins**.

Source code archives are not built plugin packages. When updating, replace only the three downloaded files; keep `data.json` and cache files, and avoid duplicate installations.

## Usage

### Connect your backup

Back up annotations to WebDAV from Moon+ Reader and locate the folder containing `.an` files.

1. In the plugin settings, enter the **WebDAV folder URL** and **Username**.
2. Choose an entry from **Saved Keychains**, or select **New Keychain** and enter a name and password or app password.
3. Optionally select **Test connection**; testing does not save anything. Apply the connection with **Verify and save connection**, or **Create Keychain and save connection** for a new entry.
4. Open the library from the ribbon button or the **Browse and import notes** command. An empty cache is fetched automatically; use **Refresh library** for later updates.

Keychain names accept lowercase letters, numbers and dashes, up to 64 characters. Existing names cannot be overwritten. Changing the account or server requires choosing a credential again. Manage existing entries in Obsidian Keychain.

Each WebDAV request times out after 30 seconds, including folder listings and annotation downloads during refresh. Connection checks can also be cancelled. Closing settings discards drafts and cancels saves that have not started writing; a save already writing finishes and switches the library to the new connection.

### Import notes

Select a book to preview its first three annotations. The import button writes **all annotations** from that book; the footer shows the destination and insertion mode.

- The default inserts at the cursor captured when the panel opened, without replacing selected text. If another pane has focus, it uses the most recent Markdown note still open.
- With no open destination, use **Choose note**, select a Markdown file, then append.
- **More** lets you append, change the destination, or replace the body. Replacement requires confirmation and preserves leading YAML properties.
- Arrow keys select books, Enter focuses the import button, and Ctrl/Cmd+Enter imports. Shortcuts cannot bypass confirmation.

Importing the same book into the same note again requires confirmation during one plugin session. **There is no deduplication across sessions or two-way sync**; repeated imports may duplicate content and block IDs. Remote backups are never modified. Closing during a write waits for it to finish.

### Library display

Use the list's order button to sort by title or backup modification time in either direction. The default is newest backup first; missing dates appear last. Dates refer to backup files, not reading or annotation time.

**Books shown** sets the display limit; `0` shows all books. Search covers all cached books before applying the limit, which does not affect downloads. Display and default insertion preferences save immediately.

## Templates

Use **Adjust template** in the library for the current import. Select **Save as default template** to reuse it; the default is also editable in plugin settings.

| Field | Value |
| --- | --- |
| `{bookName}` | Book title |
| `{chapter}` | Chapter index |
| `{highlightText}` | Highlighted text |
| `{note}` | Personal annotation |
| `{color}` | RGB hexadecimal color |
| `{timestamp}` | UTC time |
| `{id}` | Original annotation ID |

Templates support Markdown and HTML. Field values are HTML-escaped; preview and import use the same template.

## Data and privacy

The plugin connects only to the configured WebDAV backup service and has no telemetry or additional network services. Passwords stay in Obsidian Keychain; settings store the credential name. Configure the password again on another device.

Book caches are plain text in the plugin folder, separated by server directory and account. Cached books remain available offline. Failed refreshes retain existing cached data; successfully confirmed remote deletions remove books from the library without changing imported notes.

## Troubleshooting

- **No books found:** Check that the selected folder contains `.an` files; a successful connection alone does not confirm the backup location.
- **Authentication fails:** Check the username, app password and folder permissions; select another Keychain or create one if its password is unavailable.
- **A book fails to update:** Its previous data remains available. Refresh to retry; the parser rejects corrupt or incomplete records.
- **The original note closed or changed:** Switch to appending, or open the target note and reopen the library to capture a new cursor position.

Report problems through [GitHub Issues](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/issues).

## License

[ISC](LICENSE). Bundled [pako](https://github.com/nodeca/pako) code uses MIT and Zlib licenses; see [third-party notices](THIRD-PARTY-NOTICES.txt).
