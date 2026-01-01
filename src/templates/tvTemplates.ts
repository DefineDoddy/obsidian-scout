export const MOVIE_TEMPLATE = `---
type: movie
title: "{{title}}"
rating: {{rating}}
genres: "{{genres}}"
runtime: {{runtime}}
poster: "{{poster}}"
release_date: "{{release_date}}"
created: {{now}}
---

# {{title}}

**Rating:** ⭐ {{rating}}/10
**Genres:** {{genres}}
**Runtime:** {{runtime}} minutes
**Release Date:** {{release_date}}
**Type:** {{type}}

![Poster]({{poster}})

## Overview
{{overview}}

## My Notes
- Watched:
- Rating:
- Thoughts:

## Links
- [TMDB Page](https://www.themoviedb.org/{{type}}/{{id}})

`;

export const TV_TEMPLATE = `---
type: tv
title: "{{title}}"
rating: "{{rating}}"
genres: "{{genres}}"
poster: "{{poster}}"
release_date: "{{release_date}}"
created: "{{now}}"
---

# {{title}}

**Rating:** ⭐ {{rating}}/10
**Genres:** {{genres}}
**Release Date:** {{release_date}}
**Type:** {{type}}

![Poster]({{poster}})

## Overview
{{overview}}

## Seasons & Episodes
- Seasons:
- Episodes:

## My Notes
- Watching:
- Rating:
- Thoughts:

## Links
- [TMDB Page](https://www.themoviedb.org/{{type}}/{{id}})

`;
