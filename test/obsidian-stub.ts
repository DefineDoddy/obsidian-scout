/**
 * Minimal stand-in for the `obsidian` module.
 *
 * The real package ships only type definitions — there is no runtime entry
 * point outside the app — so anything imported into a test needs this. Only
 * the members the core layer actually touches are stubbed; the pure modules
 * (template engine, paths, registry) should not need any of it.
 */

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class Notice {
	constructor(readonly message: string) {}
}

export class TFile {
	path = "";
	basename = "";
	extension = "md";
}

export class TFolder {
	path = "";
}

export class Modal {
	contentEl = null as unknown as HTMLElement;
	titleEl = null as unknown as HTMLElement;
	open(): void {}
	close(): void {}
}

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class FuzzySuggestModal {}

export async function requestUrl(): Promise<never> {
	throw new Error("requestUrl is not available in tests — stub it per-test");
}

export function setIcon(): void {}
