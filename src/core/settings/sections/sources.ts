import { Setting } from "obsidian";
import { MEDIA_KIND_LABELS } from "../../types";
import { renderDescriptor } from "../controls";
import type { SettingsSection } from "./types";

/** One block per registered provider, built from what the provider declares. */
export const sourcesSection: SettingsSection = {
	id: "sources",
	label: "Sources",
	icon: "globe",
	intro: "Where metadata comes from. Scout only contacts a source when you search or resolve a link.",

	render(container, { app, settings, registry, rerender }) {
		for (const provider of registry.all()) {
			const scope = settings.scopeFor(provider.id);
			const enabled = settings.isProviderEnabled(provider.id);

			new Setting(container)
				.setName(provider.name)
				.setDesc(provider.kinds.map((k) => MEDIA_KIND_LABELS[k]).join(", "))
				.addToggle((t) =>
					t.setValue(enabled).onChange(async (v) => {
						await scope.set("enabled", v);
						rerender();
					}),
				);

			if (!enabled) continue;

			const body = container.createDiv({ cls: "scout-provider-settings" });
			for (const descriptor of provider.settingsSchema()) {
				renderDescriptor(app, body, descriptor, scope, rerender);
			}

			if (!provider.isConfigured()) {
				body.createEl("p", {
					text: `${provider.name} needs more configuration before it can be used.`,
					cls: "scout-setting-warning",
				});
			}
		}
	},
};
