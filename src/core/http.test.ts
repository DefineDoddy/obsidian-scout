import { describe, expect, it } from "vitest";
import { HttpError } from "./http";

/**
 * A failed request has to say what actually went wrong.
 *
 * GraphQL answers 400 and puts its real complaint in the body, so an AniList
 * failure surfaced as "HTTP 400 for https://graphql.anilist.co" — a sentence
 * naming the one thing the reader already knows and hiding the one thing they
 * need to act on.
 */
describe("HttpError", () => {
	it("says what a GraphQL source complained about", () => {
		const err = new HttpError(
			400,
			"https://graphql.anilist.co",
			JSON.stringify({ errors: [{ message: "Too Many Requests" }] }),
		);
		expect(err.message).toContain("Too Many Requests");
		expect(err.message).toContain("400");
	});

	it("says what TMDB complained about", () => {
		const err = new HttpError(
			401,
			"https://api.themoviedb.org/3/movie/1",
			JSON.stringify({ status_message: "Invalid API key." }),
		);
		expect(err.message).toContain("Invalid API key.");
	});

	it("falls back to the status and the address when the body says nothing", () => {
		expect(new HttpError(500, "https://example.com", "").message).toBe(
			"HTTP 500 for https://example.com",
		);
	});

	it("is not confused by a body that is not JSON at all", () => {
		const err = new HttpError(502, "https://example.com", "<html>nope</html>");
		expect(err.message).toBe("HTTP 502 for https://example.com");
	});

	it("keeps the body for anyone who wants more than the sentence", () => {
		const err = new HttpError(400, "https://example.com", '{"message":"no"}');
		expect(err.body).toBe('{"message":"no"}');
		expect(err.status).toBe(400);
	});
});
