import { Notice, Setting } from "obsidian";
import { countVerdicts } from "../../library/feedback";
import { addSlider, addToggle } from "../controls";
import type { SettingsSection } from "./types";

/**
 * What Scout has learned, and how much it is allowed to go and learn.
 *
 * Its own page rather than three more rows on the Library tab, which is
 * already the longest one. It is also the only place any of this is
 * inspectable: the feedback log has been collectable since it was written and
 * there has never been a way to see how much of it there is, let alone clear
 * it.
 */
export const suggestionsSection: SettingsSection = {
	id: "suggestions",
	label: "Suggestions",
	icon: "wand-sparkles",
	intro:
		"How the row on the hub decides what to put in front of you, and what it is allowed to find out in order to decide.",

	render(container, ctx) {
		const { settings, enricher, rerender } = ctx;
		const config = settings.library();

		new Setting(container).setName("Reading up on your library").setHeading();

		container.createEl("p", {
			cls: "scout-tab-intro",
			text:
				"A note records a genre list and a director, because that is what you want to read back. It is not enough to recommend on — “Drama, Thriller” is shared by a third of everything ever made. With this on, Scout asks the same sources it already uses what each of your titles is actually about: its keywords, its cast, its crew. Only the ids your notes already carry are sent, the answers are kept in Scout's own data file, and nothing is ever written into your notes.",
		});

		addToggle(container, {
			name: "Read up in the background",
			desc: "Starts a while after Obsidian does, and comes round every six hours it stays open.",
			value: config.enrichSuggestions,
			onChange: (v) => {
				settings.setLibrary("enrichSuggestions", v);
				rerender();
			},
		});

		if (config.enrichSuggestions) {
			addSlider(container, {
				name: "Titles per run",
				desc: "One request each. The ceiling on a single run, so a large library spreads over a few days rather than arriving as one burst.",
				value: config.enrichBudget,
				min: 5,
				max: 40,
				step: 5,
				onChange: (v) => settings.setLibrary("enrichBudget", v),
			});
		}

		const { eligible, known, waiting } = enricher.progress();
		new Setting(container)
			.setName("What Scout has read")
			.setDesc(
				eligible === 0
					? "No note records which source it came from yet, so there is nothing to read up on."
					: waiting === 0
						? `All ${eligible} linked note(s) have been read up on.`
						: `${known} of ${eligible} linked note(s) read up on. ${waiting} waiting.`,
			)
			.addButton((b) =>
				b
					.setButtonText("Read up now")
					.setDisabled(waiting === 0)
					.onClick(async () => {
						const report = await enricher.runDue();
						new Notice(
							report
								? `Read up on ${report.harvested} of ${report.asked}.`
								: "Already reading up.",
						);
						rerender();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Forget it all")
					.setWarning()
					.setDisabled(known === 0)
					.onClick(() => {
						settings.clearEnrichment();
						new Notice("Forgotten. It will be read again in the background.");
						rerender();
					}),
			);

		new Setting(container).setName("What you have told it").setHeading();

		const counts = countVerdicts(settings.feedback());
		const total = counts.liked + counts.disliked + counts.seen + counts.snoozed;
		new Setting(container)
			.setName("Your verdicts")
			.setDesc(
				total === 0
					? "Nothing yet. The thumbs on each suggestion are how you correct it."
					: `${counts.liked} liked · ${counts.disliked} not for me · ${counts.seen} already seen · ${counts.snoozed} put off`,
			)
			.addButton((b) =>
				b
					.setButtonText("Clear verdicts")
					.setWarning()
					.setDisabled(total === 0)
					.onClick(() => {
						settings.clearFeedback();
						new Notice("Verdicts cleared.");
						rerender();
					}),
			);

		new Setting(container)
			.setName("What it has already shown you")
			.setDesc(
				"Recently suggested titles are held back so the row moves on. Clearing this lets them all come round again.",
			)
			.addButton((b) =>
				b
					.setButtonText("Show everything again")
					.setDisabled(Object.keys(settings.shownLog()).length === 0)
					.onClick(() => {
						settings.clearShown();
						rerender();
					}),
			);
	},
};
