# Scout

Track what you watch and read, in plain Obsidian notes.

Search a title (or paste a link), pick a result, and Scout renders it through your own template into the folder you choose. Everything it then creates lands in the **library** — one place to browse what you own, rate it, set its status, and write down what you thought.

## Sources

| Source | Kinds | Credentials |
| --- | --- | --- |
| TMDB | Movies, TV | Free API read access token |
| Open Library | Books | None |
| AniList | Anime, manga | None |
| Web link | Any URL | None |

## Setup

1. Enable the plugin in **Settings → Community plugins**.
2. Open **Settings → Scout**.
3. Under **Notes**, set an output folder for each kind you want to use.
4. Under **Sources**, paste your TMDB token if you want movies and TV.

Templates are optional — each kind has a built-in one.

## The library

Open it from the ribbon or with **Open library**. It lists every note whose media-type property names a kind — `type: movie`, `type: book`, and so on — so notes you wrote years ago show up alongside the ones Scout creates.

Browse as a grid, a list, or a table. Filter by type, status, genre, rating, or favourites; group by any of them; sort however you like. Right-click an item for its status menu without leaving the page.

Select something to open its details: the metadata on top, and below it the part you own.

- **Rating** — stars, hearts, or a number, out of 5, 10, or 100, in whole or half steps, and a different scale per type if your films are out of ten and your books are out of five
- **Status** — one click, with the start and finish dates stamped for you, each shelf carrying its own colour and icon (and a progress ring, on anything you are part-way through)
- **Progress** — episodes, pages, or chapters, with a bar when the note records a total
- **Thoughts** — a text box wired to a heading in the note, so it stays readable and editable by hand
- **Your own fields** — anything else you want to track, defined in settings

Every control writes ordinary frontmatter. There is no separate database, so Dataview, Bases, sync, and hand edits all keep working, and uninstalling Scout leaves your notes exactly as they are.

### Making it fit your vault

Scout reads what you already have rather than asking you to convert anything. Under **Settings → Scout → Properties** you can point every field at the property name your notes use, and say which values (`film`, `series`, `graphic novel`) mean which kind. It already accepts the obvious alternatives — `poster` for a cover, `overview` for a description, `my_rating` for a rating — so most vaults need no changes at all.

Statuses are yours too: set the shelves each kind can be on, in the order they should appear. Since they are your words, Scout cannot read meaning into them — instead you sort them into four groups (started, finished, set aside, given up on), and that is what decides each one's colour and icon and when a date gets stamped. Anything you leave out counts as not started yet.

Ratings work the same way. Scout never rewrites a number in your notes — changing the scale only changes how the numbers already there are read — so instead of converting your vault you give each type the scale it already uses. Sorting, filtering, and the average then compare proportionally: a book at 4 out of 5 outranks a film at 7 out of 10. However large the scale, the row is always five icons, so a film rated 8 out of 10 fills four of them and nothing overflows a card.

## Commands

- **Open library** — browse and manage everything you have
- **Search all sources** — one modal across every enabled source
- **Search movies / TV shows / books / anime / …** — per-kind, hidden when no source offers that kind
- **Manage this note** — the detail view for the note you are looking at
- **Create note from link in clipboard** — resolves a TMDB, Open Library, AniList, or arbitrary URL
- **Reload plugin** — development helper

## Templates

Placeholders use `{{name}}`. Frontmatter is rendered as **valid YAML** — values are quoted and escaped automatically, so a title containing a quote or colon will not corrupt the file, and lists become real YAML sequences that Dataview can query.

```markdown
---
title: {{title}}
genres: {{tags}}
rating: {{rating}}
release_date: {{release_date}}
---

# {{title}}

{{description}}

{{#if runtime}}**Runtime:** {{runtime}} minutes{{/if}}
```

Common fields: `title`, `subtitle`, `year`, `rating` (always 0–10), `cover`, `description`, `tags`, `people`, `url`, `release_date`, `kind`, `provider`, `id`, `now`. Each source adds its own — the full list is in **Settings → Scout → Templates**.

Filters: `{{tags|list}}`, `{{release_date|date:YYYY}}`, `{{description|truncate:200}}`, `{{people|link}}`, `{{rating|scale:10:5}}`, `{{pages|default:Unknown}}`, `{{cast|take:5}}`.

Blocks: `{{#if x}}…{{else}}…{{/if}}`, `{{#each people}}- {{.}}{{/each}}`.

A template that writes `type`, `status`, `rating`, `source`, and `scout_id` puts the note straight onto the right shelf and lets Scout recognize it in a later search. The built-in templates do all five.

## Adding a source

Providers are self-contained. Implement `MediaProvider` plus whichever capabilities apply — `Searchable`, `Detailable`, `Resolvable`, `Authenticated` — and add one line to the `PROVIDERS` table in `src/main.ts`. No changes to the modal, settings tab, or commands are needed.

Settings pages work the same way: a page is one file in `src/core/settings/sections/` plus one entry in the `SECTIONS` list.

```
src/
  core/
    library/    reading, filtering, and editing the notes you already have
    settings/   the store, and one file per tab of the settings dialog
    ...         provider contracts, registry, HTTP, templating, note writing
  providers/    one directory per source
  ui/           the search modal, the detail dialog, the library view
```

## Development

```bash
pnpm install
```

```bash
pnpm run dev
```

```bash
pnpm test
```

```bash
pnpm run build
```

`dev` and `build` both write `main.js` to the plugin root, so the plugin in this vault picks up changes directly. `build` also mirrors the release artifacts into `dist/`.

Obsidian does not reload a plugin when its `main.js` changes on disk. Install [hot-reload](https://github.com/pjeby/hot-reload) and enable it, then `pnpm run dev` is enough: esbuild rewrites `main.js`, hot-reload notices and re-enables the plugin within a second. It only watches plugin folders containing a `.git` directory or a `.hotreload` file — this repo has both.

## Privacy

Scout only contacts a source when you search or resolve a link — the library is built entirely from notes already in your vault, and never sends anything anywhere. Your TMDB token is stored in this vault's `data.json` in plain text, like all Obsidian plugin settings — treat that file accordingly. No telemetry.

## License

MIT
