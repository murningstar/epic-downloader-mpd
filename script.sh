#!/bin/bash

ts-node index.ts
youtube-dl -o test.mp4 .output/manifest.mpd