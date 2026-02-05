import React, { useState, useEffect, useRef, useCallback } from "react";
import type { App } from "obsidian";
import { normalizePath, TFile, Notice, setIcon, requestUrl } from "obsidian";
import type { ScoutSettings } from "../../settings";
import { BOOK_TEMPLATE } from "../../templates/bookTemplates";
import {
	mapAutocompleteItem,
	fetchGoodreadsBookDetails,
	buildBookTemplateData,
	replacePlaceholders,
	getCoverUrl,
	type BookSearchResult,
} from "../../utils/bookUtils";

type SortBy =
	| "Rating (High to Low)"
	| "Rating (Low to High)"
	| "Year (Newest)"
	| "Year (Oldest)"
	| "Title (A-Z)"
	| "Title (Z-A)";

type ViewMode = "list" | "grid";

interface ScoutModalProps {
	app: App;
	settings: ScoutSettings;
	onClose: () => void;
}

export default function BookSearchModal({
	app,
	settings,
	onClose,
}: ScoutModalProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [results, setResults] = useState<BookSearchResult[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>("Rating (High to Low)");
	const [viewMode, setViewMode] = useState<ViewMode>(
		(settings.get("lastBookViewMode") as ViewMode) || "list",
	);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
	const iconRefsRef = useRef<Map<HTMLElement, string>>(new Map());

	useEffect(() => {
		searchInputRef.current?.focus();

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		(async () => {
			try {
				await settings.set("lastBookViewMode", viewMode);
			} catch (err) {
				console.warn("Scout: Failed to persist book view mode", err);
			}
		})();
	}, [viewMode]);

	const filterAndSort = useCallback(
		(resultsToSort: BookSearchResult[]): BookSearchResult[] => {
			return resultsToSort.sort((a, b) => {
				const ratingA = a.rating ?? 0;
				const ratingB = b.rating ?? 0;
				const yearA = a.publishedYear ?? 0;
				const yearB = b.publishedYear ?? 0;

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
						return a.title.localeCompare(b.title);
					case "Title (Z-A)":
						return b.title.localeCompare(a.title);
					default:
						return 0;
				}
			});
		},
		[sortBy],
	);

	const performSearch = async (query: string) => {
		if (!query.trim()) {
			setResults([]);
			return;
		}

		try {
			const url = `https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(
				query,
			)}`;
			const response = await requestUrl({ url, method: "GET" });
			const data = response.json;
			const mapped = Array.isArray(data)
				? (data
						.map(mapAutocompleteItem)
						.filter(Boolean) as BookSearchResult[])
				: [];
			const topResults = mapped.slice(0, 10);
			setResults(topResults);

			const enriched = await Promise.all(
				topResults.map(async (result) => {
					try {
						const details = await fetchGoodreadsBookDetails(
							result.bookUrl,
							result,
						);
						return {
							...result,
							publishedYear:
								details.publishedYear ?? result.publishedYear,
							publishedDate:
								details.publishedDate ?? result.publishedDate,
							pages: details.pages,
							isbn: details.isbn,
							rating: details.rating ?? result.rating,
							ratingsCount:
								details.ratingsCount ?? result.ratingsCount,
							imageUrl: details.cover || result.imageUrl,
							bookUrl: details.bookUrl,
						};
					} catch {
						return result;
					}
				}),
			);
			setResults(enriched);
		} catch (err) {
			console.warn("Scout: Error searching Goodreads:", err);
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

	const selectResult = async (res: BookSearchResult) => {
		const templatePath = settings.get("bookTemplateFilePath");
		const outputLocation = settings.get("bookOutputLocation");

		if (!outputLocation) {
			new Notice("Please set book output location in settings");
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
				templateContent = BOOK_TEMPLATE;
			}

			const details = await fetchGoodreadsBookDetails(res.bookUrl, res);
			const data = buildBookTemplateData(details);
			const content = replacePlaceholders(templateContent, data);
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
			console.warn("Scout: Error creating book file:", err);
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
		<div className="scout-book-modal-content">
			<input
				ref={searchInputRef}
				type="text"
				className="scout-book-search-input"
				placeholder="Enter book title or author..."
				value={searchQuery}
				onChange={handleSearchInput}
			/>

			<div
				className="scout-book-controls"
				style={{
					marginBottom: filteredResults.length > 0 ? "14px" : "0",
				}}
			>
				<label className="scout-book-label">
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

			<div className="scout-book-results-container">
				{filteredResults.length === 0 && searchQuery.trim() ? (
					<p className="scout-book-no-results">No results found</p>
				) : filteredResults.length > 0 ? (
					<div className={`scout-book-results-${viewMode}`}>
						{filteredResults.map((result) => (
							<div
								key={`book-${result.id}`}
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
									src={getCoverUrl(result.imageUrl)}
									alt={result.title}
									className="result-cover"
									draggable="false"
								/>

								<div className="result-info">
									<h3>{result.title}</h3>
									{viewMode === "list" ? (
										<>
											<p>Author: {result.author}</p>
											<p>
												Published:{" "}
												{result.publishedDate ??
													"Unknown"}
											</p>
											<p>
												Rating:{" "}
												{result.rating?.toFixed(1) ??
													"N/A"}
											</p>
										</>
									) : (
										<p className="grid-meta">
											{result.author} ·{" "}
											{result.publishedDate ?? "Unknown"}{" "}
											·{" "}
											{result.rating?.toFixed(1) ?? "N/A"}
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

        .scout-book-modal-content {
          padding: 0;
        }

        .scout-book-search-input {
          width: 100%;
          background-color: var(--background-secondary);
          font-size: 16px;
          padding: 16px 12px;
          margin-bottom: 10px;
        }

        .scout-book-controls {
          display: flex;
          gap: 12px;
          align-items: center;
          justify-content: space-between;
        }

        .scout-book-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .scout-book-results-container {
          max-height: 500px;
          overflow-y: auto;
          padding-right: 8px;
        }

        .view-mode-btn {
          padding: 8px;
        }

        .scout-book-results-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .scout-book-results-list .result-item {
          display: flex;
          gap: 12px;
          padding: 10px;
          border-radius: 6px;
          background: var(--background-secondary);
          cursor: pointer;
          transition: background 0.2s;
        }

        .scout-book-results-list .result-cover {
          width: 60px;
          height: 90px;
          object-fit: cover;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .scout-book-results-list .result-info {
          flex: 1;
        }

        .scout-book-results-list .result-info h3 {
          margin: 0 0 8px 0;
          font-size: 16px;
          font-weight: 600;
        }

        .scout-book-results-list .result-info p {
          margin: 4px 0;
          font-size: 13px;
          color: var(--text-muted);
        }

        .scout-book-results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }

        .scout-book-results-grid .result-item {
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

        .scout-book-results-grid .result-cover {
          width: 100%;
          height: 150px;
          object-fit: cover;
          border-radius: 4px;
          margin-bottom: 8px;
        }

        .scout-book-results-grid .result-info {
          width: 100%;
        }

        .scout-book-results-grid .result-info h3 {
          margin: 0 0 4px 0;
          font-size: 13px;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .scout-book-results-grid .result-info p {
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

        .scout-book-no-results {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-muted);
          margin-block-end: 0px;
        }
      `}</style>
		</div>
	);
}
