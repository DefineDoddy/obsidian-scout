export const MOVIE_TEMPLATE = `---
title: "{{title}}"
type: movie
status: To Watch
rating:
genres: [{{genres}}]
release_date: "{{release_date}}"
runtime: {{runtime}}
tmdb_rating: {{rating}}
poster: "{{poster}}"
created: {{now}}
---

## Overview

{{overview}}

## Information

**Rating:** {{rating}}/10
**Genres:** {{genres}}
**Runtime:** {{runtime}} minutes
**Release Date:** {{release_date}}

## Thoughts



## Resources

- [TMDB Page](https://www.themoviedb.org/{{type}}/{{id}})

`;

export const TV_TEMPLATE = `---
title: "{{title}}"
type: tv
status: To Watch
rating:
tmdb_rating: {{rating}}
genres: [{{genres}}]
first_air_date: "{{release_date}}"
runtime: {{runtime}}
seasons: {{number_of_seasons}}
episodes: {{number_of_episodes}}
poster: "{{poster}}"
created: {{now}}
---

## Overview

{{overview}}

## Information

**Rating:** {{rating}}/10
**Genres:** {{genres}}
**Runtime:** {{runtime}} minutes
**First Air Date:** {{release_date}}
**Seasons:** {{number_of_seasons}}
**Episodes:** {{number_of_episodes}}

## Thoughts


## Resources

- [TMDB Page](https://www.themoviedb.org/{{type}}/{{id}})

`;
