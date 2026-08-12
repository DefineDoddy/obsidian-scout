import type { MediaRef } from "../types";
import type { Namespace, TraitKey } from "./traits";

/**
 * Why a thing was suggested, in a form something other than a string can use.
 *
 * The row used to hand the card a `string[]`, which the card joined with dots
 * and put through a `white-space: nowrap` line a hundred and twelve pixels
 * wide. So the model did the work of explaining itself and the explanation was
 * then ellipsed into invisibility.
 *
 * Kept structured for three reasons: the card can show the strongest two as
 * chips with an icon apiece, the detail dialog can show all of them as
 * sentences, and — the part that matters most — a reason can carry a *pointer*.
 * "Because you liked Arrival" is worth ten times "Science Fiction", and it is
 * only sayable if the reason remembers which note it meant.
 */

export type ReasonKind =
	| "series"
	| "neighbour"
	| "director"
	| "keyword"
	| "genre"
	| "person"
	| "studio"
	| "collection"
	| "agreement"
	| "seed"
	| "acclaim"
	| "fresh"
	| "wildcard"
	| "explore";

export interface Reason {
	kind: ReasonKind;
	/** Sentence case and ready to render. Never truncated by whoever made it. */
	label: string;
	/**
	 * The same thing in about twenty characters, for a rail card.
	 *
	 * A chip on a card seven-across is roughly a hundred and fifteen pixels of
	 * text — twenty-two characters at ten pixels. Most reasons are already
	 * shorter than that ("Science Fiction", "Denis Villeneuve") and need no
	 * second form; the few that are sentences rather than names supply one
	 * rather than being ellipsed into "A punt — nothing li…".
	 */
	short?: string;
	/** 0–1. Orders the list and decides which chips are drawn emphatically. */
	strength: number;
	/** Set when this is a mark against it — shown in full, never on a card. */
	against?: true;
	ref?: { trait?: TraitKey; path?: string; item?: MediaRef };
}

/**
 * How interesting each sort of reason is, before its strength is considered.
 *
 * The ordering is a claim about what a person actually wants to be told. That
 * something completes a series you are most of the way through, or resembles a
 * specific thing you said yes to, is worth saying. That it is a Drama is worth
 * saying only when there is nothing better, because almost everything is.
 */
export const REASON_PRIORITY: Record<ReasonKind, number> = {
	series: 10,
	neighbour: 9,
	director: 8,
	keyword: 7,
	collection: 6.5,
	genre: 6,
	person: 5,
	studio: 4,
	agreement: 4,
	seed: 3,
	wildcard: 3,
	acclaim: 2,
	fresh: 1,
	explore: 1,
};

/** Which namespace's affinity produces which sort of reason, if any. */
const FROM_NAMESPACE: Partial<Record<Namespace, ReasonKind>> = {
	series: "series",
	director: "director",
	keyword: "keyword",
	genre: "genre",
	person: "person",
	studio: "studio",
	collection: "collection",
};

/**
 * Decade, language and runtime deliberately produce nothing. They earn their
 * place in the score, but "it is from the 2010s" is not a reason anybody wants
 * read back to them.
 */
export function reasonForNamespace(ns: Namespace): ReasonKind | undefined {
	return FROM_NAMESPACE[ns];
}

export function reasonIcon(kind: ReasonKind): string {
	switch (kind) {
		case "series":
			return "clapperboard";
		case "neighbour":
			return "heart";
		case "director":
			return "user";
		case "person":
			return "users";
		case "studio":
			return "building";
		case "collection":
			return "layers";
		case "keyword":
		case "genre":
			return "tag";
		case "agreement":
			return "check-check";
		case "seed":
			return "sparkle";
		case "acclaim":
			return "star";
		case "fresh":
			return "clock";
		case "wildcard":
			return "compass";
		default:
			return "wand-sparkles";
	}
}

/**
 * The reasons worth giving, best first and never two of a sort.
 *
 * The one-per-kind rule is the important line. Three genre chips is not an
 * explanation, it is a tag cloud — and a candidate matching three genres you
 * like has told you one thing about itself, not three.
 */
export function rankReasons(
	reasons: readonly Reason[],
	limit: number,
): Reason[] {
	const sorted = [...reasons].sort(
		(a, b) =>
			REASON_PRIORITY[b.kind] +
			b.strength -
			(REASON_PRIORITY[a.kind] + a.strength),
	);
	const seen = new Set<ReasonKind>();
	const out: Reason[] = [];
	for (const one of sorted) {
		if (out.length >= limit) break;
		if (seen.has(one.kind)) continue;
		seen.add(one.kind);
		out.push(one);
	}
	return out;
}

/** The reasons for it, leaving out anything held against it. */
export function reasonsFor(reasons: readonly Reason[]): Reason[] {
	return reasons.filter((one) => !one.against);
}

/** What a card shows. The dialog always uses the full `label`. */
export function reasonChip(reason: Reason): string {
	return reason.short ?? reason.label;
}
