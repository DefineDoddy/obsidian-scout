import { Setting } from "obsidian";
import { COMMON_FIELDS } from "../../types";
import type { SettingsSection } from "./types";

/** Documents the placeholders available to templates. */
export const templatesSection: SettingsSection = {
	id: "templates",
	label: "Templates",
	icon: "code",
	intro: "Placeholders you can use in a template file. Frontmatter is rendered as valid YAML — values are quoted and escaped for you.",

	render(container, { registry }) {
		new Setting(container).setName("Available placeholders").setHeading();

		const list = container.createEl("ul", { cls: "scout-field-list" });
		const add = (name: string, description: string) => {
			const li = list.createEl("li");
			li.createEl("code", { text: `{{${name}}}` });
			li.appendText(` — ${description}`);
		};

		for (const field of COMMON_FIELDS) add(field.name, field.description);

		for (const provider of registry.all()) {
			if (provider.fields.length === 0) continue;
			list.createEl("li", {
				text: `${provider.name} also provides:`,
				cls: "scout-field-group",
			});
			for (const field of provider.fields) add(field.name, field.description);
		}

		new Setting(container).setName("Filters and blocks").setHeading();

		const filters = container.createEl("p");
		filters.appendText("Filters: ");
		filters.createEl("code", {
			text: "{{tags|list}} {{release_date|date:YYYY}} {{description|truncate:200}} {{people|link}} {{rating|scale:10:5}} {{pages|default:Unknown}}",
		});

		container.createEl("p", {
			text: "Conditionals: {{#if runtime}}…{{/if}}, {{#each people}}- {{.}}{{/each}}",
		});

		new Setting(container).setName("Working with the library").setHeading();

		container.createEl("p", {
			cls: "scout-tab-intro",
			text: "A template that includes the library's properties — status, rating, and the source ids — lets a new note show up on the right shelf straight away, and lets Scout match it back to a search result later.",
		});

		const example = container.createEl("pre");
		example.createEl("code", {
			text: [
				"---",
				"title: {{title}}",
				"type: {{kind}}",
				"status: To watch",
				"rating:",
				"source: {{provider}}",
				"scout_id: {{id}}",
				"---",
				"",
				"## Thoughts",
				"",
			].join("\n"),
		});
	},
};
