import { Setting } from "obsidian";
import {
	statusesFor,
	type LibraryGroupBy,
	type LibraryLayout,
	type LibrarySort,
	type RatingIcon,
} from "../../library/config";
import { ALL_MEDIA_KINDS, MEDIA_KIND_LABELS } from "../../types";
import { findMissingSourceIds } from "../../../ui/linkNotes";
import { refreshLibrary } from "../../../ui/refreshNotes";
import { addDropdown, addSlider, addText, addToggle } from "../controls";
import type { SettingsSection } from "./types";

const SCALE_OPTIONS: Record<string, string> = {
	"5": "Out of 5",
	"10": "Out of 10",
	"100": "Out of 100",
};

/** How the library finds, shows, and tracks the notes you already have. */
export const librarySection: SettingsSection = {
	id: "library",
	label: "Library",
	icon: "library-big",
	intro: "The library lists notes that are already in your vault. Nothing is stored outside the notes themselves.",

	render(container, ctx) {
		const { settings, library, refresher, rerender } = ctx;
		const config = settings.library();

		/* ------------------------------------------------------ what counts */

		new Setting(container).setName("What to include").setHeading();

		addDropdown<"vault" | "folders">(container, {
			name: "Look in",
			desc: "Every note whose media-type property is recognized, or only the folders Scout writes to.",
			value: config.scope,
			options: {
				vault: "The whole vault",
				folders: "My note folders only",
			},
			onChange: (v) => {
				settings.setLibrary("scope", v);
				rerender();
			},
		});

		if (config.scope === "folders") {
			addText(container, {
				name: "Also include",
				desc: "Extra folders to index, separated by commas.",
				value: config.includeFolders,
				placeholder: "Archive/Films, Inbox",
				wide: true,
				onChange: (v) => settings.setLibrary("includeFolders", v),
			});
		}

		addText(container, {
			name: "Never include",
			desc: "Folders to skip, separated by commas. Useful for templates and archives.",
			value: config.excludeFolders,
			placeholder: "Templates, Archive",
			wide: true,
			onChange: (v) => settings.setLibrary("excludeFolders", v),
		});

		new Setting(container)
			.setName("Indexed notes")
			.setDesc(
				`${library.all().length} note(s) currently match. Rebuild if you have edited notes outside Obsidian.`,
			)
			.addButton((b) =>
				b.setButtonText("Rebuild").onClick(() => {
					library.rebuild();
					rerender();
				}),
			);

		// A rebuild cannot invent these — the id belongs to the source, not to
		// the vault — so the fix has to be a search, and it belongs next to the
		// rebuild button where somebody would look for it.
		const unlinked = library.all().filter((entry) => !entry.ref).length;
		new Setting(container)
			.setName("Source ids")
			.setDesc(
				unlinked === 0
					? "Every indexed note records which source it came from, so search results match them exactly."
					: `${unlinked} note(s) have no source id, so Scout can only match them to search results by title and year. Looking them up fixes that.`,
			)
			.addButton((b) =>
				b
					.setButtonText("Find missing ids")
					.setDisabled(unlinked === 0)
					.onClick(async () => {
						await findMissingSourceIds(ctx);
						rerender();
					}),
			);

		/* --------------------------------------------------- staying current */

		new Setting(container).setName("Keeping notes up to date").setHeading();

		container.createEl("p", {
			text: "A note holds what its source knew on the day it was made, and some of that moves — a score settles over the first month, a date slips, a show gains a season. Scout re-asks a note as often as its own facts warrant: every few days for something not out yet or a series you are part-way through, every few months for a film from the nineties. Only facts the source owns are written; your ratings, statuses, dates, progress, and thoughts are never touched.",
			cls: "scout-tab-intro",
		});

		addToggle(container, {
			name: "Refresh in the background",
			desc: "Runs a while after Obsidian starts, and every six hours it stays open.",
			value: config.autoRefresh,
			onChange: (v) => settings.setLibrary("autoRefresh", v),
		});

		addSlider(container, {
			name: "Notes per run",
			desc: "The ceiling on one run, so a large library spreads over days instead of arriving as one burst of requests.",
			value: config.refreshBudget,
			min: 5,
			max: 100,
			step: 5,
			onChange: (v) => settings.setLibrary("refreshBudget", v),
		});

		const due = refresher.dueCount();
		const eligible = refresher.eligibleCount();
		new Setting(container)
			.setName("Refresh now")
			.setDesc(
				eligible === 0
					? "No note records which source it came from yet, so there is nothing to ask about."
					: due === 0
						? `Nothing is due. All ${eligible} linked note(s) have been checked recently.`
						: `${due} of ${eligible} linked note(s) are due a check.`,
			)
			.addButton((b) =>
				b
					.setButtonText("Refresh what is due")
					.setDisabled(due === 0)
					.onClick(async () => {
						await refreshLibrary(ctx);
						rerender();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Refresh everything")
					.setWarning()
					.setDisabled(eligible === 0)
					.onClick(async () => {
						await refreshLibrary(ctx, { all: true });
						rerender();
					}),
			);

		/* ------------------------------------------------------- appearance */

		new Setting(container).setName("Appearance").setHeading();

		addDropdown<LibraryLayout>(container, {
			name: "Layout",
			value: config.layout,
			options: { grid: "Grid", list: "List", table: "Table" },
			onChange: (v) => settings.setLibrary("layout", v),
		});

		addSlider(container, {
			name: "Cover size",
			desc: "Minimum width of a grid card, in pixels.",
			value: config.cardSize,
			min: 90,
			max: 260,
			step: 10,
			onChange: (v) => settings.setLibrary("cardSize", v),
		});

		addDropdown<LibraryGroupBy>(container, {
			name: "Group by",
			value: config.groupBy,
			options: {
				none: "Nothing",
				kind: "Media type",
				status: "Status",
				genre: "Genre (every one an item has)",
				"genre-main": "Main genre only",
				person: "Person",
				rating: "Rating",
				favorite: "Favourite",
				decade: "Decade",
				year: "Year",
			},
			onChange: (v) => settings.setLibrary("groupBy", v),
		});

		addDropdown<LibrarySort>(container, {
			name: "Sort by",
			value: config.sortBy,
			options: {
				recent: "Recently updated",
				added: "Recently added",
				title: "Title (A–Z)",
				"title-desc": "Title (Z–A)",
				"rating-desc": "Highest rated",
				"rating-asc": "Lowest rated",
				"year-desc": "Newest first",
				"year-asc": "Oldest first",
				status: "Status",
				progress: "Furthest along",
			},
			onChange: (v) => settings.setLibrary("sortBy", v),
		});

		addToggle(container, {
			name: "Show cover art",
			value: config.showCovers,
			onChange: (v) => settings.setLibrary("showCovers", v),
		});
		addToggle(container, {
			name: "Show ratings on cards",
			value: config.showRatings,
			onChange: (v) => settings.setLibrary("showRatings", v),
		});
		addToggle(container, {
			name: "Show status on cards",
			value: config.showStatus,
			onChange: (v) => settings.setLibrary("showStatus", v),
		});
		addToggle(container, {
			name: "Show the summary bar",
			desc: "Counts and average rating above the list.",
			value: config.showStats,
			onChange: (v) => settings.setLibrary("showStats", v),
		});

		addToggle(container, {
			name: "Clicking an item shows its details",
			desc: "Turn this off to open the note itself instead. Ctrl or Cmd click always opens the note.",
			value: config.openDetailOnClick,
			onChange: (v) => settings.setLibrary("openDetailOnClick", v),
		});
		addToggle(container, {
			name: "Open notes in a new tab",
			value: config.openInNewTab,
			onChange: (v) => settings.setLibrary("openInNewTab", v),
		});
		addToggle(container, {
			name: "Confirm before deleting",
			value: config.confirmDelete,
			onChange: (v) => settings.setLibrary("confirmDelete", v),
		});

		/* ---------------------------------------------------------- ratings */

		new Setting(container).setName("Ratings").setHeading();

		addDropdown<string>(container, {
			name: "Default scale",
			desc: "Used by any kind without its own scale below. Changing this never rewrites a note — it only changes how the numbers already in your notes are read.",
			value: String(config.ratingScale),
			options: SCALE_OPTIONS,
			onChange: (v) => settings.setLibrary("ratingScale", Number(v)),
		});

		// Vaults are rarely consistent: films copied from a source are usually
		// out of ten while books are out of five. Rather than convert anyone's
		// notes, the scale follows the notes.
		for (const kind of ALL_MEDIA_KINDS) {
			const own = config.ratingScales[kind];
			addDropdown<string>(container, {
				name: `${MEDIA_KIND_LABELS[kind]} scale`,
				value: own === undefined ? "" : String(own),
				options: {
					"": `Default (out of ${config.ratingScale})`,
					...SCALE_OPTIONS,
				},
				onChange: (v) => {
					const next = { ...settings.library().ratingScales };
					if (v) next[kind] = Number(v);
					else delete next[kind];
					void settings.setLibrary("ratingScales", next);
				},
			});
		}

		addDropdown<string>(container, {
			name: "Increment",
			desc: "The smallest step a rating can move, in the units of its own scale. Anything the icons cannot land on exactly is typed into the box beside them instead.",
			value: String(config.ratingStep),
			options: { "1": "Whole only", "0.5": "Halves", "0.1": "Tenths" },
			onChange: (v) => settings.setLibrary("ratingStep", Number(v)),
		});

		addDropdown<RatingIcon>(container, {
			name: "Icon",
			desc: "There are always five icons whatever the scale, so 8 out of 10 fills four of them.",
			value: config.ratingIcon,
			options: {
				star: "Stars",
				heart: "Hearts",
				circle: "Dots",
				number: "A number",
			},
			onChange: (v) => settings.setLibrary("ratingIcon", v),
		});

		/* --------------------------------------------------------- statuses */

		new Setting(container).setName("Statuses").setHeading();

		container.createEl("p", {
			text: "The shelves each media type can be on, in order, separated by commas.",
			cls: "scout-tab-intro",
		});

		for (const kind of ALL_MEDIA_KINDS) {
			addText(container, {
				name: MEDIA_KIND_LABELS[kind],
				value: config.statuses[kind],
				placeholder: statusesFor(config, kind).join(", "),
				wide: true,
				onChange: (v) => settings.setLibraryEntry("statuses", kind, v),
			});
		}

		/* ---------------------------------------------------- what they mean */

		new Setting(container).setName("What your statuses mean").setHeading();

		container.createEl("p", {
			text: "Sorting your own words into these four groups is what gives each status its icon and colour, and what tells Scout when to stamp a date. Anything you leave out counts as not started yet.",
			cls: "scout-tab-intro",
		});

		addText(container, {
			name: "Started",
			desc: "Shown with a ring when the note records how far through you are.",
			value: config.inProgressStatuses,
			wide: true,
			onChange: (v) => settings.setLibrary("inProgressStatuses", v),
		});
		addText(container, {
			name: "Finished",
			value: config.finishedStatuses,
			wide: true,
			onChange: (v) => settings.setLibrary("finishedStatuses", v),
		});
		addText(container, {
			name: "Set aside",
			value: config.pausedStatuses,
			wide: true,
			onChange: (v) => settings.setLibrary("pausedStatuses", v),
		});
		addText(container, {
			name: "Given up on",
			value: config.droppedStatuses,
			wide: true,
			onChange: (v) => settings.setLibrary("droppedStatuses", v),
		});

		addToggle(container, {
			name: "Stamp dates automatically",
			desc: "Fill in the start and finish dates when a status moves into one of the first two groups.",
			value: config.autoTimestamps,
			onChange: (v) => settings.setLibrary("autoTimestamps", v),
		});

		/* ------------------------------------------------------ your notes */

		new Setting(container).setName("Tracking").setHeading();

		addText(container, {
			name: "Thoughts heading",
			desc: "The section of the note the thoughts box reads and writes. It is created if the note has no such heading.",
			value: config.thoughtsHeading,
			placeholder: "Thoughts",
			wide: true,
			onChange: (v) => settings.setLibrary("thoughtsHeading", v),
		});

		addText(container, {
			name: "Progress totals",
			desc: "Properties to read a total from for the progress bar, in order of preference.",
			value: config.progressTotalFields,
			placeholder: "number_of_episodes, pages",
			wide: true,
			onChange: (v) => settings.setLibrary("progressTotalFields", v),
		});
	},
};
