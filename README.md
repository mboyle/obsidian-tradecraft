# Dossier

Dossier turns Obsidian backlinks into readable context. Open a note and Dossier renders the passages that link to it beneath the authored document in Reading View and Live Preview. Vault Markdown is never modified.

## Features

- Every resolved wiki link and internal Markdown link is treated as an occurrence, not merely a source file.
- Compact, Normal, and Expanded context profiles follow Markdown block structure.
- Source grouping, nearest-heading provenance, chronological sorting, aliases, duplicate suppression, and inline expansion.
- Exact source navigation with native modifier-click and Page Preview behavior.
- Incremental reverse indexing, lazy cached reads, and first-page Markdown rendering for large backlink sets.
- Live updates after edits, creates, deletes, and renames.
- Human-readable Daily Note dates in File Explorer, passive inline titles, tabs, and linked-reference labels without renaming files.
- A mobile-first weekly Daily Note navigator above Reading View, Live Preview, and Source Mode, with per-pane state and optional sticky behavior.
- A desktop Daily Timeline with bidirectional virtual scrolling, rendered Markdown, and one conflict-aware inline editor at a time.
- Desktop and mobile support with no network calls, telemetry, Node APIs, or third-party plugin dependencies.

## Development

Requirements: Node.js 20 or newer and npm.

```sh
npm install
npm run dev       # watch and emit main.js
npm run check     # lint, unit tests, and production build
npm run bench     # synthetic 1k/10k/50k-note benchmarks
```

For local Obsidian development, place or symlink this repository at:

```text
<Vault>/.obsidian/plugins/dossier
```

Run `npm run dev`, reload Obsidian, and enable **Dossier** under **Settings → Community plugins**. A production installation needs `main.js`, `manifest.json`, and `styles.css` in the plugin directory.

## Settings and note overrides

The settings tab controls display, context profiles, sorting, filename date formats, the frontmatter date property, initial reference limit, embeds, navigation, and excluded source/target folder prefixes.

The **Daily note display** section formats date-only filenames for presentation. By default, a note such as `Daily/2026-08-20.md` appears as **August 20, 2026** in File Explorer, tabs, and Dossier source labels, while its passive inline title uses **Thu, August 20th, 2026**. The underlying path and every Markdown link remain `Daily/2026-08-20.md`. Folder matching is case-sensitive and includes descendants; leave the folder blank or enter `/` to match the whole vault. While renaming a file or editing an inline title, Dossier restores the real basename before Obsidian handles the edit.

The **Weekly Daily Note navigator** uses the same strict filename/date model but remains independent of readable labels. Each Markdown pane keeps its own selected date and browsed week. Swipe or use Left/Right Arrow to browse; press Home to return to the selected note's week, or select the month heading to open today's Daily Note. Tapping an existing date opens its canonical file in the same pane. Missing dates can use Daily Notes, create an empty canonical note, or do nothing. Existing-note dots use direct path lookups only.

On desktop, run **Dossier: Open Daily Timeline** to open the continuous Daily Note view. It begins around the active Daily Note (or today), loads older and newer dates in seven-day batches, and retains only the configured three-to-nine-week window. Select a date heading or its body to edit that note inline; Dossier saves after a short delay and returns it to rendered Markdown on blur or Escape. The file icon opens the same date in a normal Obsidian tab for full Live Preview behavior. Missing dates follow the weekly navigator's creation setting and use the same canonical path/template bridge.

To explicitly hide or show Dossier on a note, add:

```yaml
---
contextual-backlinks: false
---
```

An explicit frontmatter value takes precedence over the global setting and command-created note override. Target folder exclusions always suppress rendering. Embeds and unlinked textual mentions are excluded by default; unlinked mentions are not supported in v1.

## Architecture

Dossier builds a cheap reverse relationship index from the documented `MetadataCache.resolvedLinks` map after layout initialization. It finds exact positions from `CachedMetadata.links`, resolves them through Obsidian, and reads only source notes needed for the visible result page. Extracted contexts are cached by source path, modification time, target path, and profile.

Daily Note display uses a separate path-and-basename cache and never reads note contents. File Explorer and inline-title updates are confined to their loaded view containers, batched per animation frame, and fully restored when disabled. Deferred views are never forced to load.

Reading View uses a terminal Markdown postprocessor. Live Preview uses a CodeMirror block widget at the final document offset. Excerpts are rendered by `MarkdownRenderer`, so native Markdown features and internal links continue to work.

The desktop Daily Timeline is a lifecycle-owned custom workspace view. Inactive dates use `MarkdownRenderer`; only the focused date owns a CodeMirror editor. The feed uses direct date-to-path lookups, adds dates in seven-day batches, and discards distant rendered sections so long sessions do not accumulate editors, DOM, or file reads. Inline saves use `Vault.process()` and refuse to overwrite a note that changed externally.

### Compatibility notes

Obsidian has documented APIs for opening a file and revealing an editor range, but no documented method for revealing an arbitrary source offset while a Markdown leaf remains in Reading View. Dossier first uses public leaf/editor APIs. When necessary, `ReferenceNavigator` applies one isolated view-state transition (`mode: "source"`) to open Live Preview before selecting and scrolling to the backlink. If it stops working in a future Obsidian release, source opening still succeeds and precise reveal degrades gracefully.

Obsidian also does not expose a public setter for a leaf's tab caption. The Daily Note tab adapter therefore uses one isolated, version-guarded lookup of the leaf's tab-header element and restores the native display text when disabled or unloaded. If that internal element changes, File Explorer, inline-title, backlink formatting, and all core tab behavior continue to work.

Obsidian's public API does not expose Daily Notes template creation. When the navigator is configured to use Daily Notes, Dossier uses one isolated, guarded lookup of the enabled core plugin only when its folder and filename format exactly match Dossier's canonical settings. If the bridge is unavailable or the settings differ, Dossier safely creates an empty canonical note instead. A core-plugin creation failure or path conflict shows a Notice and does not navigate.

## Manual acceptance matrix

Before release, verify the following in a development vault:

- Reading View and Live Preview place Dossier after authored content; Source mode remains unchanged.
- Empty notes, notes without backlinks, and `contextual-backlinks: false` do not add noise.
- Wiki links, aliases, heading/block links, relative Markdown links, lists, tasks, quotes, callouts, and tables retain useful context.
- YAML, code fences, comments, excluded source folders, and embeds with the default setting do not appear.
- Multiple references in one paragraph render one passage with every target link highlighted; separate passages stay separate.
- Source header, excerpt, highlighted-link, Cmd/Ctrl-click, and Page Preview interactions work.
- Editing and deleting a link updates a simultaneously visible target after the debounce.
- Source and target renames continue to resolve and preserve saved per-note state.
- Two panes, including two panes for the same target, update independently.
- Light/dark themes, narrow mobile layout, and touch targets remain readable.
- Daily Note labels update in File Explorer, passive inline titles, tabs, and linked references on desktop and iOS; active rename fields always show the real basename.
- Invalid dates, nonmatching folders, disabled surfaces, and plugin unload all retain or restore native filenames.
- The weekly navigator appears in Reading View, Live Preview, and Source Mode, remains mounted while switching modes, and keeps independent weeks in split panes.
- Sticky and scroll-away layouts align with note gutters at narrow and wide widths on desktop and iOS; vertical scrolling, iOS edge gestures, and the software keyboard remain usable.
- Today, selection, and existing-note markers remain visually distinct in light/dark themes; reduced motion and the animation setting disable transitions.
- Missing Daily Notes preserve templates when core settings match, safely fall back to blank notes when they do not, and never navigate for the “do nothing” option.
- The desktop Daily Timeline scrolls indefinitely in both directions without growing past its configured window; today/file actions, inline editing, Escape/blur saving, external modifications, and opening a date in a normal Markdown tab work as expected.
- A target with hundreds of references renders the initial page first and expands inline without changing its Markdown file.

## Privacy

Dossier is deterministic and local. It makes no network requests, collects no telemetry, and sends no vault content anywhere.

## License

[MIT](LICENSE)
