export const BOOK_TEMPLATE = `---
title: "{{title}}"
type: book
status: To Read
rating:
author: "{{author}}"
goodreads_rating: {{rating}}
genres: [{{genres}}]
published_date: {{published_date}}
pages: {{pages}}
ratings_count: {{ratings_count}}
isbn: "{{isbn}}"
cover: "{{cover}}"
created: {{now}}
---

## Summary

{{description}}

## Information

**Author:** {{author}}
**Rating:** {{rating}}/5
**Genres:** {{genres}}
**Published:** {{published_date}}
**Pages:** {{pages}}
**Ratings count:** {{ratings_count}}
**ISBN:** {{isbn}}

## Thoughts



## Resources

- [Goodreads Page]({{goodreads_url}})

`;
