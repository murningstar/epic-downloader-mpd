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

function print(message: string | number) {
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

const populateVideoSegs1080 = new Promise((res) => {
    for (const track of parsedManifest!.playlists) {
        if (track.attributes.RESOLUTION.height === 1080) {
            videoSegs = track.segments;
            res(undefined);
            return;
        }
    }
});
await populateVideoSegs1080;

console.log("Output directory created.");

await fs.mkdir(path.resolve(".output"));

console.log("Downloading segments...");

await PromisePool.for((videoSegs! as []).slice(0, 20)).process(
    // job for each segment
    async (videoSeg: any, index, pool) => {
        const arrayedBuffer = await page.evaluate((url) => {
            return fetch(url)
                .then((response) => response.arrayBuffer())
                .then((buffer) => Array.from(new Uint8Array(buffer)));
        }, videoSeg.resolvedUri);

        const buffer = Buffer.from(arrayedBuffer);
        await fs.writeFile(path.resolve(`.output/${videoSeg.uri}`), buffer);
        print("segment #" + index + "saved");
    }
);



/* await Promise.allSettled(
    (videoSegs! as []).slice(0, 20).map((segment: any, i) => {
        return Promise.resolve()
            .then(() => {
                return page.evaluate((url) => {
                    return fetch(url)
                        .then((response) => response.arrayBuffer())
                        .then((buffer) => Array.from(new Uint8Array(buffer)));
                }, segment.resolvedUri);
            })
            .then((arrayedBuffer) => {
                return fs.writeFile(
                    path.resolve(`.output/${segment.uri}`),
                    Buffer.from(arrayedBuffer)
                );
            });
    })
); */

console.log("Done!");

/* await page.evaluate(async () => {
    return await fetch(
        "https://epic-developer-community.qstv.on.epicgames.com/9266d334-661e-4311-ba7f-8481b051f4b5/"
    )
        .then((response) => response.blob())
        .then((blob) => blob);
}); */

print("Shutting down chromium...");

await page.close();
await incognitoCtx.close();
await browser.close();
