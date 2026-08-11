import { Setting } from "obsidian";
import {
	DEFAULT_FIELD_MAP,
	FIELD_INFO,
	type CustomField,
	type CustomFieldType,
	type FieldKey,
} from "../../library/config";
import { ALL_MEDIA_KINDS, MEDIA_KIND_LABELS, type MediaKind } from "../../types";
import { addText } from "../controls";
import type { SectionContext, SettingsSection } from "./types";

/**
 * The vocabulary settings: which frontmatter properties mean what, which
 * values name a media type, and any extra fields the user wants to track.
 *
 * Split off from the Library tab because these are set once and then left
 * alone, while the display settings get fiddled with.
 */
export const propertiesSection: SettingsSection = {
	id: "properties",
	label: "Properties",
	icon: "tags",
	intro: "Scout reads and writes ordinary frontmatter. Point it at whatever property names your notes already use.",

	render(container, ctx) {
		renderFieldMap(container, ctx);
		renderKindAliases(container, ctx);
		renderCustomFields(container, ctx);
	},
};

/* ------------------------------------------------------------- field names */

function renderFieldMap(
	container: HTMLElement,
	{ settings }: SectionContext,
): void {
	const config = settings.library();

	new Setting(container).setName("Property names").setHeading();
	container.createEl("p", {
		text: "Scout only ever writes the properties marked as written. For the rest it also accepts the obvious alternatives — poster for cover, overview for description — so most vaults need no changes here.",
		cls: "scout-tab-intro",
	});

	const keys = Object.keys(DEFAULT_FIELD_MAP) as FieldKey[];
	for (const key of keys) {
		const info = FIELD_INFO[key];
		addText(container, {
			name: info.name,
			desc: info.writes ? `${info.desc} Scout writes this one.` : info.desc,
			value: config.fields[key],
			placeholder: DEFAULT_FIELD_MAP[key],
			wide: true,
			onChange: (v) =>
				settings.setLibraryEntry(
					"fields",
					key,
					v.trim() || DEFAULT_FIELD_MAP[key],
				),
		});
	}
}

/* ----------------------------------------------------------- kind aliases */

function renderKindAliases(
	container: HTMLElement,
	{ settings }: SectionContext,
): void {
	const config = settings.library();

	new Setting(container).setName("Media type values").setHeading();
	container.createEl("p", {
		text: `Values of the "${config.fields.kind}" property that put a note on each shelf, separated by commas. The type's own name always counts.`,
		cls: "scout-tab-intro",
	});

	for (const kind of ALL_MEDIA_KINDS) {
		addText(container, {
			name: MEDIA_KIND_LABELS[kind],
			value: config.kindAliases[kind],
			wide: true,
			onChange: (v) => settings.setLibraryEntry("kindAliases", kind, v),
		});
	}
}

/* ---------------------------------------------------------- custom fields */

const TYPE_LABELS: Record<CustomFieldType, string> = {
	text: "Text",
	number: "Number",
	date: "Date",
	checkbox: "Yes / no",
	select: "Choice",
};

function newField(): CustomField {
	return {
		id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
		key: "",
		label: "",
		type: "text",
		options: "",
		kinds: [],
	};
}

function renderCustomFields(
	container: HTMLElement,
	{ settings, rerender }: SectionContext,
): void {
	const fields = settings.library().customFields;

	new Setting(container)
		.setName("Your own fields")
		.setHeading()
		.addButton((b) =>
			b
				.setButtonText("Add field")
				.setCta()
				.onClick(() => {
					settings.setLibrary("customFields", [
						...settings.library().customFields,
						newField(),
					]);
					rerender();
				}),
		);

	container.createEl("p", {
		text: "Anything else you want to track — rewatch count, who recommended it, where you watched it. Each one appears in the manage panel and is written to the note's frontmatter.",
		cls: "scout-tab-intro",
	});

	if (fields.length === 0) {
		container.createEl("p", {
			text: "No custom fields yet.",
			cls: "scout-tab-intro",
		});
		return;
	}

	/**
	 * Replaces one field and saves, reading the list fresh each time — the
	 * captured `fields` goes stale the moment any control writes, and editing
	 * two fields in a row would otherwise undo the first edit.
	 */
	const update = (id: string, patch: Partial<CustomField>) => {
		settings.setLibrary(
			"customFields",
			settings
				.library()
				.customFields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
		);
	};

	for (const field of fields) {
		const block = container.createDiv({ cls: "scout-custom-field" });

		const head = block.createDiv({ cls: "scout-custom-field-head" });
		head.createSpan({ text: field.label || field.key || "New field" });
		const remove = head.createEl("button", { text: "Remove" });
		remove.addClass("scout-danger");
		remove.onclick = () => {
			settings.setLibrary(
				"customFields",
				settings.library().customFields.filter((f) => f.id !== field.id),
			);
			rerender();
		};

		addText(block, {
			name: "Label",
			desc: "Shown next to the control.",
			value: field.label,
			placeholder: "Rewatch count",
			onChange: (v) => update(field.id, { label: v }),
		});

		addText(block, {
			name: "Property",
			desc: "The frontmatter key it is stored under.",
			value: field.key,
			placeholder: "rewatches",
			onChange: (v) => update(field.id, { key: v.trim() }),
		});

		new Setting(block).setName("Type").addDropdown((d) =>
			d
				.addOptions(TYPE_LABELS)
				.setValue(field.type)
				.onChange((v) => {
					update(field.id, { type: v as CustomFieldType });
					rerender();
				}),
		);

		if (field.type === "select") {
			addText(block, {
				name: "Choices",
				desc: "Separated by commas.",
				value: field.options,
				placeholder: "Cinema, Streaming, Disc",
				onChange: (v) => update(field.id, { options: v }),
			});
		}

		new Setting(block)
			.setName("Applies to")
			.setDesc("Leave all unticked to use it for every media type.");

		const checks = block.createDiv({ cls: "scout-kind-checks" });
		for (const kind of ALL_MEDIA_KINDS) {
			const label = checks.createEl("label");
			const input = label.createEl("input", { type: "checkbox" });
			input.checked = field.kinds.includes(kind);
			label.appendText(MEDIA_KIND_LABELS[kind]);
			input.onchange = () => {
				const next: MediaKind[] = input.checked
					? [...field.kinds, kind]
					: field.kinds.filter((k) => k !== kind);
				update(field.id, { kinds: next });
			};
		}
	}
}
