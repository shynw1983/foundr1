# SNS font assets, version 1

These files are served locally by Foundr1. Runtime font loading makes no requests
to Google Fonts, Google APIs, or a third-party CDN.

All eight families come from the official [Google Fonts repository](https://github.com/google/fonts),
pinned to commit `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0`.
Each family directory includes the original `OFL.txt` license. `sources.json`
records source URLs, original and published SHA256 hashes, font axes, and sizes.

The original complete TTF fonts were converted to WOFF2 using fontTools 4.60.2
and Brotli 1.2.1. Glyphs were not subsetted, renamed, drawn, or modified. The
conversion was checked by comparing the complete Unicode-to-glyph maps.

Noto Sans JP, Noto Serif JP, Inter, and Bodoni Moda are variable fonts. Their
registered weight range is 400–700. Zen Maru Gothic, Shippori Mincho, Barlow
Condensed, and IBM Plex Mono have separate original 400, 500, and 700 faces.

The three historical system-font IDs (`sans`, `serif`, `mono`) retain their
original stacks. New font IDs use these immutable versioned assets. Japanese
text in Latin families additionally waits for self-hosted Noto Sans JP or Noto
Serif JP as appropriate. Emoji may use the device's color-emoji font.

Keep `/fonts/sns/v1/` and its catalog family names unchanged for saved templates.
Any future font revision requires a new asset version and an explicit migration.
