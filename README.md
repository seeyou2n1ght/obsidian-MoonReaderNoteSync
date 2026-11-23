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

In Moon+ Reader, enable WebDAV backup/sync for reading positions and annotations, and locate the folder containing `.an` files (for example, Jianguoyun typically uses `https://dav.jianguoyun.com/dav/Books/.Notes/` with an app password rather than your account login password; `.Notes` may be a hidden folder).

1. In the plugin settings, enter the **WebDAV folder URL** and **Username**.
2. Choose an entry from **Saved Keychains**, or select **New Keychain** and enter a name and password or app password.
3. Optionally select **Test connection**; testing does not save anything. Apply the connection with **Verify and save connection**, or **Create Keychain and save connection** for a new entry.
4. Open the library from the ribbon button or the **Browse and import notes** command.

Keychain names accept lowercase letters, numbers and dashes, up to 64 characters. Existing names cannot be overwritten. Changing the account or server requires choosing a credential again. Manage existing entries in Obsidian Keychain.

#### Refresh and cache behavior

- Each time the plugin starts, the first library open shows cached books immediately and checks the configured backup in the background. Reopening the library reuses that result; use **Refresh** or **Retry** to check again.
- Select the server name in the top bar to inspect the backup folder, last check time, and per-book failure reasons. Press **Escape** or click outside to close the details popover.
- If a background check removes the currently selected book, select another book before importing. Checks that leave cached books unchanged save only a small timestamp record.
- Each WebDAV request times out after 30 seconds. Connection checks can be cancelled; closing settings discards drafts and cancels saves that have not started writing, while an in-flight commit finishes and switches the library to the new connection.

### Import notes

Choose the default book and note orders in settings. Changing either order in the library also saves that preference. Notes can follow backup order, chapter and reading position (`offset`, with legacy cached notes falling back to backup order), or annotation time in either direction. Missing times appear last when sorting by time.

Select a book to preview its first three sorted annotations. Choose **Preview all** to expand the full preview. Use the fixed preview toolbar to change order, show the first three again, or adjust the template. After changing order or template, wait for the updated preview before importing. The import button writes **all annotations** from that book; the footer shows the destination and insertion mode.

- The default inserts at the cursor captured when the panel opened, without replacing selected text. If another pane has focus, it uses the most recent Markdown note still open.
- With no open destination, use **Choose note** to select an existing Markdown file or create a new note directly from the picker (defaulting to the selected book title), then append.
- Click the destination path to change files or create a new note. The adjacent mode menu selects cursor insertion, append, or replacement. In a narrow window, use **Switch book** to reopen the list. Replacement requires confirmation and preserves leading YAML properties.
- Arrow keys select books, Enter focuses the import button, and Ctrl/Cmd+Enter imports (disabled while typing inside the template editor). Shortcuts cannot bypass confirmation.

Importing the same book into the same note again requires confirmation during one plugin session. **There is no deduplication across sessions or two-way sync**; repeated imports may duplicate content and block IDs. Remote backups are never modified. Closing during a write waits for it to finish.

### Library display

Use the list's order button to sort by title or backup modification time in either direction. The default is newest backup first; missing dates appear last. Dates refer to backup files, not reading or annotation time.

**Books shown** sets the display limit; `0` shows all books. Search covers all cached books before applying the limit, which does not affect downloads. Display and default insertion preferences save immediately.

## Templates

Use **Adjust template** in the library for the current import; unsaved changes are marked on the toggle button and can be reverted with **Reset to default** or saved with **Save as default template**. The default template is also editable in plugin settings.

Default template:

```markdown
> {highlightText} ^{id}
{#note}> <span style="color: {color}">{note}</span>
{/note}
```

| Field | Value |
| --- | --- |
| `{bookName}` | Book title |
| `{chapter}` | Chapter index |
| `{highlightText}` | Highlighted text |
| `{note}` | Personal annotation |
| `{color}` | RGB hexadecimal color |
| `{timestamp}` | UTC time |
| `{id}` | Original annotation ID |

- **Conditional blocks:** Wrap optional sections with `{#field}...{/field}` (for example `{#note}...{/note}`) to render them only when that field is non-empty.
- **Line breaks & spacing:** Moon+ Reader `<BR>` markers in highlights and notes are converted to line breaks (preserving blockquote `>` prefixes on blockquote lines, or `<br>` inside inline HTML tags such as `<span>`). If a rendered note does not end with a newline and the next note does not start with one, a blank line (`\n\n`) is inserted automatically between entries so Markdown blocks such as `>` do not merge into the previous line.
- **Escaping:** Templates support Markdown and HTML. Field values are HTML-escaped, and preview and import always use the same template.

## Data and privacy

The plugin connects only to the configured WebDAV backup service and has no telemetry or additional network services. Passwords stay in Obsidian Keychain; settings store the credential name. Configure the password again on another device.

Book caches are plain text in the plugin folder, separated by server directory and account. Cached books remain available offline. Failed refreshes retain existing cached data; successfully confirmed remote deletions remove books from the library without changing imported notes.

## Troubleshooting

- **No books found:** Check that the selected folder contains `.an` files; a successful connection alone does not confirm the backup location.
- **Authentication fails:** Check the username, app password and folder permissions; select another Keychain or create one if its password is unavailable.
- **A book fails to update:** Its previous data remains available. Refresh to retry; the parser rejects corrupt or incomplete records.
- **The original note closed or changed:** Switch to appending, or open the target note and reopen the library to capture a new cursor position.

Report problems through [GitHub Issues](https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync/issues).

## Development

Requires Node.js 22+ and targets Obsidian desktop 1.13.0+. Run `npm run check` to execute TypeScript type checking, ESLint (`eslint-plugin-obsidianmd`), unit/integration/layout tests, production bundling (`main.js`), and bundle verification.

## License

[ISC](LICENSE). Bundled [pako](https://github.com/nodeca/pako) code uses MIT and Zlib licenses; see [third-party notices](THIRD-PARTY-NOTICES.txt).
