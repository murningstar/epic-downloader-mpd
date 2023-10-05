/* nodejs */
import afs from "fs/promises";
import path from "path";
import { exit, kill } from "process";
/* Libs */
// @ts-ignore
import mpdParser from "mpd-parser";
// @ts-ignore
import commandLineArgs from "command-line-args";
import { chromium } from "playwright";
const argsDefinitions = [
    { name: "url", alias: "u", type: String },
    { name: "link", alias: "l", type: String },
];
function print(message) {
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
        const isJson = response.url().endsWith(".json") ||
            response.headers()["content-type"]?.includes("application/json");
        if (!isJson) {
            return;
        }
        const jsonObj = await response.json();
        const hasManifest = jsonObj["playlistType"] === "application/dash+xml";
        if (!hasManifest) {
            return;
        }
        const decodedManifest = Buffer.from(jsonObj["playlist"], "base64").toString("utf-8");
        parsedManifest = mpdParser.parse(decodedManifest);
        res(undefined);
        return;
    });
});
/* cli args */
const args = commandLineArgs(argsDefinitions);
const url = args.link ||
    args.url ||
    // TODO: удалить hardcoded url
    "https://dev.epicgames.com/community/learning/courses/yvZ/unreal-engine-animation-fellowship-week-1/vvlw/transitioning-from-legacy-production-to-unreal-engine";
if (!url) {
    console.log("No valid url provided. Use `--link <url>` option.");
    exit(0);
}
print("Opening page...");
await page.goto(url);
// const playButton = await page.$(".vjs-big-play-button");
// playButton?.click();
print("Downloading mpd manifest...");
await populateManifestPromise;
print("Manifest obtained!");
let videoSegsData = parsedManifest.playlists.filter((track) => {
    return track.attributes.RESOLUTION.height === 1080;
})[0];
let audioSegsData = parsedManifest.mediaGroups.AUDIO.audio.eng.playlists[0].segments;
const segmentsUrls1080 = videoSegsData.segments.map((seg1080Data) => seg1080Data.resolvedUri);
await afs.mkdir(path.resolve(".output"), { recursive: true });
const folderName = new URL(url).pathname.split("/").at(-1);
await afs.mkdir(path.resolve(`.output/${folderName}`), { recursive: true });
print(`"./output/${folderName}/" directory created.`);
print("Downloading segments...");
/* Надо проверить 2 варианта
1) Мейн фетчит и отправляет воркерам на ser/des
2) Воркер сам фетчит и сердесит, возвращая только результат */
const workerJS = await afs.readFile(path.resolve("./src/worker.ts"), {
    encoding: "utf-8",
});
/* Регистрация воркеров */
await page.evaluate(([workerJS]) => {
    const workerCount = navigator.hardwareConcurrency - 1;
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push(new Worker(URL.createObjectURL(new Blob([workerJS], { type: "application/javascript" }))));
    }
    workers.forEach(worker => worker.postMessage('start'));
}, [workerJS]);
// await sleep(3)
const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0",
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
// Define the URL for the request
const url2 = "https://epic-developer-community.qstv.on.epicgames.com/9266d334-661e-4311-ba7f-8481b051f4b5/segment_1_222.m4s";
// Make the GET request with custom headers
try {
    const response = await fetch(url2, {
        headers
    });
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    await afs.writeFile(path.resolve(".output/222.m4s"), data);
    // const axiosres = await axios.get(url2, { headers })
    // axiosres.data
}
catch (e) {
    console.log('axios error');
    console.log(e);
}
// const buffersArr = await page.evaluate(async (segUrls) => {
//     const promises = segUrls.map((url) => fetch(url));
//     const responses = await Promise.all(promises);
//     const returnArr = [];
//     for (let i = 0; i < responses.length; i++) {
//         const arraybuffer = await responses[i].arrayBuffer();
//         const serzble = Array.from(new Uint8Array(arraybuffer));
//         returnArr.push(serzble);
//     }
//     return returnArr;
// }, segmentsUrls1080?.slice(0, 10));
// console.log("obtained buffers from chromium");
// buffersArr.forEach((file, i) => {
//     console.log(`file #${i + 1}`, new Date().getSeconds());
//     fs.writeFileSync(`.output/${folderName}/${i + 1}.m4s`, Buffer.from(file));
// });
// await sleep(10)
/* await PromisePool.for((videoSegsData! as []).slice(0, 20)).process(
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
); */
/* await Promise.allSettled(
    (videoSegsData! as []).slice(0, 20).map((segment: any, i) => {
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
print("Shutting down chromium...");
await page.close();
await incognitoCtx.close();
await browser.close();
kill(0);
