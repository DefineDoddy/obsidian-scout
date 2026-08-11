import type { MediaKind } from "../core/types";

/**
 * Built-in templates, used when no template file is configured for a kind.
 *
 * Placeholders sit *outside* quotes now — the engine quotes and escapes YAML
 * scalars itself, which is what stops a title containing a quote from
 * corrupting the frontmatter. Lists render as real YAML sequences so Dataview
 * can query them.
 *
 * Each one writes the properties the library reads: `type` puts the note on a
 * shelf, `status` and `rating` are what the manage panel edits, and
 * `source`/`scout_id` are what let a note be matched back to a search result
 * later. A `Thoughts` heading is left ready for the notes you write yourself.
 */

const MOVIE = `---
title: {{title}}
type: movie
status: To watch
rating:
tmdb_rating: {{rating}}
genres: {{tags}}
{{#if directors}}director: {{directors}}
{{/if}}release_date: {{release_date}}
{{#if runtime}}runtime: {{runtime}}
{{/if}}cover: {{cover}}
source: {{provider}}
scout_id: {{id}}
created: {{now}}
---

## Overview

{{description}}

## Information

**Rating:** {{rating}}/10
**Genres:** {{tags|list}}
{{#if runtime}}**Runtime:** {{runtime}} minutes
{{/if}}**Release date:** {{release_date|date:MMMM DD, YYYY}}
{{#if directors}}**Director:** {{directors|list}}
{{/if}}{{#if cast}}**Cast:** {{cast|take:5|list}}
{{/if}}

## Thoughts



## Resources

- [TMDB page]({{url}})
`;

const TV = `---
title: {{title}}
type: tv
status: To watch
rating:
tmdb_rating: {{rating}}
genres: {{tags}}
first_air_date: {{release_date}}
{{#if number_of_seasons}}seasons: {{number_of_seasons}}
{{/if}}{{#if number_of_episodes}}episodes: {{number_of_episodes}}
{{/if}}cover: {{cover}}
source: {{provider}}
scout_id: {{id}}
created: {{now}}
---

## Overview

{{description}}

## Information

**Rating:** {{rating}}/10
**Genres:** {{tags|list}}
**First air date:** {{release_date|date:MMMM DD, YYYY}}
{{#if number_of_seasons}}**Seasons:** {{number_of_seasons}}
{{/if}}{{#if number_of_episodes}}**Episodes:** {{number_of_episodes}}
{{/if}}{{#if cast}}**Cast:** {{cast|take:5|list}}
{{/if}}

## Thoughts



## Resources

- [TMDB page]({{url}})
`;

const BOOK = `---
title: {{title}}
type: book
status: To read
rating:
source_rating: {{rating}}
author: {{author}}
genres: {{tags}}
published_date: {{release_date}}
{{#if pages}}pages: {{pages}}
{{/if}}{{#if isbn}}isbn: {{isbn}}
{{/if}}cover: {{cover}}
source: {{provider}}
scout_id: {{id}}
created: {{now}}
---

## Summary

{{description}}

## Information

**Author:** {{people|list}}
**Rating:** {{rating}}/10
**Genres:** {{tags|list}}
**Published:** {{release_date|date:YYYY}}
{{#if pages}}**Pages:** {{pages}}
{{/if}}{{#if isbn}}**ISBN:** {{isbn}}
{{/if}}

## Thoughts



## Resources

- [Source page]({{url}})
`;

const LINK = `---
title: {{title}}
type: link
status: To read
url: {{url}}
site: {{site_name}}
{{#if author}}author: {{author}}
{{/if}}{{#if release_date}}published: {{release_date}}
{{/if}}tags: {{tags}}
source: {{provider}}
scout_id: {{id}}
created: {{now}}
---

# {{title}}

{{description}}

[Read on {{site_name}}]({{url}})

## Notes


`;

const GENERIC = `---
title: {{title}}
type: {{kind}}
status:
rating:
source_rating: {{rating}}
genres: {{tags}}
release_date: {{release_date}}
cover: {{cover}}
source: {{provider}}
scout_id: {{id}}
url: {{url}}
created: {{now}}
---

# {{title}}

{{description}}

## Thoughts


`;

const BY_KIND: Partial<Record<MediaKind, string>> = {
	movie: MOVIE,
	tv: TV,
	book: BOOK,
	link: LINK,
};

/** Built-in template for a kind, falling back to a provider-agnostic one. */
export function defaultTemplateFor(kind: MediaKind): string {
	return BY_KIND[kind] ?? GENERIC;
}
