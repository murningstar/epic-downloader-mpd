import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { sleep } from "./src/sleep.ts";
// @ts-ignore
import mpdParser from "mpd-parser";

console.log("Chromium starting...");
const browser = await chromium.launch();
const incognitoCtx = await browser.newContext();
const page = await incognitoCtx.newPage();

let parsedManifest;

const promiseOfMpdJson = new Promise(async (res) => {
    const dirPath = path.resolve(".content");
    await fs.rm(path.resolve(".content"), {
        recursive: true,
        force: true,
    });
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
            const manifestPath = path.resolve(dirPath, "manifest.xml");
            await fs.writeFile(manifestPath, decodedMpd);

            //
            parsedManifest = mpdParser.parse(decodedMpd);
            await fs.writeFile(
                path.resolve(".content/jsonManifest.json"),
                JSON.stringify(parsedManifest)
            );
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

console.log("Opening page...");
await page.goto(
    "https://dev.epicgames.com/community/learning/courses/yvZ/unreal-engine-animation-fellowship-week-1/vvlw/transitioning-from-legacy-production-to-unreal-engine"
);
const playButton = await page.$(".vjs-big-play-button");
playButton?.click();
console.log("Downloading mpd manifest...");
await promiseOfMpdJson;
await browser.close();
console.log("Manifest downloaded!");

console.log(parsedManifest!.duration);
