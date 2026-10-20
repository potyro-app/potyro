import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { packApp } from "./library-demos";

// apps/poster-event (Poster to Calendar), packed as its build packs it and added from this device —
// SHARED, so it runs sealed in the browser realm the way a friend's copy does, asks before the camera
// and before the AI, and draws every screen with built-in views. A photo goes in; the checked event
// comes out on Coming up with its reminder, in the calendar, as a .ics file, and in the share sheet.
//
// OpenRouter is a mocked route: no real model is called, nothing is spent. The answer is built from
// today, so the poster's "Fri 20 Nov" is always ahead, whatever day the suite runs.

const PHOTO = readFileSync(new URL("./fixtures/garden-flower.png", import.meta.url));
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw", viewport: { width: 420, height: 860 } });

/** The first Friday at least five weeks out, at local midnight — what the mocked poster prints. */
function posterDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 35);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return d;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const en = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", ...o }).format(d);
const dayText = (d: Date) => en(d, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });

/** Add a packed app from this device; `mine: false` leaves "I wrote this" unticked, so it runs sealed. */
async function addPackage(page: Page, zip: Buffer, mine: boolean): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name: "poster-event.potyro-app.zip", mimeType: "application/zip", buffer: zip });
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  if (mine) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 60_000 });
}

test("a shared copy reads a poster: camera and AI asked first, the checked event saved with its reminder, in the calendar, as a .ics, and shared", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: .*404/, "the free AI relay is not deployed in this test: its /ai/health and /ai/complete answer 404, as on a site without it");
  const day = posterDay();
  const answer = {
    legible: true,
    events: [
      {
        title: "Night Tram Quartet",
        dateText: en(day, { weekday: "short", day: "numeric", month: "short" }),
        date: iso(day),
        endDate: null,
        yearPrinted: false,
        start: "8pm",
        end: null,
        doors: "Doors 19:00",
        timezone: null,
        venue: "The Lantern Room",
        address: "12 Harbour Lane",
        price: "12 € / 8 € students",
        link: "lanternroom.example/tickets",
        description: "Live jazz on the last tram line.",
      },
    ],
  };
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-test-key" }));
    } catch {
      // the realm's frame has no storage, and needs none of this
    }
    const w = window as unknown as { __shared?: unknown[]; showSaveFilePicker?: unknown };
    // The <a download> path, so the file can be caught; and the phone's share sheet, recorded.
    delete w.showSaveFilePicker;
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: async (data: unknown) => {
        (w.__shared ??= []).push(data);
      },
    });
  });
  await page.route("**/ai/health", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route("**/ai/complete", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route(OPENROUTER, async (route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { cost: 0.0003 } }) });
  });

  await addPackage(page, packApp("poster-event", "poster-event.app.ts"), false);

  // The first open says what it does in one line, and offers the sample.
  await expect(page.getByText("Photograph a poster, flyer or ticket: it becomes an event with a reminder. Try the sample first under “Read a poster”.")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Read a poster/ }).click();
  const sheet = page.getByRole("menu", { name: "Read a poster" });
  await expect(sheet.getByRole("menuitem", { name: "Try it on a sample poster A made-up poster, read without AI — nothing is sent" })).toBeVisible();
  await sheet.getByRole("menuitem", { name: /^Choose a photo/ }).click();

  // Sealed: the camera is asked for first. The wait starts before Allow: the picker opens at once.
  const camera = page.locator(".k-dialog", { hasText: "Allow “Poster to Calendar” to use the camera?" });
  await expect(camera).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await camera.getByRole("button", { name: "Confirm" }).click();
  await (await chooser).setFiles({ name: "poster.png", mimeType: "image/png", buffer: PHOTO });

  // Then the AI, naming the service, before anything is sent.
  const consent = page.locator(".k-dialog", { hasText: "wants to send a photo to an AI service" });
  await expect(consent).toContainText("“Poster to Calendar” wants to send a photo to an AI service (OpenRouter) to read it.");
  expect(sent).toEqual([]);
  await consent.getByRole("button", { name: "Allow" }).click();

  // The editable card: what was read, normalised — 8pm is 20:00, the doors kept apart, the link a link.
  const form = page.getByRole("dialog", { name: "Check the event" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form.getByLabel("What")).toHaveValue("Night Tram Quartet");
  await expect(form.getByLabel("Doors open")).toHaveValue("19:00");
  await expect(form.getByLabel("Venue")).toHaveValue("The Lantern Room");
  await expect(form.getByLabel("Tickets or website")).toHaveValue("https://lanternroom.example/tickets");
  // The person corrects the name before saving: what is saved is theirs.
  await form.getByLabel("What").fill("Night Tram Quartet — late show");
  await form.getByRole("button", { name: "Save event" }).click();

  // The event's page: when, doors, and the reminder as it will happen.
  const reminderDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, 20, 0);
  await expect(page.getByText("Night Tram Quartet — late show").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`${dayText(day)}, 20:00`, { exact: true })).toBeVisible();
  await expect(page.locator(".k-field", { hasText: "Doors open" })).toHaveText("Doors open19:00");
  await expect(page.locator(".k-field", { hasText: "Reminder" })).toHaveText(`Reminder${dayText(reminderDay)}, 20:00`);
  await expect(page.getByText(`Saved. Reminder: ${dayText(reminderDay)}, 20:00.`)).toBeVisible();

  // What went to the AI: the photo and the app's instructions, one request, the person's own key.
  expect(sent).toHaveLength(1);
  const user = (sent[0]!.body.messages as Array<{ content: unknown }>)[1]!.content as Array<{ type: string; text?: string }>;
  expect(user.map((p) => p.type)).toEqual(["text", "image_url"]);
  expect(user[0]!.text).toContain("A photo of a poster, flyer, ticket or invitation");
  expect(JSON.stringify(sent[0]!.body)).not.toContain("late show");

  // Add to my calendar: a real .ics, in UTC, with its alarm.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to my calendar" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`night-tram-quartet-late-show-${iso(day).replace(/-/g, "")}.ics`);
  const ics = readFileSync((await file.path())!, "utf8");
  // The page's clock is Europe/Warsaw (test.use above), whatever zone this runner is in (UTC on CI):
  // 20:00 on the poster is 20:00 Warsaw, and the file says that instant in UTC.
  const inWarsaw = (y: number, m: number, d: number, h: number): Date => {
    const asUtc = Date.UTC(y, m, d, h, 0);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(asUtc));
    const get = (t: string) => Number(parts.find((x) => x.type === t)!.value);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    return new Date(asUtc - (wall - asUtc));
  };
  const start = inWarsaw(day.getFullYear(), day.getMonth(), day.getDate(), 20);
  const reminderAt = inWarsaw(day.getFullYear(), day.getMonth(), day.getDate() - 1, 20);
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  expect(ics).toContain("SUMMARY:Night Tram Quartet — late show\r\n");
  expect(ics).toContain(`DTSTART:${utc(start)}\r\n`);
  expect(ics).toContain("LOCATION:The Lantern Room\\, 12 Harbour Lane\r\n");
  expect(ics).toContain(`TRIGGER;VALUE=DATE-TIME:${utc(reminderAt)}\r\n`);
  expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  await expect(page.getByText("Open the file to add it to your calendar.")).toBeVisible();

  // Share with friends: the share dialog shows what will go, then the phone's share sheet gets the
  // event in a few lines, and its link.
  await page.getByRole("button", { name: "Share with friends" }).click();
  const text = `Night Tram Quartet — late show\n${dayText(day)}, 20:00 · Doors 19:00\nThe Lantern Room, 12 Harbour Lane\n12 € / 8 € students`;
  const shareSheet = page.getByRole("dialog", { name: "Night Tram Quartet — late show" });
  await expect(shareSheet.getByRole("textbox", { name: "What will be sent" })).toHaveValue(`${text}\nhttps://lanternroom.example/tickets`);
  await shareSheet.getByRole("button", { name: "Share…" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown[] }).__shared ?? [])).toEqual([{ text, url: "https://lanternroom.example/tickets" }]);
  await expect(shareSheet).toHaveCount(0);

  // Coming up: under its month (a heading a sealed app's own function names), with its day and venue,
  // and the poster's thumbnail. The calendar has it on its day.
  const tabs = page.getByRole("navigation", { name: "Pages" });
  await tabs.getByRole("button", { name: "Coming up" }).click();
  const row = page.getByRole("main").getByText("Night Tram Quartet — late show");
  await expect(row).toBeVisible();
  await expect(page.getByRole("main").getByText(`${dayText(day)}, 20:00 · The Lantern Room`)).toBeVisible();
  await expect(page.getByRole("main").locator("img.k-lead-photo")).toHaveCount(1);
  await expect(page.getByRole("main").getByText(en(day, { month: "long", ...(day.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }), { exact: true })).toBeVisible();
  await tabs.getByRole("button", { name: "Calendar" }).click();
  const now = new Date();
  for (let m = (day.getFullYear() - now.getFullYear()) * 12 + day.getMonth() - now.getMonth(); m > 0; m--) await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("region", { name: `Calendar — ${en(day, { month: "long", year: "numeric" })}` }).getByText("Night Tram Quartet — late show")).toBeAttached();
});

test("the sample poster works with no key at all, and says it is a sample", async ({ page }) => {
  const asked: string[] = [];
  await page.addInitScript(() => {
    // A desktop browser with no share sheet.
    Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
  });
  page.on("request", (r) => {
    if (r.url().startsWith("https://openrouter.ai/") || r.url().includes("/ai/")) asked.push(r.url());
  });
  await addPackage(page, packApp("poster-event", "poster-event.app.ts"), true);
  await page.getByRole("button", { name: /Read a poster/ }).click();
  await page.getByRole("menu", { name: "Read a poster" }).getByRole("menuitem", { name: /^Try it on a sample poster/ }).click();
  const form = page.getByRole("dialog", { name: "Sample poster — check the event" });
  await expect(form).toBeVisible({ timeout: 20_000 });
  await expect(form.getByLabel("What")).toHaveValue("Night Tram Quartet");
  await expect(form.getByLabel("About it")).toHaveValue(/^A sample event, made up to show how this app works/);
  await form.getByRole("button", { name: "Save event" }).click();
  await expect(page.getByText(/^Saved\. Reminder: /)).toBeVisible({ timeout: 20_000 });
  // The poster itself is on the event's page, and it says SAMPLE across its top.
  const poster = page.locator("img").filter({ has: page.locator("xpath=.") }).first();
  await expect(poster).toBeVisible();
  const svg = await poster.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text());
  expect(svg).toContain("SAMPLE POSTER");
  expect(asked).toEqual([]);

  // Without navigator.share (a desktop browser), Share with friends is the share dialog with Copy.
  await page.getByRole("button", { name: "Share with friends" }).click();
  const share = page.getByRole("dialog", { name: "Night Tram Quartet" });
  await expect(share.getByRole("textbox", { name: "What will be sent" })).toHaveValue(/^Night Tram Quartet\n.*20:00 · Doors 19:00\nThe Lantern Room, 12 Harbour Lane/);
  await expect(share.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  await expect(share.getByRole("button", { name: "Share…" })).toHaveCount(0);
});
