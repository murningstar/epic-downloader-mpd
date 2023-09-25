/* nodejs */
import fs from "fs/promises";
import path from "path";
import { exit } from "process";

/* Libs */
// @ts-ignore
import mpdParser from "mpd-parser";
import { PromisePool } from "@supercharge/promise-pool";
// @ts-ignore
import commandLineArgs from "command-line-args";
import { chromium } from "playwright";
import axios from "axios";

import { sleep } from "./src/sleep.ts";

const argsDefinitions = [
    { name: "url", alias: "u", type: String },
    { name: "link", alias: "l", type: String },
];

function print(message: string) {
    console.log(message);
}

///* Main *///

let parsedManifest;

print("Chromium starting...");

const browser = await chromium.launch();
const incognitoCtx = await browser.newContext();
const page = await incognitoCtx.newPage();

const populateManifestPromise = new Promise(async (res) => {
    page.on("response", async (response) => {
        const isJson =
            response.url().endsWith(".json") ||
            response.headers()["content-type"]?.includes("application/json");
        if (!isJson) {
            return;
        }
        const jsonObj = await response.json();
        const hasManifest = jsonObj["playlistType"] === "application/dash+xml";
        if (!hasManifest) {
            return;
        }
        const decodedManifest = Buffer.from(
            jsonObj["playlist"],
            "base64"
        ).toString("utf-8");
        parsedManifest = mpdParser.parse(decodedManifest);
        res(undefined);
        return;
    });
});

/* cli args */
const args = commandLineArgs(argsDefinitions);
const url = args.link || args.url;
/* if (!url) {
    console.log("No valid url provided. Use `--link <url>` option.");
    exit(0);
} */

print("Opening page...");

// await page.goto(url);

const devUrl =
    "https://dev.epicgames.com/community/learning/courses/yvZ/unreal-engine-animation-fellowship-week-1/vvlw/transitioning-from-legacy-production-to-unreal-engine";
await page.goto(devUrl);

const playButton = await page.$(".vjs-big-play-button");
playButton?.click();

print("Downloading mpd manifest...");

await populateManifestPromise;

print("Manifest obtained!");

let videoSegs;
let audioSegs =
    parsedManifest!.mediaGroups.AUDIO.audio.eng.playlists[0].segments;

//populate `videosegs` variable with 1080 segments array
await new Promise((res) => {
    for (const track of parsedManifest!.playlists) {
        if (track.attributes.RESOLUTION.width === 1920) {
            videoSegs = track.segments;
            res(undefined);
            return;
        }
    }
});

/* await page.evaluate(async () => {
    return await fetch(
        "https://epic-developer-community.qstv.on.epicgames.com/9266d334-661e-4311-ba7f-8481b051f4b5/"
    )
        .then((response) => response.blob())
        .then((blob) => blob);
}); */
/* await PromisePool.for(videoSegs!).process(async (videoSeg, index, pool) => {
    axios.
}); */

print("Shutting down chromium...");

await page.close();
await incognitoCtx.close();
await browser.close();
