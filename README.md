# Lineage Family Tree

Data-driven family trees for Obsidian. Put a `lineage` code block in any note and it draws a family tree built entirely from `Mother`, `Father` and `Spouse` frontmatter on your person notes. Nothing is positioned by hand: add a note with a `Mother` property and every open tree that includes her updates itself.

- Children and siblings are derived automatically.
- Spouses are shown as people in the tree, joined by a solid marriage line. Remarriages get one line per union.
- Parents who share a child but are not listed as each other's `Spouse` are joined by a dashed line instead, the usual convention for an unmarried couple.
- Whoever raised someone (an adoptive, foster or on-paper parent) can be linked with `Raised by` and is drawn with a dotted line, alongside the real parents' solid one. One tree can show both the truth and the story everyone believes.
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
  - "[[Isolde Fenwick]]"
Married:
  - 1407
  - 1418
Born: 1385
Died: 1442
---
```

| Property | Value |
|---|---|
| `Mother`, `Father` | One wikilink each. Optional. |
| `Spouse` | A wikilink or a list of them. A marriage declared on one side only still counts. Co-parents without one are drawn with a dashed line. |
| `Married` | Optional. The year of marriage, shown as "m. 1407" above the marriage line. With several spouses, give a list in the same order as `Spouse`; use `?` for a year you don't know. Either spouse's note can hold it. A missing year just means the date is unknown, not that there was no marriage. |
| `Raised by` | Optional. A wikilink or a list of them: whoever raised this person in place of, or as well as, their `Mother` and `Father`. They are drawn a generation above with a dotted line. Someone with no parents in the tree sits under whoever raised them. |
| `Born`, `Died` | A whole year. Anything else is treated as unknown and flagged. |

Property names are configurable in settings and are matched ignoring case (`mother`, `Mother`, `MOTHER`). Only frontmatter is read; Dataview inline fields are not.

## The code block

````markdown
```lineage
seed: [[Aelira Thornvale]]
ancestors: 2
descendants: 1
height: 500
```
````

| Option | Default | Meaning |
|---|---|---|
| `seed` | required | The starting person. Resolved like a normal link: by name, path or alias. |
| `ancestors` | setting (2) | Generations up from the seed. See below. |
| `descendants` | setting (2) | Generations down from the seed. See below. |
| `depth` | setting (3) | How many relationship hops to follow from the seed, in any direction. Parent, child, spouse and raised-by links each count as one hop. `0` shows only the seed. Used only when the block has neither `ancestors` nor `descendants`. |
| `height` | 500 | Height of the view in pixels. |

There are two ways to say how far a tree reaches:

- **Generations** (`ancestors` and `descendants`). The tree goes up `ancestors` generations through parents, then takes everyone descended from those ancestors, down to `descendants` generations below the seed. So `ancestors: 1` brings in siblings (and their children, if `descendants` allows), `ancestors: 2` adds aunts, uncles and first cousins, and so on. Everyone's spouses are drawn, but their own families are not followed. Whoever raised someone counts as a parent. If a block gives only one of the two, the other comes from settings.
- **Hops** (`depth`). The original option, which spreads out in every direction at once, including through spouses to in-laws. Blocks written with `depth` keep working as before. If a block has `depth` as well as `ancestors` or `descendants`, `depth` is ignored and a warning says so.

If a child is in the tree with one of their parents, their other parent and whoever raised them are drawn too, even beyond the limits, so no child looks like they have one parent or loses the dotted line to whoever raised them.

### Insert family tree command

Run **Lineage Family Tree: Insert family tree** from the command palette while editing a note. Pick the seed from a list of notes, then how many generations up and how many down (your defaults are listed first, or type any whole number), and the block is inserted at the cursor on its own lines, replacing any selection. The note you are editing is at the top of the seed list, so a person's own tree is quick to add.

To keep places, sessions and the like out of the seed list, set **People folder** in settings. The list then shows only notes in that folder and its subfolders. It only affects this command; trees still follow links to people anywhere in the vault.

### Controls

| | Desktop | Mobile |
|---|---|---|
| Pan | Drag | One-finger drag |
| Zoom | Ctrl/Cmd + wheel, or trackpad pinch | Pinch |
| Open a person | Click a name (middle-click or Ctrl/Cmd-click for a new tab); hover for a preview | Tap a name |

The toolbar in the top-right corner has **Fit**, **Export PDF**, **Export SVG** and **Refresh**. Plain mouse-wheel scrolling still scrolls the note.

The top-left corner has **↑** and **↓** controls with − and + buttons for the generations up and down. The tree redraws straight away, and a moment after the last click the new numbers are written into the block's `ancestors:` and `descendants:` lines, so the tree opens the same way next time. Neither can go below 0. On a block that uses `depth:`, the controls show your default generations (dimmed) and the first click switches the block over, replacing its `depth:` line. If the block can't be found where it was (for example it was edited in the meantime, or it sits in a list or an embedded note), nothing is written and a notice says so; the tree keeps the new numbers until the note is reopened.

### Warnings

Problems in the data never break the view. They are listed in a collapsible line under the tree, each linking to the note concerned:

- links to notes that do not exist (the name is shown greyed out and not followed)
- people listed as their own parent, spouse or raiser
- someone listed as both a parent and `Raised by` (the `Raised by` link is ignored)
- ancestry loops (someone recorded as their own ancestor); one link in the loop is ignored so the tree can still be drawn
- years that are not whole numbers
- more `Married` years than spouse links (years are matched in order, so the list is probably out of step)
- spouses whose notes give different marriage years
- partners who cannot share a generation because one descends from the other

Plain text in `Mother`/`Father`/`Spouse`/`Raised by` (not a `[[link]]`) is ignored.

## Marriages in a note

Put the inline code `` `lineage-married` `` in a person note, for example in a table cell, and it shows that person's marriages, one per line:

```markdown
| **Married** | `lineage-married` |
```

> 1407 to [[Mirela Ashgrove]]
> 1418 to [[Isolde Fenwick]]

It uses the same data as the trees: marriages recorded on either spouse's note, with the year from either note (this person's first if both give one), oldest first. An unknown year shows as `?`, and a spouse whose note does not exist is greyed out. Names open and preview like any link, middle-click opens a new tab, and the list updates when a marriage is added or changed.

It works in Reading view, and in Live Preview inside tables. Elsewhere in Live Preview it shows as plain inline code until you switch to Reading view.

## Export

Exports contain only names, years and lines, in black on white, whatever your theme. Files are saved into the vault as `<seed> family tree.pdf` (or `.svg`), next to the note by default or in the export folder set in settings. A number is added if the name is taken.

PDF page size can be **Fit to tree** (one page exactly the size of the tree) or **A4 / A3 landscape** (scaled to fit one page).

## Known limitations

- **The `seed` link is not a real link to Obsidian.** Obsidian does not index links inside code blocks, so the seed does not appear in backlinks or the graph, and it is **not updated when you rename the note**. After a rename, edit the block (it shows "Seed note not found" until you do).
- **PDF text uses the built-in Helvetica font**, which keeps text selectable and the file small but only covers Western European characters. Names in other scripts (for example Cyrillic, Greek, or Chinese) will not print correctly in the PDF. The SVG export is fine.
- Trees over 300 people are drawn, with a note under the view suggesting fewer generations or a lower depth.
- Relationships cannot be edited from the tree, and people cannot be dragged.
- The generation controls can only save into a block that sits directly in the note or inside a callout, not one inside a list or shown through an embed.

## Development

```bash
npm install
npm run dev     # watch build to main.js
npm test        # unit, fuzz and index tests (Node)
npm run build   # typecheck and production build
```

To try it, copy `main.js`, `manifest.json` and `styles.css` into `test-vault/.obsidian/plugins/lineage-family-tree/`, open `test-vault` as a vault, enable the plugin and open **Lineage demo**. The test vault covers three generations, a remarriage with half siblings, an intermarriage, a one-sided marriage, unmarried co-parents, a child raised by someone else alongside a foundling, a missing note, an ancestry cycle, mixed-case properties, and notes with no years, birth only and death only.

`scripts/harness/` has headless-Chromium checks used during development: `run.mjs` renders the demo trees to PNG and PDF, and `panzoom.mjs` drives pan, pinch and wheel input.

### Releasing

The version tag must match `manifest.json` exactly, with no `v` prefix.

```bash
npm version patch   # bumps package.json, manifest.json and versions.json, and tags
git push && git push --tags
```

Pushing the tag runs `.github/workflows/release.yml`, which tests, builds and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css` attached. BRAT picks it up from there.

Creating the release on GitHub's release page instead also works: publishing it creates the tag, the workflow runs, and the built files are attached to that release rather than a new one being made.
