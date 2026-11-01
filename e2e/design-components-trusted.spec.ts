import { test, expect, type Locator, type Page } from "./console-guard";

// The component pass's leftovers (#428), measured against packages/design/source/DESIGN.md: the toggle
// of §6 in both themes and under reduced motion, the focus ring of §11.2 inside an app whose button is
// its traço, and the selected chip of §6 that still reads in greyscale (§11.10).

/** A CSS colour as the browser computes it (`rgb(r, g, b)`), so a token compares with a drawn colour. */
function computed(page: Page, css: string): Promise<string> {
  return page.evaluate((c) => {
    const probe = document.createElement("i");
    probe.style.color = c;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, css);
}

const channels = (rgb: string): [number, number, number] => rgb.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

async function openNewPlant(page: Page): Promise<Locator> {
  await page.goto("/?user=plants");
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
  await page.getByRole("button", { name: "Add: Plant" }).click();
  const form = page.locator(".k-form");
  await expect(form).toBeVisible();
  return form;
}

/** The toggle's parts as the browser drew them. */
function toggleOf(row: Locator) {
  return row.locator(".k-switch").evaluate((track) => {
    const knob = track.querySelector(".k-switch-knob")!;
    const t = getComputedStyle(track);
    const k = getComputedStyle(knob);
    const tb = track.getBoundingClientRect();
    const kb = knob.getBoundingClientRect();
    return {
      width: Math.round(tb.width),
      height: Math.round(tb.height),
      border: t.borderTopWidth,
      borderColor: t.borderTopColor,
      track: t.backgroundColor,
      knob: k.backgroundColor,
      knobSize: Math.round(kb.width),
      // The knob sits in the middle of the track's height.
      centred: Math.abs(kb.top + kb.height / 2 - (tb.top + tb.height / 2)) < 1,
      transition: k.transitionProperty,
      easing: k.transitionTimingFunction,
    };
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`the toggle, ${colorScheme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme });

    test("is DESIGN.md §6's: a 44×28 pill, the outlined grey track and a white knob off, the app's button pair on", async ({ page }) => {
      const form = await openNewPlant(page);
      const sun = form.getByRole("switch", { name: "Wants direct sun" });
      await expect(sun).toHaveAttribute("aria-checked", "false");
      const off = await toggleOf(sun);
      const surface2 = colorScheme === "light" ? "rgb(230, 229, 231)" : "rgb(65, 64, 66)";
      const lineStrong = colorScheme === "light" ? "rgb(140, 138, 142)" : "rgb(133, 131, 135)";
      expect(off).toMatchObject({ width: 44, height: 28, border: "2px", borderColor: lineStrong, track: surface2, knob: "rgb(255, 255, 255)", knobSize: 20, centred: true });
      // The knob lands with the boing (§3.6).
      expect(off.transition).toContain("transform");
      expect(off.easing).toContain("cubic-bezier(0.34, 1.56, 0.64, 1)");

      await sun.click();
      await expect(sun).toHaveAttribute("aria-checked", "true");
      // The app's own pair: Plants is green, so the traço with graphite on it.
      const [accent, onAccent] = await sun.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.getPropertyValue("--accent").trim(), s.getPropertyValue("--on-accent").trim()];
      });
      // Polled: the track and the knob fade to their colours.
      await expect.poll(async () => (await toggleOf(sun)).track).toBe(await computed(page, accent));
      await expect.poll(async () => (await toggleOf(sun)).knob).toBe(await computed(page, onAccent));
      // The knob travelled the track and stayed inside it.
      await expect
        .poll(() => sun.locator(".k-switch").evaluate((t) => {
          const tb = t.getBoundingClientRect();
          const kb = t.querySelector(".k-switch-knob")!.getBoundingClientRect();
          return Math.round(tb.right - kb.right);
        }))
        .toBe(4);
    });
  });
}

test.describe("the toggle, reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the knob does not travel: it is where it lands (§11.6)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const form = await openNewPlant(page);
    const t = await toggleOf(form.getByRole("switch", { name: "Wants direct sun" }));
    expect(t.transition).not.toContain("transform");
    expect(t.transition).not.toBe("all");
  });
});

test.describe("the focus ring inside a green app", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // §6 / §11.2: the ring is --focus, the tinta. Drawn in --accent it was Plants' traço, #49de78:
  // 1.9:1 on white, a ring a keyboard user can lose.
  test("is the app's tinta, and reads on the page (3:1)", async ({ page }) => {
    const form = await openNewPlant(page);
    const sun = form.getByRole("switch", { name: "Wants direct sun" });
    await sun.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(sun).toBeFocused();
    const ring = await sun.evaluate((el) => getComputedStyle(el).outlineColor);
    const focus = await sun.evaluate((el) => getComputedStyle(el).getPropertyValue("--focus").trim());
    expect(ring).toBe(await computed(page, focus));
    expect(contrast(channels(ring), [255, 255, 255])).toBeGreaterThanOrEqual(3);
  });
});

test.describe("a selected chip", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // §6 Chip: selected is the aguada, --ink on it, and an 8px --tinta dot at the left — the "head". The
  // dot is what still says "selected" in greyscale (§11.10), where the aguada is all but the grey.
  test("carries the head, on Home's sort", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
    const sort = page.getByRole("group", { name: "Sort apps" });
    const head = (b: Locator) =>
      b.evaluate((el) => {
        const s = getComputedStyle(el, "::before");
        return { content: s.content, width: s.width, height: s.height, radius: s.borderRadius, bg: s.backgroundColor };
      });
    const pressed = sort.getByRole("button", { pressed: true });
    await expect(pressed).toHaveCount(1);
    const tinta = await pressed.evaluate((el) => getComputedStyle(el).getPropertyValue("--tinta").trim());
    expect(await head(pressed)).toEqual({ content: '""', width: "8px", height: "8px", radius: "50%", bg: await computed(page, tinta) });
    expect((await head(sort.getByRole("button", { pressed: false }).first())).content).toBe("none");
  });

  test("in a filter is the aguada with ink on it, never the accent", async ({ page }) => {
    await page.goto("/?user=recipes");
    await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
    const chip = page.getByRole("switch", { name: "Can cook now" });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-checked", "true");
    const [aguada, inkToken] = await chip.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.getPropertyValue("--aguada").trim(), s.getPropertyValue("--ink").trim()];
    });
    // Polled: the chip fades to its colours.
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await computed(page, aguada));
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).color)).toBe(await computed(page, inkToken));
  });
});

// The Look panel's choices are cards, not pills: a column of a name and a line under it. Chosen, the
// card is §6's selected chip all the same — the aguada with the name in --ink and its line muted, an
// edge of --line-strong, the tinta head before the name. Its words were once the accent's pair, which
// on the aguada is white on near-white (1.15:1 on Potyro's rosa). Measured at every accent the panel
// offers, since the aguada is the accent's own wash.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`the Look panel's chosen option, ${colorScheme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme });

    test("is --ink on the aguada with the head, and reads (AA) whatever the accent", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /Look — appearance/ }).click({ timeout: 30_000 });
      const look = page.getByRole("dialog", { name: "Look" });
      await expect(look).toBeVisible();
      const swatches = look.getByRole("radiogroup", { name: "Accent colour" }).getByRole("radio");
      const count = await swatches.count();
      expect(count).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < count; i++) {
        await swatches.nth(i).click();
        await expect(swatches.nth(i)).toHaveAttribute("aria-checked", "true");
        for (const group of ["Appearance", "Home screen"]) {
          const chosen = look.getByRole("radiogroup", { name: group }).getByRole("radio", { checked: true });
          await expect(chosen).toHaveCount(1);
          const drawn = await chosen.evaluate((el) => {
            const s = getComputedStyle(el);
            const name = el.querySelector("strong")!;
            const head = getComputedStyle(name, "::before");
            return {
              bg: s.backgroundColor,
              border: s.borderTopColor,
              name: getComputedStyle(name).color,
              line: getComputedStyle(el.querySelector(".k-muted")!).color,
              head: { content: head.content, width: head.width, bg: head.backgroundColor },
              tokens: ["--aguada", "--ink", "--line-strong", "--tinta"].map((t) => s.getPropertyValue(t).trim()),
            };
          });
          const [aguada, ink, lineStrong, tinta] = await Promise.all(drawn.tokens.map((t) => computed(page, t)));
          const at = `${group}, swatch ${i}`;
          // Polled once per swatch: the chip fades to its colours.
          await expect.poll(() => chosen.evaluate((el) => getComputedStyle(el).backgroundColor), { message: at }).toBe(aguada);
          expect(drawn.name, at).toBe(ink);
          expect(drawn.border, at).toBe(lineStrong);
          expect(drawn.head, at).toEqual({ content: '""', width: "8px", bg: tinta });
          expect(contrast(channels(drawn.name), channels(aguada)), at).toBeGreaterThanOrEqual(4.5);
          expect(contrast(channels(drawn.line), channels(aguada)), at).toBeGreaterThanOrEqual(4.5);
        }
      }
      // The others are plain cards: no head.
      const other = look.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { checked: false }).first();
      expect(await other.locator("strong").evaluate((el) => getComputedStyle(el, "::before").content)).toBe("none");
    });
  });
}

test.describe("a tag you typed", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // A tag is a value with a way to take it off, not something that toggles: it wears §6's plain chip,
  // never the selected one's aguada and head.
  test("is a plain chip, not a selected one", async ({ page }) => {
    const form = await openNewPlant(page);
    const input = form.locator(".k-tags input");
    await input.fill("weeknight");
    await input.press("Enter");
    const tag = form.locator(".k-tag", { hasText: "weeknight" });
    await expect(tag).toBeVisible();
    const drawn = await tag.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, ink: s.color, head: getComputedStyle(el, "::before").content, tokens: [s.getPropertyValue("--surface").trim(), s.getPropertyValue("--ink").trim()] };
    });
    expect(drawn.head).toBe("none");
    expect(drawn.bg).toBe(await computed(page, drawn.tokens[0]!));
    expect(drawn.ink).toBe(await computed(page, drawn.tokens[1]!));
  });
});

test("a date field's calendar button is an icon, not an emoji (§3.5)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const form = await openNewPlant(page);
  const open = form.locator(".k-date-open").first();
  await expect(open.locator("svg path")).toBeAttached();
  expect((await open.innerText()).trim()).toBe("");
});

test("the Studio's greeting labels itself in --muted, not a status colour (§3.1)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /New app/ }).locator("visible=true").first().click();
  const eyebrow = page.locator(".k-studio-empty .k-studio-eyebrow");
  await expect(eyebrow).toBeVisible({ timeout: 30_000 });
  const [color, muted] = await eyebrow.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).getPropertyValue("--muted").trim()]);
  expect(color).toBe(await computed(page, muted));
});
