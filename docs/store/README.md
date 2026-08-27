# Chrome Web Store listing imagery

Every image here is rendered from the shipping popup. `tools/store-assets/build.mjs`
loads `popup.html`, `popup.css`, and `popup.js` unmodified, stubs the Chrome
extension APIs with fixture tabs, windows, and session history, then drives the
real controls so each screenshot shows output the extension actually produces.

| File | Listing slot | Size | Popup state |
| --- | --- | --- | --- |
| `screenshot-01-overview.jpg` | Screenshot | 1280x800 | Action view with live window summary |
| `screenshot-02-duplicates.jpg` | Screenshot | 1280x800 | Similar-tab review after exact duplicates closed |
| `screenshot-03-organize.jpg` | Screenshot | 1280x800 | After grouping, with the toggle flipped to Ungroup |
| `screenshot-04-gather.jpg` | Screenshot | 1280x800 | After gathering loose tabs from another window |
| `screenshot-05-recently-closed.jpg` | Screenshot | 1280x800 | Chrome-wide recently closed list |
| `promo-small-tile.jpg` | Small promo tile | 440x280 | Identity only |
| `promo-marquee-tile.jpg` | Marquee promo tile | 1400x560 | Identity with popup |
| `store-icon-128.png` | Store icon | 128x128 | 96x96 mark with transparent padding |

Screenshots and promo tiles are JPEG without an alpha channel, matching the
store's requirements. The store icon keeps its alpha channel and follows
Chrome's guidance to inset the mark to 96x96 inside the 128x128 canvas.

## Icons

The same build renders `icons/icon-16.png`, `icons/icon-32.png`,
`icons/icon-48.png`, and `icons/icon-128.png` from `icons/icon.svg`, so the
shipped raster icons cannot drift from the vector source. Toolbar icons stay
full-bleed because Chrome adds its own padding; only the listing icon is inset.
Edit `icons/icon.svg` and rerun the build to change the mark everywhere.

## Repository screenshots

The build also refreshes the README screenshots in `docs/`
(`tab-control-popup.png`, `close-both-review.png`, `recently-closed.png`). Each
is captured at twice the popup's 360px width and cropped to the popup's measured
height, so the documentation cannot fall behind the shipping UI.

## Regenerating

```sh
node tools/store-assets/build.mjs
```

The script needs a Chromium-based browser (Chrome, Chromium, Edge, or Brave).
On macOS it checks the standard `/Applications/...` browser locations. On
Windows it checks the `%ProgramFiles%`, `%ProgramFiles(x86)%`, and `%LOCALAPPDATA%`
install roots for each browser. Set `CHROME_PATH` to use a specific browser
executable or an installation in another location; it is checked first.
Resizing and JPEG conversion run in the browser with a canvas, so no image
tools or package installation is required. Intermediate pages and PNGs are
written to the ignored `dist/store-assets/` directory; store-listing assets land
in `docs/store/`, and the same run refreshes `icons/` and the README screenshots
in `docs/` described below.

Update the copy blocks in `tools/store-assets/build.mjs` and the fixture windows
in `tools/store-assets/scenarios.mjs` when the popup gains or loses a feature, so
the listing keeps describing the current implementation.
