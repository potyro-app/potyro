# Legacy examples (six-language maps)

The six examples as they were before docs/30 moved their translations into catalogs (2026-10-19), with
every word an inline map `{ en, "pt-BR", de, es, pl, it }`. The `translate` tool and its eval
(`eval:translate`) splice languages into such maps; they read these copies, frozen, until the catalog
translate step replaces them. Nothing else should read them: the examples themselves are in `examples/`.
