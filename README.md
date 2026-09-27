# Lineage Family Tree

Data-driven family trees for Obsidian. Put a `lineage` code block in any note and it draws a family tree built entirely from `Mother`, `Father` and `Spouse` frontmatter on your person notes. Nothing is positioned by hand: add a note with a `Mother` property and every open tree that includes her updates itself.

- Children and siblings are derived automatically.
- Spouses are shown as people in the tree, joined by a marriage line. Remarriages get one line per union.
- Pan and zoom inside the note, on desktop and on iOS/Android.
- Export a clean black-on-white PDF or SVG straight into your vault (works on mobile).

The original build brief is in [docs/SPEC.md](docs/SPEC.md).

## Install with BRAT

1. Install **Obsidian42 - BRAT** from Community plugins.
2. Run **BRAT: Add a beta plugin for testing** and enter `gizmo73/obsidian-lineage`.
3. Enable **Lineage Family Tree** in Community plugins.

## Person notes

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

| Property | Value |
|---|---|
| `Mother`, `Father` | One wikilink each. Optional. |
| `Spouse` | A wikilink or a list of them. A marriage declared on one side only still counts. |
| `Born`, `Died` | A whole year. Anything else is treated as unknown and flagged. |

Property names are configurable in settings and are matched ignoring case (`mother`, `Mother`, `MOTHER`). Only frontmatter is read; Dataview inline fields are not.

## The code block

````markdown
```lineage
seed: [[Aelira Thornvale]]
depth: 3
height: 500
```
````

| Option | Default | Meaning |
|---|---|---|
| `seed` | required | The starting person. Resolved like a normal link: by name, path or alias. |
| `depth` | 3 | How many relationship hops to follow from the seed. Parent, child and spouse each count as one hop. `0` shows only the seed. |
| `height` | 500 | Height of the view in pixels. |

If a child is in the tree, both of their parents are drawn even if the second parent is beyond the depth limit, so no child looks like they have one parent.

### Controls

| | Desktop | Mobile |
|---|---|---|
| Pan | Drag | One-finger drag |
| Zoom | Ctrl/Cmd + wheel, or trackpad pinch | Pinch |
| Open a person | Click a name (Ctrl/Cmd-click for a new tab); hover for a preview | Tap a name |

The toolbar in the top-right corner has **Fit**, **Export PDF**, **Export SVG** and **Refresh**. Plain mouse-wheel scrolling still scrolls the note.

### Warnings

Problems in the data never break the view. They are listed in a collapsible line under the tree, each linking to the note concerned:

- links to notes that do not exist (the name is shown greyed out and not followed)
- people listed as their own parent or spouse
- ancestry loops (someone recorded as their own ancestor); one link in the loop is ignored so the tree can still be drawn
- years that are not whole numbers
- partners who cannot share a generation because one descends from the other

Plain text in `Mother`/`Father`/`Spouse` (not a `[[link]]`) is ignored.

## Export

Exports contain only names, years and lines, in black on white, whatever your theme. Files are saved into the vault as `<seed> family tree.pdf` (or `.svg`), next to the note by default or in the export folder set in settings. A number is added if the name is taken.

PDF page size can be **Fit to tree** (one page exactly the size of the tree) or **A4 / A3 landscape** (scaled to fit one page).

## Known limitations

- **The `seed` link is not a real link to Obsidian.** Obsidian does not index links inside code blocks, so the seed does not appear in backlinks or the graph, and it is **not updated when you rename the note**. After a rename, edit the block (it shows "Seed note not found" until you do).
- **PDF text uses the built-in Helvetica font**, which keeps text selectable and the file small but only covers Western European characters. Names in other scripts (for example Cyrillic, Greek, or Chinese) will not print correctly in the PDF. The SVG export is fine.
- Trees over 300 people are drawn, with a note under the view suggesting a lower depth.
- Relationships cannot be edited from the tree, and people cannot be dragged.

## Development

```bash
npm install
npm run dev     # watch build to main.js
npm test        # unit, fuzz and index tests (Node)
npm run build   # typecheck and production build
```

To try it, copy `main.js`, `manifest.json` and `styles.css` into `test-vault/.obsidian/plugins/lineage-family-tree/`, open `test-vault` as a vault, enable the plugin and open **Lineage demo**. The test vault covers three generations, a remarriage with half siblings, an intermarriage, a one-sided marriage, a missing note, an ancestry cycle, mixed-case properties, and notes with no years, birth only and death only.

`scripts/harness/` has headless-Chromium checks used during development: `run.mjs` renders the demo trees to PNG and PDF, and `panzoom.mjs` drives pan, pinch and wheel input.

### Releasing

The version tag must match `manifest.json` exactly, with no `v` prefix.

```bash
npm version patch   # bumps package.json, manifest.json and versions.json, and tags
git push && git push --tags
```

Pushing the tag runs `.github/workflows/release.yml`, which tests, builds and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css` attached. BRAT picks it up from there.
