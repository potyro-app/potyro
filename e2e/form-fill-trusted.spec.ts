import { test, expect, type Locator, type Page } from "./console-guard";
import { packApp } from "./library-demos";

// A form's fill button (#81, docs/04 §A button that fills the form): "Read a poster" at the head of
// Poster to Calendar's own event form. The app's function returns values; the FORM decides what
// becomes of them — an empty field is filled, a field the person filled is never replaced without
// asking, nothing is saved until they save.
//
// The sample poster is the path driven here: it is read by its fixture, so no camera, no AI and no
// network are involved, and the same spec holds for the person's own copy (run directly) and for a
// shared one (sealed in the browser realm, where what the app returns crosses a port and is checked
// by the host before the form sees it).

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw" });

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

/** The form for a new event: from the empty page's own button, or the app's "Type one in". */
async function newEvent(page: Page): Promise<Locator> {
  const first = page.getByRole("button", { name: "Add the first one" });
  const typeIn = page.getByRole("button", { name: "Type one in" });
  await first.or(typeIn).first().click();
  const form = page.getByRole("dialog", { name: "Add: Event" });
  await expect(form).toBeVisible();
  return form;
}

/** Press the form's fill button and take the sample poster. */
async function readSample(page: Page, form: Locator): Promise<void> {
  await form.getByRole("button", { name: /^Read a poster/ }).click();
  await page.getByRole("menu", { name: "Read a poster" }).getByRole("menuitem", { name: /^Try it on a sample poster/ }).click();
}

const review = (form: Locator): Locator => form.getByRole("group", { name: "Replace what you entered?" });

for (const mine of [true, false]) {
  const how = mine ? "my own copy" : "a shared copy, sealed";

  test(`${how}: an empty form is filled from the poster, nothing is saved until Create`, async ({ page }) => {
    await addPackage(page, packApp("poster-event", "poster-event.app.ts"), mine);
    const form = await newEvent(page);

    // The button leads the form, with its one line of what it does.
    const fill = form.locator("[data-k-form-fill]");
    await expect(fill.getByRole("button", { name: /^Read a poster/ })).toBeVisible();
    await expect(fill.getByText("Fills this in from a photo of a poster, flyer or ticket")).toBeVisible();
    // The first field still takes the focus: the button is one Shift+Tab away, not in the way.
    await expect(form.getByLabel("What")).toBeFocused();

    await readSample(page, form);
    await expect(form.getByLabel("What")).toHaveValue("Night Tram Quartet", { timeout: 20_000 });
    await expect(form.getByLabel("Venue")).toHaveValue("The Lantern Room");
    await expect(form.getByLabel("Address")).toHaveValue("12 Harbour Lane");
    await expect(form.getByLabel("Doors open")).toHaveValue("19:00");
    await expect(fill.getByRole("status")).toContainText(/^Filled in: What, Starts/);
    // Nothing was the person's, so nothing is asked.
    await expect(review(form)).toHaveCount(0);
    // The reminder is the person's choice, never the poster's: it keeps its default.
    await expect(form.getByText("1 day before")).toBeVisible();

    // Not saved yet: the list behind the form is still empty.
    await expect(page.locator(".k-list-row")).toHaveCount(0);
    await form.getByRole("button", { name: "Create" }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText("Night Tram Quartet").first()).toBeVisible({ timeout: 20_000 });
  });

  test(`${how}: what the person typed is theirs — equal values are not mentioned, different ones are asked about`, async ({ page }) => {
    await addPackage(page, packApp("poster-event", "poster-event.app.ts"), mine);
    const form = await newEvent(page);
    const fill = form.locator("[data-k-form-fill]");
    await form.getByLabel("What").fill("My friend's gig");
    await form.getByLabel("Venue").fill("The Lantern Room"); // what the poster says too
    await form.getByLabel("Price").fill("Free");

    await readSample(page, form);
    const asked = review(form);
    await expect(asked).toBeVisible({ timeout: 20_000 });
    // Typed values are untouched while the question stands; the empty fields were filled meanwhile.
    await expect(form.getByLabel("What")).toHaveValue("My friend's gig");
    await expect(form.getByLabel("Price")).toHaveValue("Free");
    await expect(form.getByLabel("Address")).toHaveValue("12 Harbour Lane");
    // Two fields differ; the venue, typed the same as the poster prints it, is not listed.
    await expect(asked.getByRole("group")).toHaveCount(2);
    await expect(asked.getByRole("group", { name: "What" })).toContainText("My friend's gig");
    await expect(asked.getByRole("group", { name: "What" })).toContainText("Night Tram Quartet");
    await expect(asked.getByRole("group", { name: "Price" })).toBeVisible();
    await expect(asked.getByRole("group", { name: "Venue" })).toHaveCount(0);
    // Theirs is the default on every field, and "Use selected" waits for a choice.
    await expect(asked.getByRole("group", { name: "What" }).getByRole("radio", { name: /^Yours/ })).toBeChecked();
    await expect(asked.getByRole("button", { name: "Use selected" })).toBeDisabled();

    // Field by field: the poster's title, my own price.
    await asked.getByRole("group", { name: "What" }).getByRole("radio", { name: /^New/ }).check();
    await asked.getByRole("button", { name: "Use selected" }).click();
    await expect(asked).toHaveCount(0);
    await expect(form.getByLabel("What")).toHaveValue("Night Tram Quartet");
    await expect(form.getByLabel("Price")).toHaveValue("Free");
    // The focus goes back to the button the answer came from.
    await expect(fill.getByRole("button", { name: /^Read a poster/ })).toBeFocused();

    // Again: only the price still differs, and "Keep mine" leaves it.
    await readSample(page, form);
    await expect(review(form).getByRole("group")).toHaveCount(1, { timeout: 20_000 });
    await review(form).getByRole("button", { name: "Keep mine" }).click();
    await expect(form.getByLabel("Price")).toHaveValue("Free");

    await form.getByRole("button", { name: "Create" }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText("Night Tram Quartet").first()).toBeVisible({ timeout: 20_000 });
  });

  test(`${how}: on the edit form a saved value is asked about, and the record changes only on Save changes`, async ({ page }) => {
    await addPackage(page, packApp("poster-event", "poster-event.app.ts"), mine);
    const add = await newEvent(page);
    await add.getByLabel("What").fill("Placeholder night");
    await readSample(page, add);
    await expect(review(add)).toBeVisible({ timeout: 20_000 });
    await review(add).getByRole("button", { name: "Keep mine" }).click();
    await add.getByRole("button", { name: "Create" }).click();
    await expect(add).toHaveCount(0);

    // Its page, then Edit: the same form, the same button.
    const heading = page.getByRole("heading", { name: "Placeholder night" });
    if (!(await heading.isVisible().catch(() => false))) await page.getByText("Placeholder night").first().click();
    await expect(heading).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "More actions" }).first().click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit: Event" });
    await expect(edit).toBeVisible();

    await readSample(page, edit);
    const asked = review(edit);
    await expect(asked).toBeVisible({ timeout: 20_000 });
    await expect(asked.getByRole("group")).toHaveCount(1);
    await asked.getByRole("button", { name: "Use all new" }).click();
    await expect(edit.getByLabel("What")).toHaveValue("Night Tram Quartet");
    // Still the old name on the page behind: a fill never saves.
    await expect(heading).toBeVisible();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Night Tram Quartet" })).toBeVisible({ timeout: 20_000 });
  });
}

test("closing the choice fills nothing and says nothing", async ({ page }) => {
  await addPackage(page, packApp("poster-event", "poster-event.app.ts"), false);
  const form = await newEvent(page);
  await form.getByLabel("What").fill("Typed");
  await form.getByRole("button", { name: /^Read a poster/ }).click();
  await expect(page.getByRole("menu", { name: "Read a poster" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Read a poster" })).toHaveCount(0);
  // The form is still there, as it was, and can be saved.
  await expect(form).toBeVisible();
  await expect(form.getByLabel("What")).toHaveValue("Typed");
  await expect(form.locator("[data-k-form-fill]").getByRole("alert")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Create" })).toBeEnabled();
});
