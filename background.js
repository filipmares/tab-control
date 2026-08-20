import { createChromeAdapter } from "./chrome-adapter.mjs";
import { createBackgroundMessageListener } from "./background-logic.mjs";

const browser = createChromeAdapter(chrome);

chrome.runtime.onMessage.addListener(createBackgroundMessageListener(browser));
