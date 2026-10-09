import { test, expect, type Route } from "@playwright/test";

// Ask changing records the person already has (#213), with the model stubbed. The model never sees
// the records: it names them as the person did, and the device finds them. One name finds one record
// (ticked, approved), one finds two (the person picks), one finds none (said so). Each change shows
// what the field holds now next to what it would hold, and nothing is written until approved.

const APP_ID = "lifts";
const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "${APP_ID}", name: "Lifts", version: "1.0.0", schemaVersion: 1,
  entities: { exercise: { label: "Exercise", displayField: "name", fields: {
    name: { type: "text", required: true },
    sets: { type: "number" },
  } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "exercise", display: { primary: "name", secondary: (e) => (e.sets ? e.sets + " sets" : "") } } }],
});
`;

const call = (name: string, args: unknown) => ({ content: "", tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

const ADD = call("propose_records", {
  summary: "Three exercises.",
  rows: [
    { entity: "exercise", ref: "b", values: { name: "Bench Press", sets: 3 } },
    { entity: "exercise", ref: "s1", values: { name: "Squat", sets: 5 } },
    { entity: "exercise", ref: "s2", values: { name: "Squat", sets: 4 } },
  ],
});

const EDIT = call("propose_records", {
  summary: "Changed the sets.",
  rows: [],
  edits: [
    { entity: "exercise", match: "bench press", set: { sets: 4 } },
    { entity: "exercise", match: "squat", set: { sets: 3 } },
    { entity: "exercise", match: "deadlift", set: { sets: 5 } },
  ],
});

async function stubModel(route: Route): Promise<void> {
  const body = JSON.parse(route.request().postData() ?? "{}") as { tools?: Array<{ function?: { name?: string } }>; messages: Array<{ role: string; content: string }> };
  const tools = (body.tools ?? []).map((t) => t.function?.name);
  const asked = body.messages.find((m) => m.role === "user")?.content ?? "";
  const message = tools.includes("verdicts")
    ? call("verdicts", { verdicts: [] })
    : String(body.messages[0]?.content).startsWith("Search the web for each")
      ? { content: "done" }
      : asked.startsWith("set ")
        ? EDIT
        : ADD;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source, id]) => {
      if (!localStorage.getItem("potyro:user-apps")) localStorage.setItem("potyro:user-apps", JSON.stringify([{ id, name: "Lifts", source, trusted: true, updatedAt: new Date().toISOString() }]));
      sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-stub", openrouterModel: "deepseek/deepseek-v4-flash-0731" }));
      localStorage.removeItem("potyro:ask-review-layout");
    },
    [SOURCE, APP_ID],
  );
});

test("Ask changes records the person names, showing each value now and after", async ({ page }) => {
  await page.route("**/openrouter.ai/**", stubModel);
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText("Lifts");

  const askFor = async (text: string) => {
    await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
    const dialog = page.getByRole("dialog", { name: "Ask Lifts" });
    await dialog.getByRole("textbox", { name: "What to add" }).fill(text);
    await dialog.getByRole("button", { name: "Ask", exact: true }).click();
    return dialog;
  };

  // Records to change, added the ordinary way.
  let dialog = await askFor("add bench press and two squats");
  await expect(dialog.getByText("Three exercises.")).toBeVisible();
  await dialog.locator(".k-ask-card", { hasText: "Squat" }).getByRole("button", { name: "Approve Squat" }).evaluateAll((els) => els.forEach((b) => (b as HTMLButtonElement).click()));
  await dialog.locator(".k-ask-card", { hasText: "Bench Press" }).getByRole("button", { name: "Approve Bench Press" }).click();
  await dialog.getByRole("button", { name: "Add 3" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  const rows = page.locator(".k-list-row");
  await expect(rows).toHaveCount(3);

  dialog = await askFor("set bench press to 4 sets, squat to 3 and deadlift to 5");
  await expect(dialog.getByText("Changed the sets.")).toBeVisible();
  const changes = dialog.getByRole("region", { name: "Changes" });
  // By title: each card also quotes the request, which names all of them.
  const card = (title: string) => changes.locator(".k-ask-card").filter({ has: page.locator(".k-ask-card-title", { hasText: title }) });

  // One record by that name: found, ticked, approved; the field as it is now, then as it would be.
  const bench = card("Bench Press");
  await expect(bench.locator(".k-ask-before")).toHaveText("3");
  await expect(bench.locator(".k-ask-value-text")).toHaveText("4");
  await expect(bench.locator(".k-ask-badge")).toHaveText("From what you asked");
  await expect(bench.getByRole("button", { name: "Approve Bench Press" })).toHaveAttribute("aria-pressed", "true");

  // Two records by that name: neither is picked for the person.
  const squat = card("squat");
  await expect(squat.getByRole("checkbox")).toHaveCount(2);
  // Told apart by what the change would replace.
  await expect(squat.locator(".k-ask-target")).toHaveText(["Squat · Sets 5", "Squat · Sets 4"]);
  await expect(squat.locator(".k-ask-held")).toContainText("More than one exercise is called “squat”");

  // None: said plainly, and nothing to approve.
  await expect(card("deadlift").locator(".k-ask-held")).toHaveText("No exercise called “deadlift”.");

  await expect(dialog.getByRole("button", { name: "Change 1" })).toBeVisible();
  // Picking one of the two squats approves that change.
  await squat.getByRole("checkbox").first().check();
  await dialog.getByRole("button", { name: "Change 2" }).click();
  await expect(dialog.getByText("Changed 2 records.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  // Changed in place: still three records, nothing added.
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Bench Press" })).toContainText("4 sets");
  // Only the squat the person picked: one now has 3 sets, the other kept its own.
  await expect(rows.filter({ hasText: "Squat" })).toHaveCount(2);
  await expect(rows.filter({ hasText: "Squat" }).filter({ hasText: "3 sets" })).toHaveCount(1);
});
