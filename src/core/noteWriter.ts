import { App, Modal, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { sanitizeFileName } from "./paths";

/**
 * Everything to do with turning rendered content into a note on disk.
 *
 * Previously this was inlined in each modal's click handler, which is why
 * missing folders and duplicate filenames both surfaced as a raw exception.
 */

export type CollisionPolicy = "prompt" | "open" | "overwrite" | "increment";


/** Creates a folder and any missing parents. No-op if it already exists. */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const path = normalizePath(folderPath);
	if (!path || path === "/" || path === ".") return;

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing instanceof TFile) {
		throw new Error(`"${path}" is a file, not a folder`);
	}

	try {
		await app.vault.createFolder(path);
	} catch (err) {
		// Another call may have created it in the meantime; only rethrow if it
		// genuinely is not there.
		if (!(app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw err;
	}
}

/** Appends " 2", " 3"… until the path is free. */
function uniquePath(app: App, folder: string, base: string): string {
	let candidate = normalizePath(`${folder}/${base}.md`);
	let counter = 2;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${folder}/${base} ${counter}.md`);
		counter++;
	}
	return candidate;
}

export interface WriteRequest {
	folder: string;
	title: string;
	content: string;
	policy: CollisionPolicy;
	/** Reveal the note in the workspace after writing. */
	openAfterCreate: boolean;
}

export interface WriteOutcome {
	file: TFile;
	action: "created" | "overwritten" | "opened-existing";
}

export class NoteWriter {
	constructor(private readonly app: App) {}

	async write(request: WriteRequest): Promise<WriteOutcome | null> {
		const { folder, title, content, policy } = request;
		if (!folder) throw new Error("No output folder configured");

		await ensureFolder(this.app, folder);

		const base = sanitizeFileName(title);
		const target = normalizePath(`${folder}/${base}.md`);
		const existing = this.app.vault.getAbstractFileByPath(target);

		let outcome: WriteOutcome;

		if (existing instanceof TFile) {
			const resolved =
				policy === "prompt" ? await this.askPolicy(base) : policy;
			if (resolved === null) return null;

			switch (resolved) {
				case "open":
					outcome = { file: existing, action: "opened-existing" };
					break;
				case "overwrite":
					await this.app.vault.modify(existing, content);
					outcome = { file: existing, action: "overwritten" };
					break;
				default: {
					const path = uniquePath(this.app, folder, base);
					const file = await this.app.vault.create(path, content);
					outcome = { file, action: "created" };
				}
			}
		} else {
			const file = await this.app.vault.create(target, content);
			outcome = { file, action: "created" };
		}

		if (request.openAfterCreate) {
			await this.app.workspace.getLeaf(false).openFile(outcome.file);
		}
		return outcome;
	}

	/** Asks what to do about an existing note. Resolves null if dismissed. */
	private askPolicy(
		base: string,
	): Promise<Exclude<CollisionPolicy, "prompt"> | null> {
		return new Promise((resolve) => {
			new CollisionModal(this.app, base, resolve).open();
		});
	}
}

type CollisionChoice = Exclude<CollisionPolicy, "prompt"> | null;

/** Presented when a note of the same name already exists in the folder. */
class CollisionModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly base: string,
		private readonly respond: (choice: CollisionChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Note already exists");
		this.contentEl.createEl("p", {
			text: `"${this.base}" already exists in this folder. What would you like to do?`,
		});

		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const choose = (
			value: Exclude<CollisionPolicy, "prompt">,
			label: string,
			cta = false,
		) => {
			const btn = row.createEl("button", { text: label });
			if (cta) btn.addClass("mod-cta");
			btn.onclick = () => {
				this.answered = true;
				this.respond(value);
				this.close();
			};
		};

		choose("open", "Open existing", true);
		choose("increment", "Create a copy");
		choose("overwrite", "Overwrite");
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.respond(null);
	}
}

/** Consistent user feedback for a write outcome. */
export function noticeForOutcome(outcome: WriteOutcome): void {
	const name = outcome.file.basename;
	const message =
		outcome.action === "created"
			? `Created "${name}"`
			: outcome.action === "overwritten"
				? `Updated "${name}"`
				: `Opened existing "${name}"`;
	new Notice(message);
}
