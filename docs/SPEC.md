# Lineage: Data-Driven Family Trees for Obsidian

> Working name. Rename freely before first release; update `manifest.json` `id` and `name` to match.

Lineage renders a family tree inside a note from a `lineage` code block. The tree is built entirely from frontmatter on person notes, so nothing is ever positioned by hand. Add a note with a `Mother` property and the tree updates itself.

This README is the build spec. It is written to be handed to Claude Code as the brief for the initial implementation.

---

## 1. Goals

1. Build the tree from `Mother`, `Father` and `Spouse` frontmatter links. No manual layout.
2. Derive children and siblings automatically.
3. Show spouses as visible nodes in the tree, joined by a marriage line. Nobody is hidden.
4. Render as an interactive, embedded pan and zoom view inside the note.
5. Export a clean PDF (and SVG) containing only names, years and connecting lines.
6. Work fully on Obsidian mobile (iOS and Android).
7. Install via BRAT from a public GitHub repo.

### Out of scope (v1)

- Editing relationships from the tree view.
- Dragging or manually repositioning nodes.
- Dataview inline fields (`key:: value`). Frontmatter only.
- Full dates. Years only.

---

## 2. Usage

### Person note frontmatter

```yaml
---
Mother: "[[Aelira Thornvale]]"
Father: "[[Corvin Thornvale]]"
Spouse:
  - "[[Mirela Ashgrove]]"
Born: 1385
Died: 1442
---
```

| Property | Type | Notes |
|---|---|---|
| `Mother` | single wikilink | Optional. |
| `Father` | single wikilink | Optional. |
| `Spouse` | wikilink or list of wikilinks | Optional. A list supports remarriage. |
| `Born` | integer year | Optional. |
| `Died` | integer year | Optional. |

Property names are configurable in settings (defaults above). Matching must be case-insensitive (`mother`, `Mother` and `MOTHER` all work).

### Code block

````markdown
```lineage
seed: [[Aelira Thornvale]]
depth: 3
height: 500
```
````

| Option | Required | Default | Description |
|---|---|---|---|
| `seed` | yes | none | Wikilink to the starting person note. Must resolve like a normal link (supports links by basename, path, and aliases via Obsidian's link resolver). |
| `depth` | no | setting (3) | Maximum number of relationship hops from the seed. See section 3. |
| `height` | no | setting (500) | Height of the embedded view in pixels. |

The `seed` line should behave like a real link, so Obsidian's link autocomplete, rename tracking and backlinks treat it as one. If code block content cannot participate in link updates, document that limitation and fall back to resolving the link text at render time.

---

## 3. Graph building

### Relationships

Build an in-memory index of every markdown file's `Mother`, `Father` and `Spouse` links using `app.metadataCache` (resolve each link with `metadataCache.getFirstLinkpathDest`). From that index derive:

- **Parents:** the person's own `Mother` and `Father`.
- **Children:** reverse lookup. Any note whose `Mother` or `Father` resolves to this person.
- **Spouses:** the person's own `Spouse` entries **plus** any note whose `Spouse` points at this person. A marriage declared on only one side still counts.
- **Siblings:** never stored. Full siblings share both parents; half siblings share one. They fall out of the layout naturally because they are children of the same union or parent.

The reverse lookup is essential. Following outbound links alone only ever reaches ancestors.

### Traversal and depth

Breadth-first search from the seed. Each of these edges costs **one hop**:

- person to parent
- person to child
- person to spouse

`depth: 0` shows the seed only. `depth: 1` shows parents, children and spouses. Traversal stops at the depth limit or when no unvisited notes remain.

Layout rule: if a person is included, their spouse **within the same union as an included child** must also be included, even if that spouse is beyond the depth limit. Otherwise a child would appear to have one parent. Such spouses are drawn but not traversed further.

### Index maintenance

- Build the index lazily on first render.
- Update incrementally on `metadataCache` `changed`, and on vault `rename` and `delete`.
- Debounce re-renders of open code blocks (around 300 ms) after index changes.

### Data problems (must not crash)

| Case | Behaviour |
|---|---|
| Seed does not resolve | Render an inline error: "Seed note not found: X". |
| Link to a note that does not exist | Show the name in a muted, unlinked style. Do not traverse. |
| Plain text instead of a wikilink | Ignore for traversal. |
| Self reference (own parent or spouse) | Ignore the edge, list it in a warnings panel. |
| Ancestry cycle (someone is their own ancestor) | Break the cycle, render, list it in the warnings panel. |
| `Born` or `Died` not an integer | Treat as unknown, list it in the warnings panel. |
| Very large tree (over 300 nodes) | Render, but show a notice suggesting a lower depth. |

The warnings panel is a small collapsible line under the view, hidden when there are no warnings. Each warning links to the offending note.

---

## 4. Layout

Generational (layered) layout, top to bottom, oldest generation at the top.

1. **Generations:** assign each person a generation number. Parent = child minus 1. Spouses share a generation. Resolve conflicts (for example an inconsistent generation gap from intermarriage) by taking the value that keeps parent above child and logging a warning if it cannot.
2. **Unions:** model each couple as a union node between the two partners. Children hang from the union, not from either parent. A single known parent means the children hang from that parent directly.
3. **Remarriage:** a person with several spouses sits between or beside them, with a separate marriage line and child connector for each union.
4. **Ordering:** siblings sorted by `Born` ascending, unknown years last, then alphabetically. Reduce edge crossings with a barycentre pass per layer.
5. **Connectors:** orthogonal lines. A horizontal marriage line joins spouses. A vertical drop from the marriage line to a horizontal sibling bar, then vertical drops to each child.

A person appears **exactly once**, even when reachable through several paths (intermarriage). Accept long connectors rather than duplicate nodes.

Implementation choice is open. Preferred: a custom layered layout (small bundle). Acceptable fallback: `elkjs` layered algorithm with unions as dummy nodes, if the custom approach proves unreliable. Keep the final `main.js` as small as reasonably possible for mobile.

---

## 5. Rendering (embedded view)

Render as **SVG** inside the code block container. SVG keeps text crisp at any zoom and makes export straightforward.

### Person node

```
Aelira Thornvale
  1385 – 1442
```

- Line 1: the note's name as an internal link. Tap or click opens the note; desktop hover shows the standard page preview (`hover-link` event).
- Line 2: years.
  - Both known: `1385 – 1442`
  - Born only: `b. 1385`
  - Died only: `d. 1442`
  - Neither: omit the line.
- Display the note's basename, not a link alias.
- The seed person gets a subtle accent highlight.

### Styling

- Minimal and text-led, in the spirit of the Fancy a Story family tree snippet: names and lines, no boxes by default.
- Use Obsidian CSS variables (`--text-normal`, `--text-muted`, `--background-modifier-border`, `--interactive-accent`, `--font-text`) so it matches any theme, light or dark.
- All styles in `styles.css`, prefixed `.lineage-`.

### Interaction

| Action | Desktop | Mobile |
|---|---|---|
| Pan | Drag | One finger drag |
| Zoom | Ctrl/Cmd + wheel, or trackpad pinch | Pinch |
| Fit to view | Toolbar button | Toolbar button |

- Fit to view on first render.
- Plain wheel scrolling must still scroll the note, not zoom the tree.
- On mobile, a one-finger drag inside the view pans the tree; the note must remain scrollable outside the view.

### Toolbar

Small icon toolbar in the top-right corner of the view: **Fit**, **Export PDF**, **Export SVG**, **Refresh**. Use Obsidian's `setIcon` for icons.

---

## 6. Export

Both exports contain **only** names, years and connecting lines:

- Black text and lines on white, regardless of theme.
- No toolbar, highlight, warnings panel, link styling or muted colours.
- Missing-note names printed normally.

### PDF

- Generate in-plugin with `jspdf` plus `svg2pdf.js`. Do **not** rely on Electron printing, which is unavailable on mobile.
- Page size setting: **Fit to tree** (default, single custom-sized page) or **A4 / A3 landscape** (scale to fit a single page).
- Embed a standard font so text stays selectable.

### SVG

- Standalone file with styles inlined.

### Saving

- Write the file into the vault with `app.vault.createBinary` (PDF) or `app.vault.create` (SVG). Browser downloads do not work on mobile.
- Location: configurable export folder (default: same folder as the current note).
- Filename: `<seed name> family tree.pdf`, adding ` 2`, ` 3` and so on if it exists.
- Show a `Notice` with the saved path when done.

---

## 7. Settings tab

| Setting | Default |
|---|---|
| Mother property name | `Mother` |
| Father property name | `Father` |
| Spouse property name | `Spouse` |
| Born property name | `Born` |
| Died property name | `Died` |
| Default depth | `3` |
| Default view height (px) | `500` |
| Export folder | (blank = alongside the note) |
| PDF page size | Fit to tree |

---

## 8. Technical requirements

- TypeScript, built from the official `obsidian-sample-plugin` template with esbuild.
- `manifest.json`: `"isDesktopOnly": false`.
- **No Node or Electron APIs** anywhere (`fs`, `path`, `electron`, `require` of built-ins). Use only the Obsidian API and browser APIs.
- Register the processor with `registerMarkdownCodeBlockProcessor("lineage", ...)`. Use a `MarkdownRenderChild` so listeners and pointer handlers are cleaned up when the block unloads.
- Must work in Reading view and Live Preview.
- Target minimum Obsidian version: the one that introduced `frontmatterLinks` in `CachedMetadata` (1.4.0 or later). Set `minAppVersion` accordingly.

### BRAT release

- GitHub Action that, on pushing a version tag, builds and attaches `main.js`, `manifest.json` and `styles.css` to a GitHub release.
- `versions.json` maintained per the sample plugin convention.
- Tag must exactly match `manifest.json` `version` (no `v` prefix).

---

## 9. Test vault

Include a `test-vault/` folder with person notes covering:

1. Three generations of a simple family.
2. A remarriage with children from both unions (half siblings).
3. Intermarriage between two branches (one person reachable by two paths).
4. A spouse declared on one side only.
5. A link to a missing note.
6. A deliberate ancestry cycle.
7. Mixed-case property names.
8. Notes with no years, born only, and died only.
9. A note demonstrating code blocks at depths 0, 1, 3 and 10.

---

## 10. Acceptance criteria

1. Adding `Mother: "[[X]]"` to a note updates any open tree containing X within about a second, without reloading.
2. Children and siblings appear with no properties beyond `Mother` and `Father`.
3. Spouses are visible nodes joined by a marriage line; children hang from the correct union.
4. No person appears twice in one tree.
5. Bad data produces warnings, never a blank or crashed view.
6. Pan, pinch-zoom and fit work on iOS and Android.
7. PDF export works on desktop and mobile and contains only names, years and lines.
8. Installs and updates cleanly via BRAT.

---

## 11. Suggested build order

1. Scaffold from the sample plugin, register the code block, parse `seed`, `depth`, `height`.
2. Relationship index with reverse lookups, plus traversal. Verify with a plain text list output first.
3. Generational layout with unions.
4. SVG rendering with links and years.
5. Pan, zoom and fit, tested on mobile early.
6. Live updates from `metadataCache`.
7. SVG and PDF export.
8. Settings tab, warnings panel, release workflow.
