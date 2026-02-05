export interface GoodreadsAutocompleteItem {
	id?: number | string;
	bookId?: number | string;
	bookUrl?: string;
	title?: string;
	author?: { name?: string } | string;
	imageUrl?: string;
	smallImageUrl?: string;
	avgRating?: number | string;
	ratingsCount?: number | string;
	publicationYear?: number | string;
	publicationDate?: string;
}

export interface BookSearchResult {
	id: number;
	title: string;
	author: string;
	bookUrl: string;
	imageUrl?: string;
	rating?: number;
	ratingsCount?: number;
	publishedYear?: number;
	publishedDate?: string;
}

export interface BookDetails extends BookSearchResult {
	description?: string;
	pages?: number;
	isbn?: string;
	cover?: string;
	genres?: string[];
}

export interface BookTemplateData {
	title: string;
	author: string;
	rating?: number;
	genres?: string;
	ratings_count?: number;
	description?: string;
	pages?: number;
	published_date?: string;
	isbn?: string;
	cover: string;
	goodreads_url: string;
	id: number;
	now: string;
}

const DEFAULT_COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect fill="#e6e6e6" width="100%" height="100%"/><g fill="#9b9b9b" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" font-weight="600"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="36">No Cover</text></g></svg>`;
const DEFAULT_COVER = `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_COVER_SVG)}`;

export function toNumber(value?: number | string): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const n = typeof value === "number" ? value : parseFloat(value);
	return Number.isNaN(n) ? undefined : n;
}

export function toInt(value?: number | string): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const n = typeof value === "number" ? value : parseInt(String(value), 10);
	return Number.isNaN(n) ? undefined : n;
}

export function getCoverUrl(url?: string | null): string {
	return url ? url : DEFAULT_COVER;
}

function normalizeGoodreadsUrl(url?: string): string | undefined {
	if (!url) return undefined;
	const trimmed = url.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return trimmed;
	}
	if (trimmed.startsWith("/")) {
		return `https://www.goodreads.com${trimmed}`;
	}
	return `https://www.goodreads.com/${trimmed}`;
}

export function normalizeAuthor(
	author?: GoodreadsAutocompleteItem["author"],
): string {
	if (!author) return "Unknown";
	if (typeof author === "string") return author;
	return author.name || "Unknown";
}

export function mapAutocompleteItem(
	item: GoodreadsAutocompleteItem,
): BookSearchResult | null {
	const rawId = item.bookId ?? item.id;
	const id = toInt(rawId);
	const title = item.title?.trim() || "Untitled";
	const bookUrl = normalizeGoodreadsUrl(item.bookUrl);
	if (!id || !bookUrl) return null;

	const anyItem = item as Record<string, unknown>;
	const rawPublishedYear = (item.publicationYear ??
		anyItem.publishedYear ??
		anyItem.publication_year ??
		anyItem.year) as number | string | undefined;
	const rawPublishedDate = (item.publicationDate ??
		anyItem.publishedDate ??
		anyItem.publication_date ??
		anyItem.published_date) as string | undefined;

	return {
		id,
		title,
		author: normalizeAuthor(item.author),
		bookUrl,
		imageUrl: item.imageUrl || item.smallImageUrl,
		rating: toNumber(item.avgRating),
		ratingsCount: toInt(item.ratingsCount),
		publishedYear: toInt(rawPublishedYear),
		publishedDate: rawPublishedDate,
	};
}

function extractJsonLd(html: string): any[] {
	const scripts: any[] = [];
	const regex =
		/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(html)) !== null) {
		try {
			const json = JSON.parse(match[1].trim());
			if (Array.isArray(json)) {
				scripts.push(...json);
			} else {
				scripts.push(json);
			}
		} catch (err) {
			// ignore invalid JSON
		}
	}
	return scripts;
}

function getJsonLdBook(scripts: any[]): any | undefined {
	return scripts.find(
		(s) => s && (s["@type"] === "Book" || s["@type"] === "book"),
	);
}

function safeText(value: any): string | undefined {
	if (typeof value === "string") return value;
	if (
		value &&
		typeof value === "object" &&
		typeof value["@value"] === "string"
	) {
		return value["@value"];
	}
	return undefined;
}

function parsePublishedYear(date?: string): number | undefined {
	if (!date) return undefined;
	const year = parseInt(date.slice(0, 4), 10);
	return Number.isNaN(year) ? undefined : year;
}

function formatDateLong(value: number | Date | string): string | undefined {
	let date: Date;
	if (value instanceof Date) {
		date = value;
	} else if (typeof value === "number") {
		date = new Date(value);
	} else if (typeof value === "string") {
		// Handle ISO date strings and other formats
		date = new Date(value);
	} else {
		return undefined;
	}
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function parsePublishedYearFromHtml(html: string): number | undefined {
	const publicationInfoRegex =
		/data-testid=["']publicationInfo["'][^>]*>[^<]*First published[^0-9]*([0-9]{4})/i;
	const publicationTextRegex = /First published[^0-9]*([0-9]{4})/i;
	const publicationTimeRegex = /"publicationTime"\s*:\s*(\d{10,13})/;

	let match =
		publicationInfoRegex.exec(html) || publicationTextRegex.exec(html);
	if (match?.[1]) {
		const year = parseInt(match[1], 10);
		return Number.isNaN(year) ? undefined : year;
	}

	match = publicationTimeRegex.exec(html);
	if (match?.[1]) {
		const raw = match[1];
		const value = parseInt(raw, 10);
		if (!Number.isNaN(value)) {
			const ms = raw.length === 10 ? value * 1000 : value;
			const year = new Date(ms).getUTCFullYear();
			return Number.isNaN(year) ? undefined : year;
		}
	}

	return undefined;
}

function parsePublishedDateFromHtml(html: string): string | undefined {
	const firstPublishedRegex =
		/First published[^A-Za-z0-9]*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{4})/i;
	const publicationInfoRegex =
		/data-testid=["']publicationInfo["'][^>]*>[^<]*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{4})/i;

	const match =
		publicationInfoRegex.exec(html) || firstPublishedRegex.exec(html);
	return match?.[1];
}

function parseDescriptionFromHtml(html: string): string | undefined {
	// Look for the description in the DetailsLayoutRightParagraph__widthConstrained div
	const descRegex =
		/<div[^>]*class="[^"]*DetailsLayoutRightParagraph__widthConstrained[^"]*"[^>]*>\s*<span[^>]*class="[^"]*Formatted[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/i;
	const match = descRegex.exec(html);
	if (!match?.[1]) return undefined;

	// Convert HTML to plain text with proper formatting
	let text = match[1]
		// Replace <br> tags with newlines
		.replace(/<br\s*\/?>/gi, "\n")
		// Remove bold/italic tags but keep content
		.replace(/<\/?b>/gi, "**")
		.replace(/<\/?i>/gi, "*")
		// Remove any other HTML tags
		.replace(/<[^>]+>/g, "")
		// Decode HTML entities
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		// Clean up excessive whitespace
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return text || undefined;
}

function parseGenresFromHtml(html: string): string[] {
	// Look for genre links in the BookPageMetadataSection
	const genres: string[] = [];
	const excludeWords = [
		"genres",
		"genre",
		"top",
		"all",
		"more",
		"less",
		"show",
	];

	// Match genre links like <a class="Button..." href="/genres/science-fiction"><span class="Button__labelItem">Science Fiction</span></a>
	const genreRegex =
		/<a[^>]*href="\/genres\/[^"]+"[^>]*>\s*<span[^>]*class="[^"]*Button__labelItem[^"]*"[^>]*>([^<]+)<\/span>/gi;
	let match;
	while ((match = genreRegex.exec(html)) !== null) {
		const genre = match[1].trim();
		if (
			genre &&
			!genres.includes(genre) &&
			!excludeWords.includes(genre.toLowerCase())
		) {
			genres.push(genre);
		}
	}

	// Fallback: try data-testid="genresList" section
	if (genres.length === 0) {
		const genresListRegex =
			/data-testid=["']genresList["'][^>]*>[\s\S]*?<\/div>/gi;
		const genresListMatch = genresListRegex.exec(html);
		if (genresListMatch) {
			const innerGenreRegex = />([A-Z][a-zA-Z\s]+)</g;
			let innerMatch;
			while (
				(innerMatch = innerGenreRegex.exec(genresListMatch[0])) !== null
			) {
				const genre = innerMatch[1].trim();
				if (
					genre &&
					genre.length > 2 &&
					!genres.includes(genre) &&
					!excludeWords.includes(genre.toLowerCase())
				) {
					genres.push(genre);
				}
			}
		}
	}

	return genres;
}

function extractNextData(html: string): any | undefined {
	const regex =
		/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
	const match = regex.exec(html);
	if (!match?.[1]) return undefined;
	try {
		return JSON.parse(match[1]);
	} catch {
		return undefined;
	}
}

function findNumberByKey(obj: any, key: string): number | undefined {
	if (!obj || typeof obj !== "object") return undefined;
	if (Object.prototype.hasOwnProperty.call(obj, key)) {
		const value = obj[key];
		if (typeof value === "number") return value;
	}
	if (Array.isArray(obj)) {
		for (const item of obj) {
			const found = findNumberByKey(item, key);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	for (const k of Object.keys(obj)) {
		const found = findNumberByKey(obj[k], key);
		if (found !== undefined) return found;
	}
	return undefined;
}

function findStringByKey(obj: any, key: string): string | undefined {
	if (!obj || typeof obj !== "object") return undefined;
	if (Object.prototype.hasOwnProperty.call(obj, key)) {
		const value = obj[key];
		if (typeof value === "string") return value;
	}
	if (Array.isArray(obj)) {
		for (const item of obj) {
			const found = findStringByKey(item, key);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	for (const k of Object.keys(obj)) {
		const found = findStringByKey(obj[k], key);
		if (found !== undefined) return found;
	}
	return undefined;
}

function parseBookDetailsFromNextData(html: string): {
	publishedDate?: string;
	publishedYear?: number;
	pages?: number;
	isbn?: string;
	description?: string;
	cover?: string;
} {
	const nextData = extractNextData(html);
	if (!nextData) return {};
	const publicationTime = findNumberByKey(nextData, "publicationTime");
	const numPages = findNumberByKey(nextData, "numPages");
	const isbn13 = findStringByKey(nextData, "isbn13");
	const isbn = findStringByKey(nextData, "isbn");
	const description = findStringByKey(nextData, "description");
	const imageUrl = findStringByKey(nextData, "imageUrl");

	let publishedDate: string | undefined;
	let publishedYear: number | undefined;
	if (publicationTime) {
		const ms =
			publicationTime.toString().length === 10
				? publicationTime * 1000
				: publicationTime;
		publishedDate = formatDateLong(ms);
		const date = new Date(ms);
		if (!Number.isNaN(date.getTime())) {
			publishedYear = date.getUTCFullYear();
		}
	}

	return {
		publishedDate,
		publishedYear,
		pages: numPages,
		isbn: isbn13 || isbn,
		description,
		cover: imageUrl,
	};
}

function parsePublicationFromNextData(html: string): {
	publishedDate?: string;
	publishedYear?: number;
} {
	const nextData = extractNextData(html);
	if (!nextData) return {};
	const publicationTime = findNumberByKey(nextData, "publicationTime");
	if (!publicationTime) return {};
	const ms =
		publicationTime.toString().length === 10
			? publicationTime * 1000
			: publicationTime;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return {};
	return {
		publishedDate: formatDateLong(date) || date.toISOString().split("T")[0],
		publishedYear: date.getUTCFullYear(),
	};
}

import { requestUrl } from "obsidian";

export async function fetchGoodreadsBookDetails(
	bookUrl: string,
	fallback: BookSearchResult,
): Promise<BookDetails> {
	try {
		const normalizedUrl = normalizeGoodreadsUrl(bookUrl) || bookUrl;
		const response = await requestUrl({
			url: normalizedUrl,
			method: "GET",
		});
		const html = response.text;
		const scripts = extractJsonLd(html);
		const book = getJsonLdBook(scripts);
		const nextDataDetails = parseBookDetailsFromNextData(html);

		const author = Array.isArray(book?.author)
			? book.author
					.map((a: any) => a?.name)
					.filter(Boolean)
					.join(", ")
			: book?.author?.name || fallback.author;

		// Prioritize HTML description from the actual page content
		const htmlDescription = parseDescriptionFromHtml(html);
		const description =
			htmlDescription ||
			safeText(book?.description) ||
			nextDataDetails.description;
		const pages = toInt(book?.numberOfPages) || nextDataDetails.pages;
		const nextDataPublication = parsePublicationFromNextData(html);
		const htmlPublishedDate = parsePublishedDateFromHtml(html);
		// Prioritize Next.js publicationTime (has full date), then format JSON-LD date
		const jsonLdDate = safeText(book?.datePublished);
		const formattedJsonLdDate = jsonLdDate
			? formatDateLong(jsonLdDate)
			: undefined;
		const publishedDate =
			nextDataPublication.publishedDate ||
			nextDataDetails.publishedDate ||
			formattedJsonLdDate ||
			htmlPublishedDate ||
			fallback.publishedDate;
		const publishedYear =
			parsePublishedYear(publishedDate) ??
			parsePublishedYearFromHtml(html) ??
			nextDataPublication.publishedYear ??
			nextDataDetails.publishedYear ??
			fallback.publishedYear;
		const isbn = safeText(book?.isbn) || nextDataDetails.isbn;
		const cover =
			safeText(book?.image) || nextDataDetails.cover || fallback.imageUrl;

		const rating =
			toNumber(book?.aggregateRating?.ratingValue) ?? fallback.rating;
		const ratingsCount =
			toInt(book?.aggregateRating?.ratingCount) ?? fallback.ratingsCount;
		const genres = parseGenresFromHtml(html);

		return {
			...fallback,
			bookUrl:
				normalizeGoodreadsUrl(fallback.bookUrl) || fallback.bookUrl,
			author,
			description,
			pages,
			publishedDate,
			publishedYear,
			isbn,
			cover,
			rating,
			ratingsCount,
			genres,
		};
	} catch (err) {
		return {
			...fallback,
			bookUrl:
				normalizeGoodreadsUrl(fallback.bookUrl) || fallback.bookUrl,
			cover: fallback.imageUrl,
		};
	}
}

function formatDateISO(value?: string | number): string | undefined {
	if (!value) return undefined;
	let date: Date;
	if (typeof value === "number") {
		date = new Date(value);
	} else {
		date = new Date(value);
	}
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString().split("T")[0];
}

export function buildBookTemplateData(details: BookDetails): BookTemplateData {
	// Convert publishedDate to ISO format (YYYY-MM-DD) for Obsidian date property
	let isoDate: string | undefined;
	if (details.publishedYear) {
		// If we have a publishedDate string, try to parse it
		if (details.publishedDate) {
			isoDate = formatDateISO(details.publishedDate);
		}
		// Fallback to just the year if we only have that
		if (!isoDate && details.publishedYear) {
			isoDate = `${details.publishedYear}-01-01`;
		}
	} else if (details.publishedDate) {
		isoDate = formatDateISO(details.publishedDate);
	}

	return {
		title: details.title || "Untitled",
		author: details.author || "Unknown",
		rating: details.rating,
		genres: details.genres?.join(", ") || "",
		ratings_count: details.ratingsCount,
		description: details.description || "",
		pages: details.pages,
		published_date: isoDate,
		isbn: details.isbn,
		cover: getCoverUrl(details.cover || details.imageUrl),
		goodreads_url:
			normalizeGoodreadsUrl(details.bookUrl) || details.bookUrl,
		id: details.id,
		now: new Date().toISOString().split("T")[0],
	};
}

export function replacePlaceholders(
	template: string,
	data: BookTemplateData,
): string {
	let out = template;
	(Object.keys(data) as Array<keyof BookTemplateData>).forEach((k) => {
		const v = data[k];
		const replacement =
			typeof v === "number" ? String(v) : (v ?? "Unknown");
		out = out.split(`{{${String(k)}}}`).join(replacement);
	});
	return out;
}
