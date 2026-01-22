<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { TMDB } from "tmdb-ts";
	import type { App } from "obsidian";
	import { normalizePath, TFile, Notice, setIcon } from "obsidian";
	import type { ScoutSettings } from "../settings";
	import {
		type SearchResult,
		isMovieResult,
		getTitleFromResult,
		getYearFromResult,
		getPosterUrl as _getPosterUrl,
		getVoteAverageFromResult,
		buildTemplateData,
		replacePlaceholders,
	} from "../utils/tvUtils";
	import { MOVIE_TEMPLATE, TV_TEMPLATE } from "../templates/tvTemplates";

	type Filter = "All" | "Movies" | "TV Shows";
	type SortBy = "Rating (High to Low)" | "Rating (Low to High)" | "Year (Newest)" | "Year (Oldest)" | "Title (A-Z)" | "Title (Z-A)";
	type ViewMode = "list" | "grid";

	const getPosterUrl = _getPosterUrl;

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);

		return {
			update: (iconName: string) => {
				node.empty();
				setIcon(node, iconName);
			}
		};
	}

	export let app: App;
	export let settings: ScoutSettings;
	export let onClose: () => void;

	let searchQuery = "";
	let results: SearchResult[] = [];
	let filter: Filter = "All";
	let sortBy: SortBy = "Rating (High to Low)";
	let viewMode: ViewMode = "list";
	let debounceTimer: number | null = null;
	let searchInput: HTMLInputElement;

	onMount(() => searchInput?.focus());
	
	onDestroy(() => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
	});

	$: filteredResults = filterAndSort(results, filter, sortBy);

	function filterAndSort(results: SearchResult[], filter: Filter, sortBy: SortBy): SearchResult[] {
		const filtered = results.filter((result) =>
			filter === "Movies" ? result.media_type === "movie" :
			filter === "TV Shows" ? result.media_type === "tv" : true
		);

		return filtered.sort((a, b) => {
			const ratingA = getVoteAverageFromResult(a) ?? 0;
			const ratingB = getVoteAverageFromResult(b) ?? 0;
			const yearA = getYearFromResult(a) ?? 0;
			const yearB = getYearFromResult(b) ?? 0;

			switch (sortBy) {
				case "Rating (High to Low)": return ratingB - ratingA;
				case "Rating (Low to High)": return ratingA - ratingB;
				case "Year (Newest)": return yearB - yearA;
				case "Year (Oldest)": return yearA - yearB;
				case "Title (A-Z)": return getTitleFromResult(a).localeCompare(getTitleFromResult(b));
				case "Title (Z-A)": return getTitleFromResult(b).localeCompare(getTitleFromResult(a));
				default: return 0;
			}
		});
	}

	async function performSearch(query: string) {
		if (!query.trim()) {
			results = [];
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

			results = response.results
				.filter((r): r is SearchResult => r.media_type === "movie" || r.media_type === "tv")
				.slice(0, 10);
		} catch (err) {
			console.warn("Scout: Error searching TMDB:", err);
			new Notice("Failed to fetch results. Check console for details.");
			results = [];
		}
	}

	function handleSearchInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = window.setTimeout(() => performSearch(searchQuery), 500);
	}

	async function selectResult(res: SearchResult) {
		const isMovie = res.media_type === "movie";
		const templatePath = settings.get(isMovie ? "movieTemplateFilePath" : "tvTemplateFilePath");
		const outputLocation = settings.get(isMovie ? "movieOutputLocation" : "tvOutputLocation");
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
				const templateFile = app.vault.getAbstractFileByPath(normalizePath(templatePath));

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
			const fileName = `${data.title.replace(/[<>:"|?*\\/]/g, "_") || "Untitled"}.md`;

			await app.vault.create(normalizePath(`${outputLocation}/${fileName}`), content);
			new Notice(`Created file: ${fileName}`);

			onClose();
		} catch (err) {
			console.warn("Scout: Error creating file from TMDB:", err);
			new Notice(`Failed to create file: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	}
</script>

<div class="scout-modal-content">
	<div class="scout-search-row">
		<input
			type="text"
			class="scout-search-input"
			placeholder="Enter name..."
			bind:value={searchQuery}
			bind:this={searchInput}
			on:input={handleSearchInput}
		/>

		<button
			class="view-mode-btn clickable-icon"
			on:click={() => (viewMode = viewMode === "list" ? "grid" : "list")}
			title={viewMode === "list" ? "Switch to grid view" : "Switch to list view"}
			aria-label={viewMode === "list" ? "Switch to grid view" : "Switch to list view"}
		>
			<span use:icon={viewMode === "list" ? "grid" : "rows"}></span>
		</button>
	</div>

	<div class="scout-controls">
		<label class="scout-label">
			<span>Filter:</span>
			<select bind:value={filter}>
				<option value="All">All</option>
				<option value="Movies">Movies</option>
				<option value="TV Shows">TV Shows</option>
			</select>
		</label>

		<label class="scout-label">
			<span>Sort:</span>
			<select bind:value={sortBy}>
				<option value="Rating (High to Low)">Rating (High to Low)</option>
				<option value="Rating (Low to High)">Rating (Low to High)</option>
				<option value="Year (Newest)">Year (Newest)</option>
				<option value="Year (Oldest)">Year (Oldest)</option>
				<option value="Title (A-Z)">Title (A-Z)</option>
				<option value="Title (Z-A)">Title (Z-A)</option>
			</select>
		</label>
	</div>

	<div class="scout-results-container">
		{#if filteredResults.length === 0 && searchQuery.trim()}
			<p class="scout-no-results">No results found</p>
		{:else if filteredResults.length > 0}
			<div class="scout-results-{viewMode}">
				{#each filteredResults as result}
					<div
						class="result-item"
						role="button"
						tabindex="0"
						on:click={() => selectResult(result)}
						on:keydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								selectResult(result);
							}
						}}
					>
						<img
							src={getPosterUrl(result.poster_path, "w342")}
							alt={getTitleFromResult(result)}
							class="result-poster"
							draggable="false"
						/>

						<div class="result-info">
							<h3>{getTitleFromResult(result)}</h3>
							{#if viewMode === "list"}
								<p>Type: {result.media_type === "tv" ? "TV Show" : "Movie"}</p>
								<p>Year: {getYearFromResult(result) ?? "Unknown"}</p>
								<p>Rating: {getVoteAverageFromResult(result)?.toFixed(1) ?? "N/A"}</p>
							{:else}
								<p class="grid-meta">
									{result.media_type === "tv" ? "TV Show" : "Movie"} · {getYearFromResult(result) ?? "?"} · {getVoteAverageFromResult(result)?.toFixed(1) ?? "N/A"}
								</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	:global(.scout-modal .modal-close-button) {
		top: 16px;
		inset-inline-end: 16px !important;
	}

	:global(.scout-modal .modal-header) {
		margin-bottom: 16px;
	}

	.scout-modal-content {
		padding: 0;
	}

	.scout-search-row {
		display: flex;
		gap: 12px;
		align-items: center;
		margin-bottom: 10px;
	}

	.scout-search-input {
		flex: 1;
	}

	.scout-controls {
		display: flex;
		gap: 16px;
		align-items: center;
		margin-bottom: 12px;
	}

	.scout-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.scout-results-container {
		max-height: 500px;
		overflow-y: auto;
		padding-right: 8px;
	}

	.view-mode-btn {
		padding: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--background-modifier-border-hover);
		background: var(--background-modifier-border);
		border-radius: var(--radius-s);
		color: var(--text-muted);
		cursor: pointer;
	}

	.view-mode-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.view-mode-btn span {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		line-height: 0;
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
	}
</style>
