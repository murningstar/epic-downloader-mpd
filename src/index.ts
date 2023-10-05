/* nodejs */
import afs from "fs/promises";
import fs from "fs";
import path from "path";
import { exit, kill } from "process";

/* Libs */
// @ts-ignore
import mpdParser from "mpd-parser";
import { PromisePool } from "@supercharge/promise-pool";
// @ts-ignore
import commandLineArgs from "command-line-args";
import { chromium } from "playwright";
import axios from "axios";
import fetch from "node-fetch";
// @ts-ignore
import shell from "shelljs";

/* Mine */
import { sleep } from "./sleep.js";

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
        // await afs.writeFile(path.resolve(".output/manifest.xml"), decodedManifest);
        res(undefined);
        return;
    });
});

/* cli args */
const args = commandLineArgs(argsDefinitions);
const url =
    args.link ||
    args.url ||
    // TODO: удалить hardcoded url
    "https://dev.epicgames.com/community/learning/courses/yvZ/unreal-engine-animation-fellowship-week-1/vvlw/transitioning-from-legacy-production-to-unreal-engine";
if (!url) {
    print("No valid url provided. Use `--link <url>` option.");
    exit(0);
}

print("Opening page...");

await page.goto(url);

const playButton = await page.$(".vjs-big-play-button");
playButton?.click();
const controlButton = await page.$("vjs-play-control");
controlButton?.click();

print("Downloading mpd manifest...");

await populateManifestPromise;

print("Manifest obtained!");

print("Shutting down chromium...");

await page.close();
await incognitoCtx.close();
await browser.close();

let videoSegsData = (parsedManifest!.playlists as any[]).filter((track) => {
    return track.attributes.RESOLUTION.height === 1080;
})[0];
let audioSegsData = parsedManifest!.mediaGroups.AUDIO.audio.eng.playlists[0];
const initUrl1080: string = videoSegsData.segments[0].map.resolvedUri;
const initUrlAudio: string = audioSegsData.segments[0].map.resolvedUri;
const segmentsUrls1080: string[] = videoSegsData!.segments.map(
    (seg1080Data: any) => seg1080Data.resolvedUri
);
const segmentsUrlsAudio: string[] = audioSegsData.segments.map(
    (segAudioData: any) => segAudioData.resolvedUri
);

const outputFolder = ".output";

await afs.mkdir(path.resolve(outputFolder), { recursive: true });

const folderName = new URL(url).pathname.split("/").at(-1);
const fullPath = outputFolder + "/" + folderName;

await afs.mkdir(path.resolve(fullPath), { recursive: true });

print(`"${fullPath}/" directory created.`);

const headers = {
    "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
    "Accept-Encoding": "gzip, deflate, br",
    Origin: "https://dev.epicgames.com",
    DNT: "1",
    Connection: "keep-alive",
    Referer: "https://dev.epicgames.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    TE: "trailers",
};

async function fetchAndPersist(
    url: string,
    indexForFileName: number,
    isAudio?: boolean
) {
    const filePath = isAudio
        ? `${fullPath}/${indexForFileName}-audio.m4s`
        : `${fullPath}/${indexForFileName}-video.m4s`;
    const writeStream = fs.createWriteStream(filePath);
    const abortController = new AbortController();
    try {
        await new Promise(async (res, rej) => {
            const response = await fetch(url, {
                headers,
                signal: abortController.signal,
            });
            const stuckTimeout = setTimeout(() => {
                abortController.abort();
                rej("download_stuck");
            }, 30 * 1000);
            response.body?.pipe(writeStream);
            response.body?.on("error", () => rej("chunk_downloading_error"));
            response.body?.on("close", res);
        });
    } catch (error) {
        console.log(error);
    }
    writeStream.close();
    if (abortController.signal.aborted) {
        console.log(`Redownloading chunk - #${indexForFileName}`);
        await afs.rm(filePath);
        await fetchAndPersist(url, indexForFileName);
    }
    return;
}

print("Downloading segments...");
await fetch(initUrl1080, { headers })
    .then((response) => response.arrayBuffer())
    .then((arrayBuffer) => Buffer.from(new Uint8Array(arrayBuffer)))
    .then((buffer) => afs.writeFile(fullPath + "/init1080.mp4", buffer));
await fetch(initUrlAudio, { headers })
    .then((response) => response.arrayBuffer())
    .then((arrayBuffer) => Buffer.from(new Uint8Array(arrayBuffer)))
    .then((buffer) => afs.writeFile(fullPath + "/initAudio.mp4", buffer));
await new PromisePool()
    .for(segmentsUrls1080.slice(0, 50))
    .withConcurrency(50)
    .process(async (url, ix) => {
        await fetchAndPersist(url, ix + 1);
    });
await new PromisePool()
    .for(segmentsUrlsAudio.slice(0, 50))
    .withConcurrency(50)
    .process(async (url, ix) => {
        await fetchAndPersist(url, ix + 1, true);
    });
print("Segments downloaded.");

print("Concatenating...");

// Concat video- init&segments into tempVideo.mp4
shell.exec(
    `cat .output/${folderName}/init1080.mp4 > tempVideo.mp4
    for i in $(seq 1 ${50}); do \
        cat ".output/${folderName}/$i-video.m4s" >> tempVideo.mp4
        done`
);
// Refragmentation of video
shell.exec(
    `ffmpeg -i tempVideo.mp4 -codec copy -movflags +faststart concatedVideo.mp4`
);
// Concat audio- init&segments into tempAudio.mp4
shell.exec(
    `cat .output/${folderName}/initAudio.mp4 > tempAudio.mp4
    for i in $(seq 1 ${50}); do \
        cat ".output/${folderName}/$i-audio.m4s" >> tempAudio.mp4
        done`
);
// Refragmentation of audio
shell.exec(
    `ffmpeg -i tempAudio.mp4 -codec copy -movflags +faststart concatedAudio.mp4`
);
// Remove temp
shell.exec(`rm tempVideo.mp4 tempAudio.mp4 && rm -rf .output/${folderName}/`);
// OUTPUT RESULT
shell.exec(`ffmpeg -i concatedVideo.mp4 -i concatedAudio.mp4 -c copy .output/${folderName}.mp4`);
// Remove temp
shell.exec(`rm concatedVideo.mp4 concatedAudio.mp4`);

kill(0);
