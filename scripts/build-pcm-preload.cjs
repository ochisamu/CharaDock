// SPDX-License-Identifier: Apache-2.0
// Electron's sandboxed preload can require only Electron modules. Embed the
// shared, dependency-free player instead of weakening the mascot sandbox.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname,"..");
const shared = fs.readFileSync(path.join(root,"desktop/pcm-speech-player.js"),"utf8");
const start = shared.indexOf("this, function() {\n") + "this, function() {\n".length;
const end = shared.lastIndexOf("\n});");
if (start < 20 || end < start) throw new Error("PCM player wrapper changed");
const generated = "  // BEGIN GENERATED PCM PLAYER\n  const pcmSpeech = (() => {\n" + shared.slice(start,end) + "\n  })();\n  // END GENERATED PCM PLAYER";
const file = path.join(root,"desktop/preload-mascot.cjs");
const source = fs.readFileSync(file,"utf8");
const output = source.replace(/  \/\/ BEGIN GENERATED PCM PLAYER[\s\S]*?  \/\/ END GENERATED PCM PLAYER/,generated);
if (output === source && !source.includes(generated)) throw new Error("PCM preload marker missing");
if (output !== source) fs.writeFileSync(file,output);
