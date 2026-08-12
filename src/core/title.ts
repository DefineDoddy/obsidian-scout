/**
 * One comparison form for titles, used everywhere two of them are asked
 * whether they are the same thing.
 *
 * Lived inside `indexer.ts` as a private helper, which was fine while matching
 * a search result to a note was the only place it was needed. It is now also
 * how two catalogues answering with the same film are recognised as one
 * suggestion, and two normalisers that disagree would mean the row could
 * collapse a pair the library then treats as separate — or the reverse.
 *
 * Strips case, accents and every kind of punctuation, so `WALL·E`, `Wall-E`
 * and `wall e` are one title, and `Amélie` finds `Amelie`.
 */
export function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{Mark}+/gu, "")
		.replace(/[^\p{Letter}\p{Number}]+/gu, " ")
		.trim();
}
