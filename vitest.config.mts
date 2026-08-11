import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			// The real `obsidian` package is types-only and has no runtime entry.
			// Resolved through `fileURLToPath`, not `URL.pathname`: on Windows the
			// latter yields "/C:/…", which Vite cannot open.
			obsidian: fileURLToPath(
				new URL("./test/obsidian-stub.ts", import.meta.url),
			),
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
	},
});
