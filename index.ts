import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";
import { sleep } from "./src/sleep.ts";
console.log('Chromium starting...');
const browser = await chromium.launch();
const incognitoCtx = await browser.newContext();
const page = await incognitoCtx.newPage();

const promiseOfMpdJson = new Promise(async (res) => {
    const dirPath = path.resolve(".output");
    await fs.rm(dirPath, { recursive: true, force: true }); // rm previous
    page.on("response", async (response) => {
        const isJson =
            response.url().endsWith(".json") ||
            response.headers()["content-type"]?.includes("application/json");
        if (!isJson) {
            return;
        }
        await fs.mkdir(dirPath, { recursive: true });
        const jsonStr = await response.text();
        const hasManifest = jsonStr.includes("application/dash+xml");
        if (hasManifest) {
            const jsonMpdPath = path.resolve(dirPath, "jsonWithManifest.json");
            await fs.writeFile(jsonMpdPath, jsonStr);
            const jsonParsed = await response.json();
            const encodedMpd = jsonParsed["playlist"];
            const decodedMpd = Buffer.from(encodedMpd, "base64").toString(
                "utf-8"
            );
            const manifestPath = path.resolve(dirPath, "manifest.mpd");
            await fs.writeFile(manifestPath, decodedMpd);
            res(undefined);
        } else {
            const filePath = path.resolve(
                dirPath,
                Date.now().toString() + ".json"
            );
            await fs.writeFile(filePath, jsonStr);
        }
    });
});

console.log('Opening page...');
await page.goto(
    "https://dev.epicgames.com/community/learning/courses/yvZ/unreal-engine-animation-fellowship-week-1/vvlw/transitioning-from-legacy-production-to-unreal-engine"
);
const playButton = await page.$(".vjs-big-play-button");
playButton?.click();
console.log('Downloading mpd manifest...');
await promiseOfMpdJson;
await browser.close();
console.log('Manifest downloaded!');
