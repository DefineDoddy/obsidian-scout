import React, { useState, useEffect, useRef, useCallback } from "react";
import { TMDB } from "tmdb-ts";
import type { App } from "obsidian";
import { normalizePath, TFile, Notice, setIcon } from "obsidian";
import type { ScoutSettings } from "../../settings";
import {
	type SearchResult,
	isMovieResult,
	getTitleFromResult,
	getYearFromResult,
	getPosterUrl as _getPosterUrl,
	getVoteAverageFromResult,
	buildTemplateData,
	replacePlaceholders,
} from "../../utils/tvUtils";
import { MOVIE_TEMPLATE, TV_TEMPLATE } from "../../templates/tvTemplates";

type Filter = "All" | "Movies" | "TV Shows";
type SortBy =
	| "Rating (High to Low)"
	| "Rating (Low to High)"
	| "Year (Newest)"
	| "Year (Oldest)"
	| "Title (A-Z)"
	| "Title (Z-A)";
type ViewMode = "list" | "grid";

interface Genre {
	id: number;
	name: string;
}

interface ScoutModalProps {
	app: App;
	settings: ScoutSettings;
	onClose: () => void;
}

const getPosterUrl = _getPosterUrl;

export default function ScoutModal({
	app,
	settings,
	onClose,
}: ScoutModalProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [filter, setFilter] = useState<Filter>("All");
	const [sortBy, setSortBy] = useState<SortBy>("Rating (High to Low)");
	const [viewMode, setViewMode] = useState<ViewMode>(
		(settings.get("lastViewMode") as ViewMode) || "list",
	);
	const [genres, setGenres] = useState<Genre[]>([]);
	const [selectedGenre, setSelectedGenre] = useState(0);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
	const iconRefsRef = useRef<Map<HTMLElement, string>>(new Map());

	useEffect(() => {
		searchInputRef.current?.focus();
		loadGenres();

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		(async () => {
			try {
				await settings.set("lastViewMode", viewMode);
			} catch (err) {
				console.warn("Scout: Failed to persist view mode", err);
			}
		})();
	}, [viewMode]);

	const loadGenres = async () => {
		const apiKey = settings.get("tmdbAccessToken");
		if (!apiKey) return;

		try {
			const tmdb = new TMDB(apiKey);
			const [movieGenres, tvGenres] = await Promise.all([
				tmdb.genres.movies(),
				tmdb.genres.tvShows(),
			]);

			const genreMap = new Map<number, string>();
			for (const g of movieGenres.genres) genreMap.set(g.id, g.name);
			for (const g of tvGenres.genres) {
				if (!genreMap.has(g.id)) genreMap.set(g.id, g.name);
			}

			const genreArray = Array.from(genreMap.entries())
				.map(([id, name]) => ({ id, name }))
				.sort((a, b) => a.name.localeCompare(b.name));

			setGenres(genreArray);
		} catch (err) {
			console.warn("Scout: Error loading genres:", err);
		}
	};

	const filterAndSort = useCallback(
		(results: SearchResult[]): SearchResult[] => {
			const filtered = results.filter((result) => {
				const matchesType =
					filter === "Movies"
						? result.media_type === "movie"
						: filter === "TV Shows"
							? result.media_type === "tv"
							: true;

				const matchesGenre =
					selectedGenre === 0 ||
					("genre_ids" in result &&
						result.genre_ids?.includes(selectedGenre));

				return matchesType && matchesGenre;
			});

			return filtered.sort((a, b) => {
				const ratingA = getVoteAverageFromResult(a) ?? 0;
				const ratingB = getVoteAverageFromResult(b) ?? 0;
				const yearA = getYearFromResult(a) ?? 0;
				const yearB = getYearFromResult(b) ?? 0;

				switch (sortBy) {
					case "Rating (High to Low)":
						return ratingB - ratingA;
					case "Rating (Low to High)":
						return ratingA - ratingB;
					case "Year (Newest)":
						return yearB - yearA;
					case "Year (Oldest)":
						return yearA - yearB;
					case "Title (A-Z)":
						return getTitleFromResult(a).localeCompare(
							getTitleFromResult(b),
						);
					case "Title (Z-A)":
						return getTitleFromResult(b).localeCompare(
							getTitleFromResult(a),
						);
					default:
						return 0;
				}
			});
		},
		[filter, sortBy, selectedGenre],
	);

	const performSearch = async (query: string) => {
		if (!query.trim()) {
			setResults([]);
			return;
		}

		const apiKey = settings.get("tmdbAccessToken");
		if (!apiKey) {
			new Notice("Please set TMDB Access Token in settings");
			return;
		}

		try {
			const tmdb = new TMDB(apiKey);
			const response = await tmdb.search.multi({ query });

			const filtered = response.results
				.filter(
					(r): r is SearchResult =>
						r.media_type === "movie" || r.media_type === "tv",
				)
				.slice(0, 10);

			setResults(filtered);
		} catch (err) {
			console.warn("Scout: Error searching TMDB:", err);
			new Notice("Failed to fetch results. Check console for details.");
			setResults([]);
		}
	};

	const handleSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
		const query = e.target.value;
		setSearchQuery(query);

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => performSearch(query), 500);
	};

	const selectResult = async (res: SearchResult) => {
		const isMovie = res.media_type === "movie";
		const templatePath = settings.get(
			isMovie ? "movieTemplateFilePath" : "tvShowTemplateFilePath",
		);
		const outputLocation = settings.get(
			isMovie ? "movieOutputLocation" : "tvShowOutputLocation",
		);
		const apiKey = settings.get("tmdbAccessToken");

		if (!outputLocation) {
			new Notice("Please set output location in settings");
			return;
		}

		if (!apiKey) {
			new Notice("TMDB Access Token not set");
			return;
		}

		try {
			let templateContent: string;

			if (templatePath) {
				const templateFile = app.vault.getAbstractFileByPath(
					normalizePath(templatePath),
				);

				if (!(templateFile instanceof TFile)) {
					new Notice("Template file not found");
					return;
				}

				templateContent = await app.vault.cachedRead(templateFile);
			} else {
				templateContent = isMovie ? MOVIE_TEMPLATE : TV_TEMPLATE;
			}

			const tmdb = new TMDB(apiKey);
			const details = isMovieResult(res)
				? await tmdb.movies.details(res.id)
				: await tmdb.tvShows.details(res.id);

			const data = buildTemplateData(details, res);
			const content = replacePlaceholders(templateContent, data);
			// Create a filename-safe title: replace colons (and any surrounding spaces) with " - ",
			// then replace other illegal filename characters with underscores and trim whitespace.
			const safeTitle = (data.title || "Untitled")
				.replace(/\s*:\s*/g, " - ")
				.replace(/[<>|"?*\\/]/g, "_")
				.trim();
			const fileName = `${safeTitle}.md`;

			await app.vault.create(
				normalizePath(`${outputLocation}/${fileName}`),
				content,
			);
			new Notice(`Created file: ${fileName}`);

			onClose();
		} catch (err) {
			console.warn("Scout: Error creating file from TMDB:", err);
			new Notice(
				`Failed to create file: ${
					err instanceof Error ? err.message : "Unknown error"
				}`,
			);
		}
	};

	const handleIconRef = (node: HTMLElement | null, iconName: string) => {
		if (node) {
			setIcon(node, iconName);
			iconRefsRef.current.set(node, iconName);
		}
	};

	const filteredResults = filterAndSort(results);

	return (
		<div className="scout-modal-content">
			<input
				ref={searchInputRef}
				type="text"
				className="scout-search-input"
				placeholder="Enter movie or TV show title..."
				value={searchQuery}
				onChange={handleSearchInput}
			/>

			<div
				className="scout-controls"
				style={{
					marginBottom: filteredResults.length > 0 ? "14px" : "0",
				}}
			>
				<label className="scout-label">
					<select
						value={filter}
						onChange={(e) => setFilter(e.target.value as Filter)}
					>
						<option value="All">Movies & TV Shows</option>
						<option value="Movies">Movies Only</option>
						<option value="TV Shows">TV Shows Only</option>
					</select>
				</label>

				<label className="scout-label">
					<select
						value={selectedGenre}
						onChange={(e) =>
							setSelectedGenre(Number(e.target.value))
						}
					>
						<option value={0}>All Genres</option>
						{genres.map((genre) => (
							<option key={genre.id} value={genre.id}>
								{genre.name}
							</option>
						))}
					</select>
				</label>

				<label className="scout-label">
					<select
						value={sortBy}
						onChange={(e) => setSortBy(e.target.value as SortBy)}
					>
						<option value="Rating (High to Low)">
							Rating (High to Low)
						</option>
						<option value="Rating (Low to High)">
							Rating (Low to High)
						</option>
						<option value="Year (Newest)">Year (Newest)</option>
						<option value="Year (Oldest)">Year (Oldest)</option>
						<option value="Title (A-Z)">Title (A-Z)</option>
						<option value="Title (Z-A)">Title (Z-A)</option>
					</select>
				</label>

				<button
					className="view-mode-btn"
					onClick={() =>
						setViewMode(viewMode === "list" ? "grid" : "list")
					}
					title={
						viewMode === "list"
							? "Switch to grid view"
							: "Switch to list view"
					}
					aria-label={
						viewMode === "list"
							? "Switch to grid view"
							: "Switch to list view"
					}
				>
					<span
						ref={(el) => {
							if (el) {
								handleIconRef(
									el,
									viewMode === "list" ? "grid" : "rows",
								);
							}
						}}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "16px",
							height: "16px",
							lineHeight: "0",
						}}
					></span>
				</button>
			</div>

			<div className="scout-results-container">
				{filteredResults.length === 0 && searchQuery.trim() ? (
					<p className="scout-no-results">No results found</p>
				) : filteredResults.length > 0 ? (
					<div className={`scout-results-${viewMode}`}>
						{filteredResults.map((result) => (
							<div
								key={`${result.media_type}-${result.id}`}
								className="result-item"
								role="button"
								tabIndex={0}
								onClick={() => selectResult(result)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										selectResult(result);
									}
								}}
							>
								<img
									src={getPosterUrl(
										result.poster_path,
										"w342",
									)}
									alt={getTitleFromResult(result)}
									className="result-poster"
									draggable="false"
								/>

								<div className="result-info">
									<h3>{getTitleFromResult(result)}</h3>
									{viewMode === "list" ? (
										<>
											<p>
												Type:{" "}
												{result.media_type === "tv"
													? "TV Show"
													: "Movie"}
											</p>
											<p>
												Year:{" "}
												{getYearFromResult(result) ??
													"Unknown"}
											</p>
											<p>
												Rating:{" "}
												{getVoteAverageFromResult(
													result,
												)?.toFixed(1) ?? "N/A"}
											</p>
										</>
									) : (
										<p className="grid-meta">
											{result.media_type === "tv"
												? "TV Show"
												: "Movie"}{" "}
											·{" "}
											{getYearFromResult(result) ??
												"Unknown"}{" "}
											·{" "}
											{getVoteAverageFromResult(
												result,
											)?.toFixed(1) ?? "N/A"}
										</p>
									)}
								</div>
							</div>
						))}
					</div>
				) : null}
			</div>

			<style>{`
        .scout-modal .modal-close-button {
          top: 16px;
          inset-inline-end: 16px !important;
        }

        .scout-modal .modal-header {
          margin-bottom: 16px;
        }

        .scout-modal-content {
          padding: 0;
        }

        .scout-search-input {
          width: 100%;
          background-color: var(--background-secondary);
          font-size: 16px;
          padding: 16px 12px;
          margin-bottom: 10px;
        }

        .scout-controls {
          display: flex;
          gap: 12px;
          align-items: center;
          justify-content: space-between;
        }

        .scout-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .scout-results-container {
          max-height: 500px;
          overflow-y: auto;
          padding-right: 8px;
        }

        .view-mode-btn {
          padding: 8px;
        }

        .scout-results-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .scout-results-list .result-item {
          display: flex;
          gap: 12px;
          padding: 10px;
          border-radius: 6px;
          background: var(--background-secondary);
          cursor: pointer;
          transition: background 0.2s;
        }

        .scout-results-list .result-poster {
          width: 60px;
          height: 90px;
          object-fit: cover;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .scout-results-list .result-info {
          flex: 1;
        }

        .scout-results-list .result-info h3 {
          margin: 0 0 8px 0;
          font-size: 16px;
          font-weight: 600;
        }

        .scout-results-list .result-info p {
          margin: 4px 0;
          font-size: 13px;
          color: var(--text-muted);
        }

        .scout-results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }

        .scout-results-grid .result-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 12px;
          border-radius: 6px;
          background: var(--background-secondary);
          cursor: pointer;
          transition: background 0.2s;
          text-align: center;
        }

        .scout-results-grid .result-poster {
          width: 100%;
          height: 150px;
          object-fit: cover;
          border-radius: 4px;
          margin-bottom: 8px;
        }

        .scout-results-grid .result-info {
          width: 100%;
        }

        .scout-results-grid .result-info h3 {
          margin: 0 0 4px 0;
          font-size: 13px;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .scout-results-grid .result-info p {
          margin: 0;
          font-size: 11px;
          color: var(--text-muted);
        }

        .grid-meta {
          opacity: 0.7;
        }

        .result-item:hover {
          background: var(--background-modifier-hover);
        }

        .scout-no-results {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-muted);
          margin-block-end: 0px;
        }
      `}</style>
		</div>
	);
}
