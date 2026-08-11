# Vendored fonts

Both families are licensed under the SIL Open Font License 1.1 (see `OFL-nunito.txt` and `OFL-spacemono.txt`).
They are self-hosted on purpose: the tap screen must not pay a Google Fonts CDN round-trip (spec §3a).

## Provenance (pinned)

| File | Family | Source (official Google Fonts distribution) |
|---|---|---|
| `nunito-vf-700-900.woff2` | Nunito v32, variable | `https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaBTMnFcQ.woff2` |
| `space-mono-400.woff2` | Space Mono v17, Regular | `https://fonts.gstatic.com/s/spacemono/v17/i7dPIFZifjKcF5UAWdDRYEF8RXi4EwQ.woff2` |
| `space-mono-700.woff2` | Space Mono v17, Bold | `https://fonts.gstatic.com/s/spacemono/v17/i7dMIFZifjKcF5UAWdDRaPpZUFWaHi6WZ3Q.woff2` |

Upstream projects: [googlefonts/nunito](https://github.com/googlefonts/nunito), [googlefonts/spacemono](https://github.com/googlefonts/spacemono).

## Processing

Subset with fontTools 4.60.2 (`pyftsubset --flavor=woff2 --layout-features='kern,liga'`) to:

```
U+0020-007E, U+00B7, U+00D7, U+2013, U+2014, U+2018, U+2019,
U+201C, U+201D, U+2026, U+2190, U+2192, U+2713, U+2715, U+FF0B
```

The Nunito variable font was additionally limited to the weight axis range 700–900 with `fonttools varLib.instancer wght=700:900`, so one 14 KB file serves weights 700/800/900.

Neither family contains `✓ ✕ ← → ＋` glyphs; those characters intentionally render from system fallback fonts, exactly as they did in the approved prototype.

Bebas Neue is deliberately absent: the approved prototype does not use it, despite spec §3a mentioning it.
