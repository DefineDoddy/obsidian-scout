import { App, Modal } from "obsidian";

/**
 * A yes/no dialog in Obsidian's own chrome.
 *
 * `window.confirm` would do the job but looks like a browser alert in the
 * middle of the app, and is blocked outright in some mobile webviews.
 */
export function confirmModal(
	app: App,
	options: {
		title: string;
		body: string;
		confirmText: string;
		danger?: boolean;
	},
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, options, resolve).open();
	});
}

/**
 * One line of text, in the same chrome.
 *
 * For naming things — a view, a collection — where sending the user to a
 * settings dialog to type six characters would be the longer way round.
 * Resolves null when dismissed, which is not the same as an empty answer.
 */
export function promptModal(
	app: App,
	options: {
		title: string;
		placeholder?: string;
		value?: string;
		confirmText: string;
	},
): Promise<string | null> {
	return new Promise((resolve) => {
		new PromptModal(app, options, resolve).open();
	});
}

class PromptModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly options: {
			title: string;
			placeholder?: string;
			value?: string;
			confirmText: string;
		},
		private readonly respond: (value: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		const input = this.contentEl.createEl("input", {
			type: "text",
			cls: "scout-prompt-input",
		});
		input.placeholder = this.options.placeholder ?? "";
		input.value = this.options.value ?? "";

		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.onclick = () => this.answer(null);

		const confirm = row.createEl("button", { text: this.options.confirmText });
		confirm.addClass("mod-cta");
		confirm.onclick = () => this.answer(input.value.trim() || null);

		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") this.answer(input.value.trim() || null);
		});
		input.focus();
		input.select();
	}

	private answer(value: string | null): void {
		this.answered = true;
		this.respond(value);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.respond(null);
	}
}

class ConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly options: {
			title: string;
			body: string;
			confirmText: string;
			danger?: boolean;
		},
		private readonly respond: (value: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl("p", { text: this.options.body });

		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.onclick = () => this.answer(false);

		const confirm = row.createEl("button", {
			text: this.options.confirmText,
		});
		confirm.addClass(this.options.danger ? "mod-warning" : "mod-cta");
		confirm.onclick = () => this.answer(true);
		confirm.focus();
	}

	private answer(value: boolean): void {
		this.answered = true;
		this.respond(value);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		// Dismissing without choosing means "no".
		if (!this.answered) this.respond(false);
	}
}
