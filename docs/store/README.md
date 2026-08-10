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

All files are JPEG without an alpha channel, matching the store's requirements.

## Regenerating

```sh
node tools/store-assets/build.mjs
```

The script needs a Chromium-based browser installed at one of the paths listed in
`BROWSERS` (Chrome, Chromium, Edge, or Brave) and macOS `sips` for resizing and
JPEG conversion. Intermediate pages and PNGs are written to the ignored
`dist/store-assets/` directory; only the finished JPEGs land here.

Update the copy blocks in `tools/store-assets/build.mjs` and the fixture windows
in `tools/store-assets/scenarios.mjs` when the popup gains or loses a feature, so
the listing keeps describing the current implementation.
