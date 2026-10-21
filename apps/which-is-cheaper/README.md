# Which is cheaper

Two prices and two sizes, and it says the cost per unit and which one wins — the thing everyone does
badly in a shop aisle. A card per item (A, B, and a third when asked), each with a price, an amount
and its unit; as soon as two are filled the answer appears, without a button: the price per 100 g,
100 ml or piece on each card, the cheaper card lit, and "15% cheaper" under it. Grams and kilograms
compare, millilitres and litres compare; a weight against a volume says so instead of guessing.

What is typed is remembered, so the app opens on the last comparison. **Keep** makes it a record,
listed under Kept and reopened on the cards; the tile shows the last verdict.

```
which-is-cheaper.app.tsx   the app: the Compare screen (a React view), the Kept list, the tile
compare.ts                 the arithmetic: units, price per base unit, the winner and the saving, parsing
words.ts                   every word on the screens, in six languages
seed.json                  one sample comparison (olive oil, 500 ml vs 1 l), so a demo opens on an answer
test/                      the arithmetic and the app's shape
```

Money is whole minor units (KA-26). The currency is a guess from the person's locale, changeable at
the top of the screen and kept with each comparison; the record's money fields are declared in EUR,
so the shell's own record form shows a kept BRL comparison with a € sign — the app's screens do not.
