import type {
	MediaProvider,
	ProviderContext,
	RequestContext,
	Resolvable,
} from "../../core/provider";
import type { SettingDescriptor } from "../../core/settings/types";
import type { FieldSchema, MediaItem, MediaKind } from "../../core/types";

/**
 * Web links.
 *
 * Implements `Resolvable` only — it has no search endpoint at all. That is the
 * point: it proves the capability interfaces are correctly separated, since
 * nothing here has to fake a `search()` method to satisfy the registry.
 */

const FIELDS: FieldSchema = [
	{ name: "site_name", type: "string", description: "Publisher or site name" },
	{ name: "author", type: "string", description: "Article author" },
	{ name: "domain", type: "string", description: "Hostname of the link" },
	{ name: "favicon", type: "string", description: "Site favicon URL" },
];

/** Decodes the handful of entities that actually show up in meta tags. */
function decodeEntities(text: string): string {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		"#39": "'",
	};
	return text
		.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, entity: string) => {
			const key = entity.toLowerCase();
			if (named[key]) return named[key] as string;
			if (key.startsWith("#x")) {
				return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
			}
			if (key.startsWith("#")) {
				return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
			}
			return whole;
		})
		.trim();
}

/**
 * Reads a `<meta>` value by property or name.
 *
 * Attribute order varies between sites, so both orders are tried rather than
 * assuming `property` always precedes `content`.
 */
function meta(html: string, key: string): string | undefined {
	const escaped = key.replace(/[:.]/g, "\\$&");
	const patterns = [
		new RegExp(
			`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
			"i",
		),
		new RegExp(
			`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
			"i",
		),
	];
	for (const pattern of patterns) {
		const match = pattern.exec(html);
		if (match?.[1]) return decodeEntities(match[1]);
	}
	return undefined;
}

function titleTag(html: string): string | undefined {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return match?.[1] ? decodeEntities(match[1]) : undefined;
}

/** Resolves a possibly-relative image URL against the page it came from. */
function absoluteUrl(candidate: string | undefined, base: string): string {
	if (!candidate) return "";
	try {
		return new URL(candidate, base).toString();
	} catch {
		return "";
	}
}

export class WebLinkProvider implements MediaProvider, Resolvable {
	readonly id = "weblink";
	readonly name = "Web link";
	readonly kinds: readonly MediaKind[] = ["link"];
	readonly fields = FIELDS;

	constructor(private readonly ctx: ProviderContext) {}

	isConfigured(): boolean {
		return true;
	}

	settingsSchema(): readonly SettingDescriptor[] {
		return [
			{
				type: "toggle",
				key: "preferOgTitle",
				name: "Prefer Open Graph title",
				desc: "Use og:title when present, falling back to the <title> tag.",
				default: true,
			},
		];
	}

	/** Any http(s) URL, provided no more specific provider claimed it first. */
	canResolve(url: string): boolean {
		return /^https?:\/\/\S+$/i.test(url.trim());
	}

	async resolve(url: string, ctx: RequestContext): Promise<MediaItem> {
		const target = url.trim();
		const html = await this.ctx.http.getText(target, {
			signal: ctx.signal,
			cacheTtlMs: 10 * 60 * 1000,
			headers: { Accept: "text/html,application/xhtml+xml" },
		});

		const preferOg = this.ctx.settings.get("preferOgTitle", true);
		const ogTitle = meta(html, "og:title") ?? meta(html, "twitter:title");
		const docTitle = titleTag(html);
		const title =
			(preferOg ? (ogTitle ?? docTitle) : (docTitle ?? ogTitle)) ??
			new URL(target).hostname;

		const description =
			meta(html, "og:description") ??
			meta(html, "twitter:description") ??
			meta(html, "description");

		const image = absoluteUrl(
			meta(html, "og:image") ?? meta(html, "twitter:image"),
			target,
		);

		const published =
			meta(html, "article:published_time") ?? meta(html, "date");
		const domain = new URL(target).hostname.replace(/^www\./, "");

		const tags = (meta(html, "article:tag") ?? meta(html, "keywords") ?? "")
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean)
			.slice(0, 10);

		const author = meta(html, "article:author") ?? meta(html, "author");

		return {
			ref: { providerId: this.id, kind: "link", id: target },
			title,
			subtitle: domain,
			year: published ? new Date(published).getUTCFullYear() : undefined,
			imageUrl: image || undefined,
			thumbnailUrl: image || undefined,
			description,
			tags,
			people: author ? [author] : [],
			externalUrl: target,
			releaseDate: published ? published.slice(0, 10) : undefined,
			extra: {
				site_name: meta(html, "og:site_name") ?? domain,
				author,
				domain,
				// The site's own icon, not a third-party favicon service — that
				// would leak every link the user saves to an outside host.
				favicon: absoluteUrl("/favicon.ico", target),
			},
		};
	}
}
