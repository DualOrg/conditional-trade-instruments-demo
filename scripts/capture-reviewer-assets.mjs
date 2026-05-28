import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const baseUrl = process.env.DEMO_BASE_URL || "http://127.0.0.1:4176";
const outDir = resolve("assets");
const walkthroughPath = resolve(outDir, "tradeflow-walkthrough.webm");
const mobilePath = resolve(outDir, "tradeflow-mobile-390x844.png");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    if (!process.env.PLAYWRIGHT_NODE_MODULES) throw error;
    const require = createRequire(`${process.env.PLAYWRIGHT_NODE_MODULES.replace(/\/$/, "")}/package.json`);
    return require("playwright");
  }
}

async function setCaption(page, text) {
  await page.evaluate((caption) => {
    let element = document.getElementById("tourCaption");
    if (!element) {
      element = document.createElement("div");
      element.id = "tourCaption";
      document.body.appendChild(element);
    }
    element.textContent = caption;
  }, text);
}

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

await mkdir(outDir, { recursive: true });

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true });

const videoContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: {
    dir: outDir,
    size: { width: 960, height: 540 }
  }
});
const videoPage = await videoContext.newPage();
await videoPage.goto(`${baseUrl}/?demo=operator-cargo&reviewer=1`, { waitUntil: "networkidle" });
await videoPage.addStyleTag({
  content: `
    #tourCaption {
      align-items: center;
      background: rgba(14, 42, 51, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      bottom: 18px;
      box-shadow: 0 12px 32px rgba(14, 42, 51, 0.24);
      color: #fff;
      display: flex;
      font: 700 18px/1.35 Inter, system-ui, sans-serif;
      left: 50%;
      max-width: 860px;
      min-height: 56px;
      padding: 14px 18px;
      position: fixed;
      transform: translateX(-50%);
      width: calc(100% - 72px);
      z-index: 9999;
    }
  `
});

const steps = [
  "1/7 Reviewer lands on the control desk: synthetic shipment, live DUAL proof boundary is first-screen visible.",
  "2/7 The trade instrument is CTI-SG-AU-001, with the live DUAL object separated from the shipment ID.",
  "3/7 The proof rail links object, template, state hash, integrity hash, and proof bundle to DUAL explorer evidence.",
  "4/7 Recompute Proof exposes reviewer-side hash re-derivation without requiring operator credentials.",
  "5/7 Preview breach calls the public evaluator and returns a blocked decision hash without writing to DUAL.",
  "6/7 Local controls clearly remain preview-only until an operator-gated sync updates the DUAL object.",
  "7/7 Public reads, proof re-derivation, block explorer links, and explicit write boundaries are the reviewer contract."
];

await setCaption(videoPage, steps[0]);
await wait(8000);
await setCaption(videoPage, steps[1]);
await wait(8000);
await setCaption(videoPage, steps[2]);
await wait(8000);
await setCaption(videoPage, steps[3]);
await wait(8000);
await setCaption(videoPage, steps[4]);
await videoPage.locator("#forceBreachBtn").click();
await wait(10000);
await setCaption(videoPage, steps[5]);
await videoPage.locator("#instrumentValue").fill("149000");
await wait(9000);
await setCaption(videoPage, steps[6]);
await wait(9000);

const video = videoPage.video();
await videoPage.close();
await videoContext.close();
const rawVideoPath = await video.path();
await copyFile(rawVideoPath, walkthroughPath);
await rm(rawVideoPath, { force: true });

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(`${baseUrl}/?demo=operator-cargo`, { waitUntil: "networkidle" });
await mobilePage.screenshot({ path: mobilePath, fullPage: false });
const mobileMetrics = await mobilePage.evaluate(() => {
  const overflowing = Array.from(document.querySelectorAll("body *"))
    .filter((element) => element.scrollWidth > element.clientWidth + 1)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === "string" ? element.className : null,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }));
  return {
    viewport: "390x844",
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowing
  };
});
await mobileContext.close();
await browser.close();

console.log(JSON.stringify({
  walkthrough: walkthroughPath,
  mobile: mobilePath,
  mobileMetrics
}, null, 2));
