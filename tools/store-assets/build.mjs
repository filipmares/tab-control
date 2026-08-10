#!/usr/bin/env node
// Renders Chrome Web Store listing imagery from the live popup implementation.
// The popup is loaded exactly as shipped, with Chrome extension APIs stubbed by
// tools/store-assets/chrome-stub.mjs so every screenshot shows real UI output.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const stageDir = path.join(root, "dist/store-assets");
const outputDir = path.join(root, "docs/store");

const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const screenshots = [
  {
    name: "01-overview",
    scenario: "actions",
    eyebrow: "Tab Control for Chrome",
    title: "Four controls. A calmer window.",
    lede:
      "Close duplicates, sort by site, group domains, and gather loose tabs — all from one compact panel.",
    points: [
      ["Close duplicate tabs", "Exact matches close, similar ones reviewed", "var(--red)"],
      ["Sort tabs by domain", "Every site filed in order", "var(--yellow)"],
      ["Group tabs by domain", "Named Chrome tab groups", "var(--blue)"],
      ["Gather tabs here", "Loose tabs from other windows", "var(--green)"],
    ],
    footer: "Runs locally. No account, no tracking, no browsing data collected.",
  },
  {
    name: "02-duplicates",
    scenario: "review",
    eyebrow: "Close duplicate tabs",
    title: "Duplicates closed. Near-matches reviewed.",
    lede:
      "Exact copies close automatically. Addresses that only look alike are shown side by side with the difference highlighted, so you decide what stays.",
    footer: "Undo restores the whole cleanup as one transaction.",
  },
  {
    name: "03-organize",
    scenario: "grouped",
    eyebrow: "Sort and group",
    title: "One press files the whole window.",
    lede:
      "Sort orders every tab by domain, then by page title. Group builds named Chrome tab groups for sites with two or more tabs — and turns into Ungroup when you are done.",
    footer: "Pinned tabs keep their place. Nothing is closed.",
  },
  {
    name: "04-gather",
    scenario: "gathered",
    eyebrow: "Gather tabs here",
    title: "Pull scattered tabs into one window.",
    lede:
      "Loose tabs from your other Chrome windows are appended to the window you are in, so a scattered session becomes a single working window.",
    footer: "Pinned and grouped tabs stay where you put them.",
  },
  {
    name: "05-recently-closed",
    scenario: "recent",
    eyebrow: "Recently closed",
    title: "Reopen what you just closed.",
    lede:
      "Chrome's browser-wide history of closed tabs and windows, in one list. Pick an item and Chrome restores it with its normal session behaviour.",
    footer: "Works across every Chrome window, not just this one.",
  },
];

const dial = (size) => `
  <svg class="tile__dial" viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="64" cy="64" r="54" fill="#F2F1EA" stroke="#1C1D1A" stroke-width="6" />
    <circle cx="64" cy="64" r="25" fill="#1C1D1A" />
    <path d="M96 24L103 15" fill="none" stroke="#D74C3F" stroke-linecap="round" stroke-width="8" />
  </svg>`;

const barsMarkup = `
  <div class="tile__bars">
    <span style="background: var(--red)"></span>
    <span style="background: var(--yellow)"></span>
    <span style="background: var(--blue)"></span>
    <span style="background: var(--green)"></span>
  </div>`;

function frameScript() {
  return `
    <script>
      for (const frame of document.querySelectorAll("iframe")) {
        const fit = () => {
          const doc = frame.contentDocument;
          if (doc) {
            frame.style.height = doc.documentElement.scrollHeight + "px";
          }
        };
        frame.addEventListener("load", () => {
          setTimeout(fit, 300);
          setTimeout(fit, 800);
          setTimeout(fit, 1500);
        });
      }
    </script>`;
}

function page(title, width, height, extraVars, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <link rel="stylesheet" href="/tools/store-assets/poster.css" />
    <style>
      :root {
        --poster-width: ${width}px;
        --poster-height: ${height}px;
        ${extraVars}
      }
    </style>
  </head>
  <body>
${body}
${frameScript()}
  </body>
</html>`;
}

function screenshotPage(config) {
  const points = config.points
    ? `<ul class="poster__points">${config.points
        .map(
          ([label, detail, accent]) =>
            `<li class="poster__point" style="--accent: ${accent}"><strong>${label}</strong><span>${detail}</span></li>`,
        )
        .join("")}</ul>`
    : "";

  return page(
    config.title,
    1280,
    800,
    "--stage-width: 600px; --popup-scale: 1.22;",
    `    <div class="poster">
      <div class="poster__copy">
        <p class="poster__eyebrow">${config.eyebrow}</p>
        <h1 class="poster__title">${config.title}</h1>
        <p class="poster__lede">${config.lede}</p>
        ${points}
        <p class="poster__footer">${config.footer}</p>
        <div class="poster__bars">
          <span style="background: var(--red)"></span>
          <span style="background: var(--yellow)"></span>
          <span style="background: var(--blue)"></span>
          <span style="background: var(--green)"></span>
        </div>
      </div>
      <div class="poster__stage">
        <div class="poster__device">
          <iframe src="/dist/store-assets/popup.html?scenario=${config.scenario}" title="Tab Control popup"></iframe>
        </div>
      </div>
    </div>`,
  );
}

function smallTilePage() {
  return page(
    "Tab Control",
    440,
    280,
    `--tile-padding: 28px; --tile-gap: 22px; --dial-size: 96px;
     --tile-name-size: 34px; --tile-tagline-size: 15px; --tile-tagline-gap: 8px;
     --tile-meta-size: 10px; --tile-meta-gap: 14px;
     --tile-bars-width: 96px; --tile-bars-height: 5px;`,
    `    <div class="tile">
      ${dial(96)}
      <div class="tile__copy">
        <p class="tile__name">Tab Control</p>
        <p class="tile__tagline">Control the clutter.</p>
        <p class="tile__meta">Clean · Sort · Group · Restore</p>
      </div>
      ${barsMarkup}
    </div>`,
  );
}

function marqueePage() {
  return page(
    "Tab Control",
    1400,
    560,
    `--tile-padding: 72px; --tile-gap: 40px; --dial-size: 150px;
     --tile-name-size: 76px; --tile-tagline-size: 28px; --tile-tagline-gap: 14px;
     --tile-meta-size: 15px; --tile-meta-gap: 30px;
     --tile-bars-width: 200px; --tile-bars-height: 8px;`,
    `    <div class="tile">
      ${dial(150)}
      <div class="tile__copy">
        <p class="tile__name">Tab Control</p>
        <p class="tile__tagline">Control the clutter across every Chrome window.</p>
        <p class="tile__meta">Close duplicates · Sort · Group · Gather · Restore</p>
      </div>
      ${barsMarkup}
      <div class="tile__device">
        <iframe src="/dist/store-assets/popup.html?scenario=actions" title="Tab Control popup"></iframe>
      </div>
    </div>`,
  );
}

async function stagePopup() {
  const source = await readFile(path.join(root, "popup.html"), "utf8");
  const staged = source
    .replace('href="popup.css"', 'href="/popup.css"')
    .replace(
      '<script type="module" src="popup.js"></script>',
      '<script type="module" src="/tools/store-assets/chrome-stub.mjs"></script>\n    <script type="module" src="/popup.js"></script>',
    );

  if (staged === source) {
    throw new Error("popup.html did not match the expected asset references.");
  }

  await writeFile(path.join(stageDir, "popup.html"), staged);
}

function startServer() {
  const server = createServer(async (request, response) => {
    const requested = decodeURIComponent(new URL(request.url, "http://x").pathname);
    const filePath = path.join(root, requested);

    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      response.writeHead(404).end("Not found");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function findBrowser() {
  const browser = BROWSERS.find((candidate) => existsSync(candidate));

  if (!browser) {
    throw new Error(
      `No Chromium-based browser found. Looked for:\n${BROWSERS.join("\n")}`,
    );
  }

  return browser;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Headless Chromium writes the screenshot and then lingers on updater and
// service processes, so the build waits for a stable file and stops the child.
async function waitForStableFile(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;

  while (Date.now() < deadline) {
    await delay(500);

    if (!existsSync(target)) {
      continue;
    }

    const { size } = await stat(target);

    if (size > 0 && size === lastSize) {
      return true;
    }

    lastSize = size;
  }

  return false;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function capture(browser, url, target, width, height, options = {}) {
  const profile = path.join(stageDir, `profile-${path.basename(target, ".png")}`);
  await rm(target, { force: true });

  const child = spawn(
    browser,
    browserArgs(profile, [
      `--force-device-scale-factor=${options.deviceScale ?? 2}`,
      ...(options.transparent ? ["--default-background-color=00000000"] : []),
      `--window-size=${width},${height}`,
      `--screenshot=${target}`,
      url,
    ]),
    { stdio: "ignore" },
  );

  const captured = await waitForStableFile(target, 60_000);
  child.kill("SIGKILL");

  if (!captured) {
    throw new Error(`Timed out capturing ${url}`);
  }
}

async function resize(source, target, width, height) {
  await run("sips", [
    "-z",
    String(height),
    String(width),
    source,
    "--out",
    target,
  ]);
}

async function toStoreImage(pngPath, jpgPath, width, height) {
  await resize(pngPath, jpgPath, width, height);
  await run("sips", [
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "95",
    jpgPath,
    "--out",
    jpgPath,
  ]);
}

const ICON_SIZES = [16, 32, 48, 128];

async function iconPage(canvas = 128, mark = 128) {
  const svg = (await readFile(path.join(root, "icons/icon.svg"), "utf8"))
    .replace('width="128"', `width="${mark}"`)
    .replace('height="128"', `height="${mark}"`);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Tab Control icon</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
        width: ${canvas}px;
        height: ${canvas}px;
      }

      svg {
        display: block;
      }
    </style>
  </head>
  <body>
${svg}
  </body>
</html>`;
}

// The extension PNGs and the listing icon are rendered from icons/icon.svg so
// the raster sizes can never drift from the vector source. Chrome's store icon
// guidance asks for a 96x96 mark inside the 128x128 canvas; toolbar icons stay
// full-bleed because Chrome adds its own padding there.
async function buildIcons(server, browser) {
  const port = server.address().port;
  const master = path.join(stageDir, "icon-master.png");
  const storeMaster = path.join(stageDir, "icon-store-master.png");

  await writeFile(path.join(stageDir, "icon.html"), await iconPage());
  await writeFile(
    path.join(stageDir, "icon-store.html"),
    await iconPage(128, 96),
  );

  await capture(
    browser,
    `http://127.0.0.1:${port}/dist/store-assets/icon.html`,
    master,
    128,
    128,
    { transparent: true, deviceScale: 8 },
  );
  await capture(
    browser,
    `http://127.0.0.1:${port}/dist/store-assets/icon-store.html`,
    storeMaster,
    128,
    128,
    { transparent: true, deviceScale: 8 },
  );

  for (const size of ICON_SIZES) {
    const target = path.join(root, `icons/icon-${size}.png`);
    await resize(master, target, size, size);
    console.log(`${size}x${size} ${path.relative(root, target)}`);
  }

  const storeIcon = path.join(outputDir, "store-icon-128.png");
  await resize(storeMaster, storeIcon, 128, 128);
  console.log(`128x128 ${path.relative(root, storeIcon)}`);
}

// README screenshots live at 2x the popup's 360px width, cropped to the exact
// popup height so the repository documentation always shows the shipping UI.
const docsShots = [
  { scenario: "actions", file: "docs/tab-control-popup.png" },
  { scenario: "review", file: "docs/close-both-review.png" },
  { scenario: "recent", file: "docs/recently-closed.png" },
];

function browserArgs(profile, extra) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--hide-scrollbars",
    `--user-data-dir=${profile}`,
    "--virtual-time-budget=6000",
    ...extra,
  ];
}

async function measurePopupHeight(browser, url, profile) {
  const child = spawn(
    browser,
    browserArgs(profile, ["--window-size=360,2000", "--dump-dom", url]),
    { stdio: ["ignore", "pipe", "ignore"] },
  );

  let output = "";

  const height = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out measuring ${url}`));
    }, 60_000);

    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/data-popup-height="(\d+)"/);

      if (match) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        resolve(Number(match[1]));
      }
    });
    child.on("error", reject);
  });

  return height;
}

async function buildDocsShots(server, browser) {
  const port = server.address().port;

  for (const shot of docsShots) {
    const url = `http://127.0.0.1:${port}/dist/store-assets/popup.html?scenario=${shot.scenario}`;
    const profile = path.join(stageDir, `profile-docs-${shot.scenario}`);
    const height = await measurePopupHeight(browser, url, profile);
    const target = path.join(root, shot.file);

    await capture(browser, url, target, 360, height, { deviceScale: 2 });
    console.log(`720x${height * 2} ${shot.file}`);
  }
}

async function main() {
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await stagePopup();

  const targets = [
    ...screenshots.map((config) => ({
      name: `screenshot-${config.name}`,
      html: screenshotPage(config),
      width: 1280,
      height: 800,
    })),
    {
      name: "promo-small-tile",
      html: smallTilePage(),
      width: 440,
      height: 280,
    },
    {
      name: "promo-marquee-tile",
      html: marqueePage(),
      width: 1400,
      height: 560,
    },
  ];

  for (const target of targets) {
    await writeFile(path.join(stageDir, `${target.name}.html`), target.html);
  }

  const server = await startServer();
  const { port } = server.address();
  const browser = findBrowser();

  try {
    await buildIcons(server, browser);
    await buildDocsShots(server, browser);

    for (const target of targets) {
      const png = path.join(stageDir, `${target.name}.png`);
      const jpg = path.join(outputDir, `${target.name}.jpg`);

      await capture(
        browser,
        `http://127.0.0.1:${port}/dist/store-assets/${target.name}.html`,
        png,
        target.width,
        target.height,
      );
      await toStoreImage(png, jpg, target.width, target.height);
      console.log(`${target.width}x${target.height}  ${path.relative(root, jpg)}`);
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
