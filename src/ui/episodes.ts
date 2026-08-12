import type { ScoutContext } from "../core/context";
import { isEpisodicKind } from "../core/library/episodes";
import { isEpisodic } from "../core/provider";
import type { MediaKind, MediaRef } from "../core/types";

/**
 * Whether this item has an episode guide behind it.
 *
 * Its own module rather than a function in the component that draws the guide,
 * because the manage panel needs the same answer — a show whose episodes can be
 * ticked off one by one has no business also offering a number to type — and
 * the guide's module reaches the dialog, which reaches the panel.
 *
 * The provider answering for episodes is not enough on its own: TMDB serves
 * films and shows through the same class, which is why every film in the
 * library grew a "Seasons & episodes" heading it could do nothing with. Both
 * the kind and the provider have to agree.
 */
export function hasEpisodes(
	ctx: ScoutContext,
	source: MediaRef | undefined,
	kind: MediaKind,
): boolean {
	if (!source || !isEpisodicKind(kind)) return false;
	const provider = ctx.registry.get(source.providerId);
	return provider !== undefined && isEpisodic(provider);
}
