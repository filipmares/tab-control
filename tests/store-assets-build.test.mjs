import assert from "node:assert/strict";
import test from "node:test";

import {
  browserCandidates,
  findBrowser,
} from "../tools/store-assets/build.mjs";

test("prefers CHROME_PATH before platform browser locations", () => {
  const env = {
    CHROME_PATH: "C:\\custom\\chrome.exe",
    ProgramFiles: "C:\\Program Files",
  };

  assert.equal(
    findBrowser({
      env,
      platform: "win32",
      exists: (candidate) => candidate === env.CHROME_PATH,
    }),
    env.CHROME_PATH,
  );
});

test("checks Windows browser locations under all supported install roots", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
  };
  const candidates = browserCandidates(env, "win32");

  assert.deepEqual(candidates.slice(0, 5), [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chromium.exe",
  ]);
  assert.ok(
    candidates.includes(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ),
  );
  assert.ok(
    candidates.includes(
      "C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ),
  );
});

test("preserves the standard macOS browser locations", () => {
  assert.deepEqual(browserCandidates({}, "darwin"), [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ]);
});

test("reports every searched location when no browser exists", () => {
  assert.throws(
    () =>
      findBrowser({
        env: { CHROME_PATH: "C:\\missing\\chrome.exe" },
        platform: "win32",
        exists: () => false,
      }),
    /C:\\missing\\chrome\.exe/,
  );
});
