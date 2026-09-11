# Vendored fonts

Both families are licensed under the SIL Open Font License 1.1 (see `OFL-londrinasolid.txt` and `OFL-barlow.txt`).
They are self-hosted on purpose: the tap screen must not pay a Google Fonts CDN round-trip (spec §3a).

The identity names exactly two faces (`data/tap-flow-decision/design-record.md`, constraint 3) — Londrina Solid on headlines, the plate and buttons; Barlow on everything else — and nothing else belongs on the page.
Nunito and Space Mono were the previous identity's faces and were removed with it; the IDs Space Mono used to set are now Barlow 500 with wide tracking, which is what the approved screens do, since the identity names no monospace face.
Bebas Neue is deliberately absent: the approved screens do not use it, despite spec §3a mentioning it.

## Provenance (pinned)

| File | Family | Source (official Google Fonts distribution, `latin` subset) |
|---|---|---|
| `londrina-400.woff2` | Londrina Solid v19, Regular | `https://fonts.gstatic.com/s/londrinasolid/v19/flUhRq6sw40kQEJxWNgkLuudGfNeKBMet5Hg.woff2` |
| `barlow-400.woff2` | Barlow v13, Regular | `https://fonts.gstatic.com/s/barlow/v13/7cHpv4kjgoGqM7E_DMs5ynghnQ.woff2` |
| `barlow-500.woff2` | Barlow v13, Medium | `https://fonts.gstatic.com/s/barlow/v13/7cHqv4kjgoGqM7E3_-gs51ostz0rdg.woff2` |
| `barlow-600.woff2` | Barlow v13, SemiBold | `https://fonts.gstatic.com/s/barlow/v13/7cHqv4kjgoGqM7E30-8s51ostz0rdg.woff2` |
| `barlow-700.woff2` | Barlow v13, Bold | `https://fonts.gstatic.com/s/barlow/v13/7cHqv4kjgoGqM7E3t-4s51ostz0rdg.woff2` |

Upstream projects: [googlefonts/londrina](https://github.com/marcelommp/Londrina-Typeface), [jpt/barlow](https://github.com/jpt/barlow).

## Processing

Subset with fontTools 4.60.2 (`pyftsubset --flavor=woff2 --layout-features='kern,liga'`) to:

```
U+0020-007E, U+00A0, U+00A1, U+00B7, U+00BF,
U+00C1, U+00C9, U+00CD, U+00D1, U+00D3, U+00D7, U+00DA, U+00DC,
U+00E1, U+00E9, U+00ED, U+00F1, U+00F3, U+00FA, U+00FC,
U+2013, U+2014, U+2018, U+2019, U+201C, U+201D, U+2026,
U+2190, U+2192, U+2713, U+2715, U+FF0B
```

The accented range is not optional: **every screen exists in Spanish** (`design-record.md`, constraint 11), so `á é í ó ú ü ñ` and the opening `¿ ¡` are as load-bearing as the ASCII.
Adding a screen whose Spanish needs a character outside this set means re-subsetting, not falling back — a glyph served from a system font in the middle of a Londrina Solid headline is visible from across the street.

The one thing this set cannot cover is the bed's given name (`Bed.bedName`), which is visitor free text set in Londrina Solid: a name typed with a character outside the subset falls back per glyph, by design — the alternative is refusing a neighbour's own name for its spelling.
The subset is sized for the Spanish this block speaks, and widening it further is a size decision, not a correctness one.

Neither family contains `✓ ✕ ← → ＋` glyphs; those characters intentionally render from system fallback fonts, exactly as they did in the approved screens.
