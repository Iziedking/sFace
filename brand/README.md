# sFace brand kit

Everything here is generated. Change `scripts/make-brand.mjs` and run
`npm run brand`, never edit the PNGs by hand, or the next run silently reverts
you.

No image dependency: the shapes are signed distance fields and the PNG is
written with `node:zlib`. The wordmark is a stroke font in
`scripts/lib/strokefont.mjs`, so it renders identically on every machine
rather than falling back to whatever typeface happens to be installed.

## Where each file goes

| File | Size | Upload to |
| --- | --- | --- |
| `x-app-icon-400.png` | 400×400 | **X developer portal → your app → App icon.** This is the one you need to finish the OAuth setup. |
| `x-avatar-400.png` | 400×400 | **X profile picture.** Circle-safe, see below. |
| `x-header-1500x500.png` | 1500×500 | **X profile header.** |
| `og-1200x630.png` | 1200×630 | `og:image`, the link preview when the URL is posted. |
| `x-app-icon-512.png` | 512×512 | Spare. Also the PWA icon size. |
| `app-icon-1024.png` | 1024×1024 | Master. Stores, print, anything that asks for "the biggest you have". |
| `wordmark-light.png` | 900×280 | Wordmark on cream. Slides, the submission form. |
| `wordmark-dark.png` | 900×280 | Wordmark on ink. Use on dark backgrounds only. |
| `palette.png` | 1200×400 | The six colours, so nobody has to read the CSS. |

## Why the avatar and the icon are different files

They look like the same square and they are not.

**The app icon** is a rounded square, because the developer portal and iOS
both present it as one.

**The avatar** is a circle on a transparent square, because X masks profile
pictures to a circle. Uploading the rounded-square icon here loses the corners
and clips the ends of the chart line. The mark is also inset and nudged up and
left inside the circle, because its visual mass sits low and right and it looks
off-centre otherwise.

**The header** has two crops to respect. Your avatar covers the bottom-left
corner, roughly a 200px circle, so nothing important goes there. Narrow
viewports trim the left and right edges, so the wordmark sits in the middle
third and survives the crop.

## The palette

| Token | Hex | What it means |
| --- | --- | --- |
| Canvas | `#f4ede0` | Bone cream. The page. Never white. |
| Paper | `#ded2ba` | One step down. Cards, and the ground under the chart. |
| Ink | `#14110e` | Type, outlines, every silhouette. |
| Accent | `#ff5a1f` | Signal orange. **The chart and the action, nothing else.** |
| Danger | `#d3212c` | Crimson. **Attackers and failure, nothing else.** |
| Rescue | `#2f7d63` | The people you are there to get out. |

The discipline is the brand. Orange always means "this is the chart, or this is
the thing to press". Red always means "this will hurt you, or this went wrong".
The moment either is used decoratively they stop carrying information and the
whole system flattens into decoration.

## Rules

- **Flat colour only.** No gradients standing in for depth, no glass, no blur.
- **Depth is a hard offset shadow**, 4px right and 4px down in ink, never a
  blur. Ink sits on paper; it does not float above it.
- **Borders are 2px ink.** A hairline reads as tentative on a bright canvas.
- **Headlines are uppercase**, heavy, tight. Anything checkable, a ticker, a
  handle, an address, a score, a hash, is monospace. Mono is the signal that
  says this number came from somewhere real.
- **No emoji in product copy.** The tone is dry. The joke lands harder without
  a wink.

## Voice

Short declaratives. Problem first, action second. Never breathless, and no
exclamation marks in failure states, because nobody wants to be shouted at
after dying.

The line is **"Crypto's down. Somebody has to save face."** The short lockup is
**"Somebody has to save face."** Do not stretch it into a slogan with three
clauses.
