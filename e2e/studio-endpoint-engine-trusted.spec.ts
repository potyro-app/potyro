import { test, expect } from "./console-guard";
import { ask, openFromCard, openNewStudio } from "./studio-helpers.js";

// An app made against an OpenAI-compatible endpoint (#121), end to end: the person names a server
// by its address, tests the connection, and the create loop runs against it. The server here is
// scripted. What must hold is that the requests carry none of OpenRouter's own fields or headers —
// OpenAI answers an unknown field with a 400 — and no key when none was given, as Ollama wants.

const BASE = "http://llm.test/v1";
const app = `import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", label: "Title", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});`;

type Sent = { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> | null };

test("an app made against an OpenAI-compatible endpoint, with none of OpenRouter's fields", async ({ page }) => {
  const sent: Sent[] = [];
  await page.route("**/openrouter.ai/**", (route) => route.abort());
  await page.route(`${BASE}/**`, async (route) => {
    const req = route.request();
    sent.push({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.method() === "POST" ? (req.postDataJSON() as Record<string, unknown>) : null });
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith("/models")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ object: "list", data: [{ id: "local-coder", object: "model" }] }) });
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "```ts\n" + app + "\n```" }, finish_reason: "stop" }] }),
    });
  });

  const studio = await openNewStudio(page);
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenAI-compatible endpoint/ }).check();
  await modal.getByLabel("Endpoint address").fill(BASE);
  await modal.getByLabel("Endpoint model").fill("local-coder");
  await modal.getByRole("button", { name: "Test connection" }).click();
  await expect(modal.getByRole("status")).toHaveText("Connected. The server lists 1 model.");
  await modal.getByRole("button", { name: "Close model settings" }).click();
  await expect(studio.getByRole("button", { name: "Model settings" })).toContainText("local-coder");

  await ask(studio, "a reading tracker for my books");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  const models = sent.filter((s) => s.method === "GET");
  expect(models.map((s) => s.url)).toEqual([`${BASE}/models`]);
  const posts = sent.filter((s) => s.method === "POST");
  expect(posts.length).toBeGreaterThan(0);
  for (const p of posts) {
    expect(p.url).toBe(`${BASE}/chat/completions`);
    expect(p.body!.model).toBe("local-coder");
    // The create loop's tools go out as plain function tools; none of OpenRouter's fields do.
    expect(p.body!.tools).toBeDefined();
    for (const field of ["provider", "reasoning", "max_tokens"]) expect(p.body!).not.toHaveProperty(field);
    for (const header of ["x-title", "http-referer", "authorization"]) expect(p.headers).not.toHaveProperty(header);
  }
});

test("a model that takes no tools still makes the app, in one plain turn, and the next request skips the loop", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: .*400/, "the scripted server refuses a request with tools, as Ollama does for a model without tool support");
  const posts: Array<Record<string, unknown>> = [];
  await page.route("**/openrouter.ai/**", (route) => route.abort());
  await page.route(`${BASE}/**`, async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON() as Record<string, unknown>;
    posts.push(body);
    // Ollama's own words for llama3, with its status.
    if (body.tools) {
      return route.fulfill({ status: 400, headers: cors, contentType: "application/json", body: JSON.stringify({ error: { message: "registry.ollama.ai/library/llama3:latest does not support tools", type: "api_error" } }) });
    }
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      // The first plain turn makes the app; the next one changes its name.
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "```ts\n" + (posts.filter((p) => !p.tools).length > 1 ? app.replace('name: "Reader"', 'name: "Library"') : app) + "\n```" }, finish_reason: "stop" }] }),
    });
  });

  const studio = await openNewStudio(page);
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenAI-compatible endpoint/ }).check();
  await modal.getByLabel("Endpoint address").fill(BASE);
  await modal.getByLabel("Endpoint model").fill("llama3");
  await modal.getByRole("button", { name: "Close model settings" }).click();

  await ask(studio, "a reading tracker for my books");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  // One refused request with tools, then the one plain turn that made the app.
  expect(posts.filter((p) => p.tools)).toHaveLength(1);
  expect(posts.filter((p) => !p.tools)).toHaveLength(1);

  // A change: the session knows this model takes no tools, so it goes straight to one plain turn.
  await ask(studio, "call it Library");
  await expect(preview.locator("h1").first()).toHaveText("Library", { timeout: 60_000 });
  expect(posts.filter((p) => p.tools)).toHaveLength(1);
  expect(posts.filter((p) => !p.tools)).toHaveLength(2);
});
