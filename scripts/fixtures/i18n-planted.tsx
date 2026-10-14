// Planted strings for scripts/check-i18n.mjs's self-test, which runs on every `pnpm lint:i18n`.
// Not compiled, not in any package: a line ending in `// expect` must be reported, and no other
// line may be. If the check stops seeing one of these, the lint fails before it scans shell/views.
/* eslint-disable */

export const actions = [
  { id: "a", label: (r: { noun: string }) => `＋ New ${r.noun}` }, // expect
  {
    id: "b",
    title: (r: { name: string }) => {
      if (r.name) return "Open it"; // expect
      const inner = () => "returned to someone else, not to the slot";
      return inner();
    },
  },
  {
    id: "c",
    label() {
      return `Delete ${"everything"}`; // expect
    },
  },
  { id: "d", detail: function () { return "Gone for good"; } }, // expect
];

export const List = ({ xs }: { xs: string[] }) => <ul>{xs.map((x) => `${x} items`)}</ul>; // expect

export const fine = {
  label: (r: { name: string }) => r.name,
  title: () => "Potyro",
  placeholder: (r: { n: number }) => `${r.n} · ${r.n}`,
};
export const Fine = ({ xs }: { xs: string[] }) => <ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul>;
