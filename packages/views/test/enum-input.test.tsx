// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EnumField } from "karta";
import { EnumInput, EnumPill } from "../src/enum-input.js";
import { enumSwatch, filterOptions, wantsSegmented } from "../src/enum.js";

// One of a set (#98): a short list is a row of buttons, a long one a searchable picker, and a
// value's colour is the same wherever it shows.

afterEach(cleanup);

const diet: EnumField = { type: "enum", options: ["vegan", "vegetarian", "animal-based"], colors: { vegan: "green" } };
const kind: EnumField = { type: "enum", options: ["restaurant", "bar", "cafe", "pizza", "bakery", "other"] };

describe("which control", () => {
  it("counts the options, and lets the field say otherwise", () => {
    expect(wantsSegmented(diet)).toBe(true);
    expect(wantsSegmented(kind)).toBe(false);
    expect(wantsSegmented({ options: ["a", "b", "c", "d", "e"] })).toBe(true);
    expect(wantsSegmented({ options: ["a", "b", "c", "d", "e", "f"] })).toBe(false);
    expect(wantsSegmented({ ...kind, control: "segmented" })).toBe(true);
    expect(wantsSegmented({ ...diet, control: "picker" })).toBe(false);
  });
});

describe("colour", () => {
  it("uses the field's colour when it names one, else a hue of its own, and is stable", () => {
    const named = enumSwatch(diet, "vegan").style!["--swatch"];
    const derived = enumSwatch(diet, "vegetarian").style!["--swatch"];
    expect(named).toMatch(/^oklch\(/);
    expect(derived).toMatch(/^oklch\(/);
    expect(named).not.toBe(derived);
    expect(enumSwatch(diet, "vegetarian").style!["--swatch"]).toBe(derived);
    // The same word is the same colour in another app, because it comes from the word.
    expect(enumSwatch(undefined, "vegetarian").style!["--swatch"]).toBe(derived);
    // Grey is the absence of a tint.
    expect(enumSwatch({ colors: { other: "grey" } }, "other").style).toBeUndefined();
  });

  it("puts the tint on the pill", () => {
    render(<EnumPill field={diet} value="vegan" />);
    expect(screen.getByText("vegan").getAttribute("style")).toContain("--swatch");
  });
});

describe("search", () => {
  it("matches every typed word, in any order", () => {
    const opts = ["late night bar", "quiet cafe", "bakery"];
    expect(filterOptions(opts, "")).toEqual(opts);
    expect(filterOptions(opts, "bar")).toEqual(["late night bar"]);
    expect(filterOptions(opts, "night late")).toEqual(["late night bar"]);
    expect(filterOptions(opts, "BAKE")).toEqual(["bakery"]);
    expect(filterOptions(opts, "zzz")).toEqual([]);
  });
});

describe("the row of buttons", () => {
  it("starts on nothing, picks, and un-picks when the field is optional", () => {
    const onChange = vi.fn();
    render(<EnumInput field={diet} value={null} onChange={onChange} label="Diet" />);
    const group = screen.getByRole("radiogroup", { name: "Diet" });
    expect(group.querySelectorAll("[aria-checked='true']")).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: "vegan" }));
    expect(onChange).toHaveBeenCalledWith("vegan");
    cleanup();

    render(<EnumInput field={diet} value="vegan" onChange={onChange} label="Diet" />);
    expect(screen.getByRole("radio", { name: "vegan" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "vegan" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps a required field's answer when its button is pressed again", () => {
    const onChange = vi.fn();
    render(<EnumInput field={{ ...diet, required: true }} value="vegan" onChange={onChange} label="Diet" />);
    fireEvent.click(screen.getByRole("radio", { name: "vegan" }));
    expect(onChange).toHaveBeenLastCalledWith("vegan");
  });
});

describe("the picker", () => {
  it("opens a searchable list, filters it, and picking one closes it", () => {
    const onChange = vi.fn();
    render(<EnumInput field={kind} value={null} onChange={onChange} label="Kind" />);
    const trigger = screen.getByRole("button", { name: "Kind: choose" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox", { name: "Kind" });
    expect(list.querySelectorAll(".k-enum-option")).toHaveLength(6);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Kind" }), { target: { value: "ba" } });
    expect([...list.querySelectorAll(".k-enum-option-label")].map((e) => e.textContent)).toEqual(["bar", "bakery"]);
    fireEvent.click(screen.getByRole("option", { name: /bakery/ }));
    expect(onChange).toHaveBeenCalledWith("bakery");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when nothing matches, and Enter takes the first match", () => {
    const onChange = vi.fn();
    render(<EnumInput field={kind} value="bar" onChange={onChange} label="Kind" />);
    fireEvent.click(screen.getByRole("button", { name: "Kind: bar" }));
    const search = screen.getByRole("searchbox", { name: "Search Kind" });
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.change(search, { target: { value: "piz" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("pizza");
  });
});
