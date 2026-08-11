import {
	App,
	FuzzySuggestModal,
	Setting,
	TFile,
	TFolder,
} from "obsidian";
import type { SettingDescriptor, SettingsScope } from "./types";

/** Reusable settings controls, shared by every section of the tab. */

/* ------------------------------------------------------------ path pickers */

class FilePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly extensions: string[] | undefined,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Type to search for files…");
	}

	getItems(): TFile[] {
		const files = this.app.vault.getFiles();
		return this.extensions
			? files.filter((f) => this.extensions?.includes(f.extension))
			: files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly onChoose: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder("Type to search for folders…");
	}

	getItems(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder);
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}

/**
 * Text field plus a "Choose" button. Written once and reused everywhere, and
 * it holds a direct reference to its own input rather than looking the input
 * up by position among its siblings.
 */
export function addPathSetting(
	app: App,
	container: HTMLElement,
	options: {
		name: string;
		desc: string;
		placeholder: string;
		value: string;
		type: "file" | "folder";
		extensions?: string[];
		onChange: (value: string) => void;
	},
): void {
	let inputEl: HTMLInputElement | null = null;

	new Setting(container)
		.setName(options.name)
		.setDesc(options.desc)
		.addText((text) => {
			inputEl = text.inputEl;
			text.setPlaceholder(options.placeholder)
				.setValue(options.value)
				.onChange(options.onChange);
		})
		.addButton((btn) =>
			btn
				.setButtonText("Choose")
				.setCta()
				.onClick(() => {
					const apply = (path: string) => {
						if (!inputEl) return;
						inputEl.value = path;
						options.onChange(path);
					};
					if (options.type === "file") {
						new FilePickerModal(app, options.extensions, (f) =>
							apply(f.path),
						).open();
					} else {
						new FolderPickerModal(app, (f) => apply(f.path)).open();
					}
				}),
		);
}

/* ------------------------------------------------------------- shorthands */

export function addText(
	container: HTMLElement,
	options: {
		name: string;
		desc?: string;
		value: string;
		placeholder?: string;
		wide?: boolean;
		onChange: (value: string) => void;
	},
): Setting {
	return new Setting(container)
		.setName(options.name)
		.setDesc(options.desc ?? "")
		.addText((t) => {
			t.setPlaceholder(options.placeholder ?? "")
				.setValue(options.value)
				.onChange(options.onChange);
			if (options.wide) t.inputEl.style.width = "min(320px, 45vw)";
		});
}

export function addToggle(
	container: HTMLElement,
	options: {
		name: string;
		desc?: string;
		value: boolean;
		onChange: (value: boolean) => void;
	},
): Setting {
	return new Setting(container)
		.setName(options.name)
		.setDesc(options.desc ?? "")
		.addToggle((t) => t.setValue(options.value).onChange(options.onChange));
}

export function addDropdown<T extends string>(
	container: HTMLElement,
	options: {
		name: string;
		desc?: string;
		value: T;
		options: Record<string, string>;
		onChange: (value: T) => void;
	},
): Setting {
	return new Setting(container)
		.setName(options.name)
		.setDesc(options.desc ?? "")
		.addDropdown((d) =>
			d
				.addOptions(options.options)
				.setValue(options.value)
				.onChange((v) => options.onChange(v as T)),
		);
}

export function addSlider(
	container: HTMLElement,
	options: {
		name: string;
		desc?: string;
		value: number;
		min: number;
		max: number;
		step: number;
		onChange: (value: number) => void;
	},
): Setting {
	return new Setting(container)
		.setName(options.name)
		.setDesc(options.desc ?? "")
		.addSlider((s) =>
			s
				.setLimits(options.min, options.max, options.step)
				.setValue(options.value)
				.setDynamicTooltip()
				.onChange(options.onChange),
		);
}

/* ----------------------------------------------------- descriptor renderer */

/** Renders one provider-declared setting. Providers never touch the DOM. */
export function renderDescriptor(
	app: App,
	container: HTMLElement,
	descriptor: SettingDescriptor,
	scope: SettingsScope,
	rerender: () => void,
): void {
	if (descriptor.visibleWhen && !descriptor.visibleWhen(scope)) return;

	const commit = async (value: unknown) => {
		await scope.set(descriptor.key, value);
		if (descriptor.rerenderOnChange) rerender();
	};

	switch (descriptor.type) {
		case "toggle":
			new Setting(container)
				.setName(descriptor.name)
				.setDesc(descriptor.desc ?? "")
				.addToggle((t) =>
					t
						.setValue(scope.get(descriptor.key, descriptor.default))
						.onChange(commit),
				);
			break;

		case "text":
			new Setting(container)
				.setName(descriptor.name)
				.setDesc(descriptor.desc ?? "")
				.addText((t) => {
					t.setPlaceholder(descriptor.placeholder ?? "")
						.setValue(scope.get(descriptor.key, descriptor.default))
						.onChange(commit);
					if (descriptor.secret) t.inputEl.type = "password";
				});
			break;

		case "file":
		case "folder":
			addPathSetting(app, container, {
				name: descriptor.name,
				desc: descriptor.desc ?? "",
				placeholder: descriptor.placeholder ?? "",
				value: scope.get(descriptor.key, descriptor.default),
				type: descriptor.type,
				extensions:
					descriptor.type === "file" ? descriptor.extensions : undefined,
				onChange: commit,
			});
			break;

		case "dropdown":
			new Setting(container)
				.setName(descriptor.name)
				.setDesc(descriptor.desc ?? "")
				.addDropdown((d) =>
					d
						.addOptions(descriptor.options)
						.setValue(scope.get(descriptor.key, descriptor.default))
						.onChange(commit),
				);
			break;

		case "button":
			new Setting(container)
				.setName(descriptor.name)
				.setDesc(descriptor.desc ?? "")
				.addButton((b) => {
					b.setButtonText(descriptor.buttonText).onClick(() =>
						descriptor.onClick(scope),
					);
					if (descriptor.cta) b.setCta();
				});
			break;

		case "info": {
			const el = container.createDiv({ cls: "scout-setting-info" });
			descriptor.render(el);
			break;
		}
	}
}
