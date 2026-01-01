import { Modal, App, TFile, normalizePath, Notice } from "obsidian";
import { TMDB, MovieDetails, TvShowDetails } from "tmdb-ts";
import { ScoutSettings } from "../settings";
import {
	SearchResult,
	TemplateData,
	isMovieResult,
	getTitleFromResult,
	getYearFromResult,
	getPosterUrl,
	getVoteAverageFromResult,
	buildTemplateData,
	replacePlaceholders,
} from "../utils/tvUtils";
import { MOVIE_TEMPLATE, TV_TEMPLATE } from "../templates/tvTemplates";

/**
 * Modal that searches TMDB for movies/TV shows and creates notes from templates.
 */
export class TvSearchModal extends Modal {
	private resultsContainer!: HTMLElement;
	private debounceTimer: number | null = null;
	private lastResults: SearchResult[] = [];

	constructor(
		app: App,
		private settings: ScoutSettings,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("scout-modal");
		contentEl.createEl("h2", { text: "Search for Movies/TV Shows" });

		const searchRow = contentEl.createEl("div", {
			cls: "scout-search-row",
		});
		const input = searchRow.createEl("input", {
			type: "text",
			cls: "scout-search-input",
			placeholder: "Enter name...",
		});

		const controls = searchRow.createEl("div", { cls: "scout-controls" });
		const filterSelect = controls.createEl("select", {
			cls: "scout-filter",
		});
		["All", "Movies", "TV Shows"].forEach((opt) =>
			filterSelect.createEl("option", { text: opt, value: opt }),
		);

		const sortSelect = controls.createEl("select", { cls: "scout-sort" });
		[
			"Rating (High to Low)",
			"Rating (Low to High)",
			"Year (Newest)",
			"Year (Oldest)",
			"Title (A-Z)",
			"Title (Z-A)",
		].forEach((opt) =>
			sortSelect.createEl("option", { text: opt, value: opt }),
		);

		this.resultsContainer = contentEl.createEl("div", {
			cls: "scout-results-container",
		});

		const debouncedSearch = (): void => {
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			this.debounceTimer = window.setTimeout(
				() => this.performSearch(input.value),
				500,
			);
		};
		const updateDisplay = (): void => this.displayResults();

		input.addEventListener("input", debouncedSearch);
		filterSelect.addEventListener("change", updateDisplay);
		sortSelect.addEventListener("change", updateDisplay);
		input.focus();
	}

	async performSearch(query: string): Promise<void> {
		this.resultsContainer.empty();
		if (!query.trim()) return;

		const apiKey = this.settings.get("tmdbAccessToken");
		if (!apiKey) {
			this.resultsContainer.createEl("p", {
				text: "Please set TMDB Access Token in settings",
				cls: "scout-error",
			});
			return;
		}

		try {
			const tmdb = new TMDB(apiKey);
			const results = await tmdb.search.multi({ query });
			const filtered = results.results.filter(
				(r): r is SearchResult =>
					r.media_type === "movie" || r.media_type === "tv",
			);
			this.lastResults = filtered.slice(0, 10);
			this.displayResults();
		} catch (_err) {
			this.resultsContainer.createEl("p", {
				text: "Error fetching results",
				cls: "scout-error",
			});
		}
	}

	private displayResults(): void {
		const filter =
			(this.contentEl.querySelector(".scout-filter") as HTMLSelectElement)
				?.value || "All";
		const sort =
			(this.contentEl.querySelector(".scout-sort") as HTMLSelectElement)
				?.value || "Rating (High to Low)";

		const filtered = this.lastResults.filter((r) => {
			if (filter === "Movies") return r.media_type === "movie";
			if (filter === "TV Shows") return r.media_type === "tv";
			return true;
		});

		filtered.sort((a, b) => {
			switch (sort) {
				case "Rating (High to Low)":
					return (
						(getVoteAverageFromResult(b) ?? 0) -
						(getVoteAverageFromResult(a) ?? 0)
					);
				case "Rating (Low to High)":
					return (
						(getVoteAverageFromResult(a) ?? 0) -
						(getVoteAverageFromResult(b) ?? 0)
					);
				case "Year (Newest)": {
					const ya = getYearFromResult(a) ?? 0;
					const yb = getYearFromResult(b) ?? 0;
					return yb - ya;
				}
				case "Year (Oldest)": {
					const ya = getYearFromResult(a) ?? 0;
					const yb = getYearFromResult(b) ?? 0;
					return ya - yb;
				}
				case "Title (A-Z)": {
					return getTitleFromResult(a).localeCompare(
						getTitleFromResult(b),
					);
				}
				case "Title (Z-A)": {
					return getTitleFromResult(b).localeCompare(
						getTitleFromResult(a),
					);
				}
				default:
					return 0;
			}
		});

		this.resultsContainer.empty();

		if (filtered.length === 0) {
			this.resultsContainer.createEl("p", {
				text: "No results found",
				cls: "scout-no-results",
			});
			return;
		}

		const list = this.resultsContainer.createEl("div", {
			cls: "scout-results-list",
		});

		filtered.forEach((res) => {
			const item = list.createEl("div", { cls: "result-item" });

			item.createEl("img", {
				attr: {
					src: getPosterUrl((res as any).poster_path, "w92"),
					alt: getTitleFromResult(res),
				},
				cls: "result-poster",
			});

			const info = item.createEl("div", { cls: "result-info" });
			info.createEl("h3", { text: getTitleFromResult(res) });
			info.createEl("p", {
				text: `Year: ${getYearFromResult(res) ?? ""}`,
			});
			info.createEl("p", {
				text: `Type: ${res.media_type === "tv" ? "TV Show" : "Movie"}`,
			});
			info.createEl("p", {
				text: `Rating: ${(getVoteAverageFromResult(res) ?? 0).toFixed(1)}`,
			});

			item.addEventListener("click", async () => {
				const templatePath =
					res.media_type === "movie"
						? this.settings.get("movieTemplateFilePath")
						: this.settings.get("tvTemplateFilePath");

				const outputLocation =
					res.media_type === "movie"
						? this.settings.get("movieOutputLocation")
						: this.settings.get("tvOutputLocation");

				if (!outputLocation) {
					new Notice("Please set output location in settings");
					return;
				}

				try {
					let templateContent: string;
					if (templatePath) {
						const templateFile =
							this.app.vault.getAbstractFileByPath(
								normalizePath(templatePath),
							);
						if (!(templateFile instanceof TFile)) {
							new Notice("Template file not found");
							return;
						}
						templateContent =
							await this.app.vault.cachedRead(templateFile);
					} else {
						templateContent =
							res.media_type === "movie"
								? MOVIE_TEMPLATE
								: TV_TEMPLATE;
					}

					const apiKey = this.settings.get("tmdbAccessToken");
					if (!apiKey) {
						new Notice("TMDB Access Token not set");
						return;
					}

					const tmdb = new TMDB(apiKey);
					const details: MovieDetails | TvShowDetails = isMovieResult(
						res,
					)
						? await tmdb.movies.details(res.id)
						: await tmdb.tvShows.details(res.id);

					const data: TemplateData = buildTemplateData(details, res);
					const content = replacePlaceholders(templateContent, data);

					const fileName = `${data.title.replace(/[<>:"|?*\\/]/g, "_") || "Untitled"}.md`;
					const fullPath = normalizePath(
						`${outputLocation}/${fileName}`,
					);

					await this.app.vault.create(fullPath, content);
					new Notice(`Created file: ${fileName}`);
					this.close();
				} catch (err: unknown) {
					new Notice(
						`Error creating file: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			});
		});
	}

	onClose(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.contentEl.empty();
	}
}
