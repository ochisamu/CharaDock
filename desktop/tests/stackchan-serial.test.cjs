// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { StackchanSerialGateway, STACKCHAN_BOARD } = require("../lib/stackchan-serial.cjs");
const { validatedDevice } = require("../lib/rlcd42-serial.cjs");
const { validDeviceId } = require("../lib/rlcd42-wifi.cjs");
const { rgb565Portrait } = require("../lib/stackchan-portrait.cjs");
const { FRAME_TYPES, crc32 } = require("../lib/device-protocol-v2.cjs");

test("StackChan motion maps clear commands without intercepting ordinary conversation", () => {
  const { stackchanVoiceMotion } = require("../lib/stackchan-voice-motion.cjs");
  assert.equal(stackchanVoiceMotion("右向いて", { directed: true }).id, 8);
  assert.equal(stackchanVoiceMotion("スタックちゃん、回って！").id, 11);
  assert.equal(stackchanVoiceMotion("回転してください。", { directed: true }).id, 11);
  assert.equal(stackchanVoiceMotion("一回転して", { directed: true }).id, 11);
  assert.equal(stackchanVoiceMotion("１回転してね", { directed: true }).id, 11);
  assert.equal(stackchanVoiceMotion("右を向け", { directed: true }).id, 8);
  assert.equal(stackchanVoiceMotion("左を向け", { directed: true }).id, 9);
  assert.equal(stackchanVoiceMotion("正面に戻って", { directed: true }).id, 10);
  assert.equal(stackchanVoiceMotion("右向いて"), null);
  assert.equal(stackchanVoiceMotion("右向いてと言ってみて", { directed: true }), null);
  assert.equal(stackchanVoiceMotion("クルッと回ってくれる？", { directed: true }).id, 11);
  assert.equal(stackchanVoiceMotion("首を左右に振ってください。", { directed: true }).id, 11);
  assert.equal(stackchanVoiceMotion("改訂してください。", { directed: true }), null);
  assert.equal(stackchanVoiceMotion("一回転してって言ったよ", { directed: true }), null);
  assert.equal(stackchanVoiceMotion("てんして", { directed: true }), null);
  for (const [phrase, id] of [
    ["上向いて", 13], ["見上げてくれる？", 13], ["顔を上げて", 13], ["下を向いてくださいね", 14], ["下を向いて下さい", 14],
    ["お辞儀して", 15], ["首をかしげて", 16], ["右上を向いて", 17], ["左上を見て", 18],
    ["右下向け", 19], ["左下を向いて", 20], ["look up and left", 18],
    ["こっち向いてね", 10], ["首の動きを止めて", 10],
  ]) {
    assert.equal(stackchanVoiceMotion(phrase, { directed: true })?.id, id, phrase);
  }
  for (const phrase of ["上を向いている？", "右上を見てと言って", "首をかしげないで"]) {
    assert.equal(stackchanVoiceMotion(phrase, { directed: true }), null, phrase);
  }
});

test("StackChan only sends voice commands advertised by the firmware", async () => {
  const gateway = new StackchanSerialGateway();
  const writes = [];
  gateway.writeWithAck = async (type, bytes) => { writes.push([type, bytes[0]]); };
  const motion = { enabled: true, voiceCommands: true };
  gateway.capabilities = { capabilities: { motion } };
  assert.equal(await gateway.sendVoiceMotion(13), false);
  assert.equal(await gateway.sendVoiceMotion(8), true);
  motion.voiceMotionMaxCommand = 20;
  assert.equal(await gateway.sendVoiceMotion(13), true);
  assert.equal(await gateway.sendVoiceMotion(21), false);
  assert.equal(await gateway.sendVoiceMotion(12.5), false);
  motion.enabled = false;
  assert.equal(await gateway.sendVoiceMotion(13), false);
  assert.deepEqual(writes, [[0x66, 8], [0x66, 13]]);
});

test("StackChan retries a lost display state acknowledgement only while the state is current", async () => {
  const gateway = new StackchanSerialGateway();
  const writes = [];
  gateway.writeWithAck = async (type, bytes, options) => { writes.push({ type, value: bytes[0], options }); };
  await gateway.setDeviceState("listening");
  assert.equal(writes[0].type, FRAME_TYPES.STATE);
  assert.ok(writes[0].options.retryTimeouts.length > 1);
  assert.equal(writes[0].options.shouldRetry(), true);
  await gateway.setDeviceState("speaking");
  assert.deepEqual(writes.map(write => write.value), [1, 3]);
  assert.equal(writes[0].options.shouldRetry(), false);
  assert.equal(writes[1].options.shouldRetry(), true);
});

test("StackChan Live motion waits for capture end and handles delta-only transcripts once", async () => {
  const { StackchanLiveMotionInput } = require("../lib/stackchan-voice-motion.cjs");
  const input = new StackchanLiveMotionInput({ settleMs: 5 });
  const elapsed = () => new Promise(resolve => setTimeout(resolve, 20));
  const commands = [];
  const record = motion => commands.push(motion.id);
  input.begin();
  input.transcript("右向いて", record);
  await elapsed();
  assert.deepEqual(commands, []);
  input.transcript("ください", record);
  input.end();
  await elapsed();
  input.transcript("右向いてください。", record, { final: true });
  assert.deepEqual(commands, [8]);
  input.begin();
  input.transcript("回転して", record);
  input.end();
  input.transcript("という言葉を説明して", record);
  await elapsed();
  assert.deepEqual(commands, [8]);
  input.begin();
  input.end();
  input.transcript("回転してください。", record, { final: true });
  assert.deepEqual(commands, [8, 11]);
  input.begin();
  input.end();
  input.transcript("右向いて", record);
  input.cancel();
  await elapsed();
  assert.deepEqual(commands, [8, 11]);
  input.begin();
  input.transcript("右上を", record);
  input.transcript("向いて", record);
  input.end();
  await elapsed();
  assert.deepEqual(commands, [8, 11, 17]);
});

test("physical StackChan face tracking updates the current profile and respects camera access", async () => {
  const { readFileSync } = require("node:fs");
  const { runInNewContext } = require("node:vm");
  const main = readFileSync(require.resolve("../main.cjs"), "utf8");
  const source = main.slice(main.indexOf("function createRlcd42Gateway("),
    main.indexOf("async function configureRlcd42("));
  let profile = { type: STACKCHAN_BOARD, cameraEnabled: true };
  const changes = [];
  const context = {
    Rlcd42Hub: class { constructor(callbacks) { this.callbacks = callbacks; } },
    StackchanSerialGateway, STACKCHAN_BOARD, diagnosticLog: null,
    rlcd42Profile: () => profile,
    stackchanProfile: current => current.type === STACKCHAN_BOARD,
    stackchanPrivacyMuted: false,
    configureRlcd42: patch => changes.push(patch.faceTrackingEnabled),
  };
  runInNewContext(source, context);
  const { onInput } = context.createRlcd42Gateway().callbacks;
  await onInput({ event: 9, button: 0, durationMs: 1 });
  await onInput({ event: 9, button: 0, durationMs: 0 });
  profile.cameraEnabled = false;
  await onInput({ event: 9, button: 0, durationMs: 1 });
  profile.cameraEnabled = true;
  context.stackchanPrivacyMuted = true;
  await onInput({ event: 9, button: 0, durationMs: 1 });
  context.stackchanPrivacyMuted = false;
  profile = { type: "waveshare-rlcd-4.2" };
  await onInput({ event: 9, button: 0, durationMs: 1 });
  assert.deepEqual(changes, [true, false]);
});

test("board identity is explicit and cannot cross-pair RLCD with StackChan", () => {
  assert.equal(validDeviceId("stackchan-001122334455", STACKCHAN_BOARD), true);
  assert.equal(validDeviceId("stackchan-001122334455"), false);
  assert.equal(validDeviceId("cd-rlcd-001122334455", STACKCHAN_BOARD), false);
  const hello = { board: STACKCHAN_BOARD, deviceId: "stackchan-001122334455" };
  const caps = { protocol: 2, board: STACKCHAN_BOARD, capabilities: { display: { width:320,height:240,bitsPerPixel:16,bitmap:["rgb565le"] } } };
  assert.equal(validatedDevice(hello,caps,STACKCHAN_BOARD).board, STACKCHAN_BOARD);
  assert.throws(() => validatedDevice(hello,caps));
  assert.throws(() => validatedDevice(hello,{...caps,protocol:1},STACKCHAN_BOARD));
});

test("colour assets preserve RGB565 and atomic metadata/chunk boundaries", async () => {
  const portrait = rgb565Portrait({ width: 4,height:3,data:Buffer.from(Array(12).fill([255,0,0,255]).flat()) });
  assert.equal(portrait.pixels.length,153600);
  assert.equal(portrait.pixels.readUInt16LE(0),0xf800);
  const frames = [], gateway = new StackchanSerialGateway();
  gateway.writeWithAck = async (type,payload) => { frames.push({type,payload}); return {applyResult:0}; };
  await gateway.sendPortrait(portrait);
  const metadata = frames.find(f=>f.type===FRAME_TYPES.ASSET_META).payload;
  assert.equal(metadata.readUInt32LE(9),crc32(portrait.pixels));
  const chunks = frames.filter(f=>f.type===FRAME_TYPES.ASSET_CHUNK);
  let offset=0;
  for(const f of chunks) { assert.equal(f.payload.readUInt32LE(0),offset); offset+=f.payload.length-4; }
  assert.deepEqual(Buffer.concat(chunks.map(f=>f.payload.subarray(4))),portrait.pixels);
  assert.equal(frames.at(-2).type,FRAME_TYPES.ASSET_END);
  assert.equal(frames.at(-1).payload[0],0);
  frames.length=0;
  await assert.rejects(gateway.sendPortrait({...portrait,pixels:Buffer.alloc(15000)}));
  assert.equal(frames.length,0);
});

test("audio uses StackChan 11-byte configuration and retries only explicit ring-full", async () => {
  const g = new StackchanSerialGateway();
  g.connectionState="ready"; g.capabilities={capabilities:{audio:{playback:true}}};
  let begin, attempts=0;
  g.writeWithAck=async(type,payload)=> {
    if(type===FRAME_TYPES.AUDIO_BEGIN) begin=payload;
    if(type===FRAME_TYPES.AUDIO_CHUNK && ++attempts===1) throw Object.assign(new Error("full"),{deviceResponse:{audioResult:5}});
  };
  const generation=await g.beginPcm16Playback(16000,500000);
  assert.equal(begin.length,11); assert.equal(begin.readUInt32LE(1),16000);
  assert.equal(begin[7],72); assert.equal(begin.readUInt16LE(8),200);
  await g.writePcm16PlaybackChunk(Buffer.alloc(4096),generation);
  assert.equal(attempts,2);
  g.writeWithAck=async()=>{ throw new Error("ACK lost"); };
  await assert.rejects(g.writePcm16PlaybackChunk(Buffer.alloc(4),generation),/ACK lost/);
  g.playbackGeneration++;
  assert.deepEqual(await g.writePcm16PlaybackChunk(Buffer.alloc(4),generation),{interrupted:true});
});

test("scenes retain name/caption but do not send monochrome scene protocol", async () => {
  const g=new StackchanSerialGateway(),frames=[];
  g.writeWithAck=async(type,payload)=>frames.push({type,payload});
  await g.sendScene({state:"working",characterName:"コハク",caption:"考えています"});
  assert.equal(frames[0].type,FRAME_TYPES.STATE); assert.equal(frames[0].payload[0],2);
  assert.equal(frames[1].type,0x60);
  assert.equal(JSON.parse(frames[1].payload).name,"コハク");
  assert.equal(frames.some(f=>f.type===FRAME_TYPES.MOTION),false);
  await g.setMotionEnabled(true);
  assert.equal(frames.at(-1).type,FRAME_TYPES.MOTION);
  assert.deepEqual(frames.at(-1).payload,Buffer.from([1]));
  await g.setMotionEnabled(false);
  assert.deepEqual(frames.at(-1).payload,Buffer.from([0]));
});

test("Hands-free and preview negotiate firmware capabilities", async () => {
  const gateway = new StackchanSerialGateway();
  const frames = [];
  gateway.connectionState = "ready";
  gateway.writeWithAck = async (type, payload) => frames.push([type, [...payload]]);
  gateway.capabilities = { capabilities: { audio: { capture: true } } };
  await gateway.setCaptureMode("hands-free", 200);
  assert.deepEqual(frames.at(-1), [FRAME_TYPES.CAPTURE_CONFIG, [0, 200, 0]]);
  await assert.rejects(gateway.startCameraPreview(), /updated firmware/);
  gateway.capabilities.capabilities.audio.handsFree = true;
  gateway.capabilities.capabilities.camera = { localPreview: true };
  await gateway.setCaptureMode("hands-free", 200);
  assert.deepEqual(frames.at(-1), [FRAME_TYPES.CAPTURE_CONFIG, [1, 200, 0]]);
  await gateway.setCaptureMode("camera-hands-free", 200);
  assert.deepEqual(frames.at(-1), [FRAME_TYPES.CAPTURE_CONFIG, [0, 200, 0]]);
  gateway.capabilities.capabilities.camera.conversationGate = true;
  await gateway.setCaptureMode("camera-hands-free", 200);
  assert.deepEqual(frames.at(-1), [FRAME_TYPES.CAPTURE_CONFIG, [3, 200, 0]]);
  await gateway.startCameraPreview();
  assert.deepEqual(frames.at(-1), [0x61, []]);
  await gateway.useNativeFace();
  assert.deepEqual(frames.at(-1), [FRAME_TYPES.DISPLAY_MODE, [2]]);
});

test("StackChan waits for its speaker to drain before returning playback", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: { playback: true, playbackStatus: true } } };
  const events = [];
  gateway.writeWithAck = async (type, payload) => {
    if (type === FRAME_TYPES.AUDIO_BEGIN) assert.equal(payload.readUInt16LE(8), 500);
    events.push([type, payload[7]]);
  };
  let active = true;
  gateway.requestFrame = async (request, payload, response) => {
    assert.equal(request, FRAME_TYPES.AUDIO_STATUS);
    assert.equal(response, request);
    assert.equal(payload.length, 0);
    events.push([request, Number(active)]);
    const status = { payload: Buffer.from([Number(active)]) };
    active = false;
    return status;
  };
  const generation = await gateway.beginPcm16Playback();
  assert.deepEqual(await gateway.endPcm16Playback(generation), { interrupted: false });
  assert.deepEqual(events, [
    [FRAME_TYPES.STATE, undefined],
    [FRAME_TYPES.AUDIO_BEGIN, 112],
    [FRAME_TYPES.AUDIO_END, undefined],
    [FRAME_TYPES.AUDIO_STATUS, 1],
    [FRAME_TYPES.AUDIO_STATUS, 0],
    [FRAME_TYPES.STATE, undefined],
  ]);
});

test("StackChan budgets separate prebuffers for finite TTS, USB Live and Wi-Fi Live", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: { playback: true, playbackStatus: true } } };
  const prebuffers = [];
  gateway.writeWithAck = async (type, payload) => {
    if (type === FRAME_TYPES.AUDIO_BEGIN) prebuffers.push(payload.readUInt16LE(8));
  };
  await gateway.beginPcm16Playback(16_000, 25_000);
  await gateway.beginPcm16Playback();
  gateway.transport = "wifi";
  await gateway.beginPcm16Playback();
  gateway.capabilities.capabilities.audio.maxPrebufferMs = 1000;
  await gateway.beginPcm16Playback();
  gateway.transport = "usb";
  await gateway.beginPcm16Playback();
  assert.deepEqual(prebuffers, [500, 500, 480, 600, 760]);
});

test("modern StackChan starts audio while the display acknowledgement is pending", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: { playback: true, playbackStatus: true } } };
  const events = [];
  let acknowledgeDisplay;
  gateway.writeWithAck = async (type, _payload, options) => {
    events.push(type);
    if (type === FRAME_TYPES.STATE) return new Promise(resolve => { acknowledgeDisplay = resolve; });
    assert.ok(options.retryTimeouts.length > 1);
    return { sequence: 1 };
  };
  await gateway.beginPcm16Playback();
  assert.deepEqual(events, [FRAME_TYPES.STATE, FRAME_TYPES.AUDIO_BEGIN]);
  assert.equal(gateway.activePlayback.sequence, 1);
  acknowledgeDisplay();
});

test("StackChan USB retries a lost chunk acknowledgement with the same sequence and payload", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: { playback: true, playbackStatus: true } } };
  const observations = [];
  gateway.writeFramesWithAck = async (frames, options) => {
    const [frame] = frames;
    if (frame.type !== FRAME_TYPES.AUDIO_CHUNK) return [{}];
    observations.push({ frame, timeout: options.timeoutMs });
    if (observations.length === 1) throw Object.assign(new Error("dropped ACK"), { code: "DEVICE_RESPONSE_TIMEOUT" });
    return [{}];
  };
  const generation = await gateway.beginPcm16Playback();
  assert.deepEqual(await gateway.writePcm16PlaybackChunk(Buffer.from([1, 2, 3, 4]), generation), { interrupted: false });
  assert.deepEqual(observations.map(item => item.timeout), [180, 420]);
  assert.ok(Number.isInteger(observations[0].frame.sequence));
  assert.deepEqual(observations[0].frame, observations[1].frame);
});

test("StackChan preloads finite PCM only within advertised capacity and cues playback after transfer", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.connectionState = "ready";
  gateway.capabilities = {
    capabilities: { audio: { playback: true, playbackStatus: true, completePlaybackSamples: 262144 } },
  };
  const events = [];
  gateway.writeWithAck = async (type, payload) => { events.push([type, payload]); };
  gateway.requestFrame = async () => ({ payload: Buffer.from([0]) });
  const pcm = Buffer.alloc(5_000, 42);
  await gateway.playPcm16(pcm, 16_000, { onPlaybackReady: () => events.push(["ready"]) });
  assert.deepEqual(events.map(([type]) => type), [
    FRAME_TYPES.STATE, FRAME_TYPES.AUDIO_BEGIN, FRAME_TYPES.AUDIO_CHUNK,
    FRAME_TYPES.AUDIO_CHUNK, "ready", FRAME_TYPES.AUDIO_END, FRAME_TYPES.STATE,
  ]);
  assert.equal(events[1][1].length, 15);
  assert.equal(events[1][1].readUInt32LE(11), pcm.length / 2);
  assert.deepEqual(Buffer.concat(events.slice(2, 4).map(([, payload]) => payload)), pcm);
  await gateway.beginPcm16Playback();
  assert.equal(events.at(-1)[1].length, 11);
  assert.equal(events.at(-1)[1].readUInt16LE(8), 500);
  await gateway.beginPcm16Playback(16_000, 262145);
  assert.equal(events.at(-1)[1].length, 11);
  assert.equal(events.at(-1)[1].readUInt16LE(8), 500);
});

test("StackChan preloads Wi-Fi PCM in bounded ordered batches and stops on cancellation", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.transport = "wifi";
  gateway.connectionState = "ready";
  gateway.capabilities = {
    capabilities: { audio: { playback: true, playbackStatus: true, completePlaybackSamples: 262144 } },
  };
  const chunks = [];
  let releaseBatch, batchArrived;
  const firstBatch = new Promise(resolve => { batchArrived = resolve; });
  gateway.writeWithAck = async () => {};
  gateway.writeFramesWithAck = async frames => {
    chunks.push(...frames.map(({ payload }) => payload[0]));
    await new Promise(resolve => {
      releaseBatch = resolve;
      batchArrived();
    });
  };
  const pcm = Buffer.concat(Array.from({ length: 8 }, (_, index) => Buffer.alloc(4096, index)));
  const playback = gateway.playPcm16(pcm);
  await firstBatch;
  assert.deepEqual(chunks, [0, 1, 2]);
  await gateway.stopPlayback();
  releaseBatch();
  assert.deepEqual(await playback, { interrupted: true });
  assert.deepEqual(chunks, [0, 1, 2]);
});

test("a timeout during the second TTS sentence resets only that sentence before committing", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.transport = "wifi";
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: {
    playback: true, playbackStatus: true, completePlaybackSamples: 262144, imaAdpcm: true,
  } } };
  const played = [];
  let staged = [];
  let begins = 0;
  const pcm = Buffer.alloc(8192);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(Math.sin(i / 13) * 2500), i);
  gateway.writeWithAck = async (type, payload) => {
    if (type === FRAME_TYPES.AUDIO_BEGIN) { begins += 1; staged = []; }
    if (type === FRAME_TYPES.AUDIO_CHUNK) staged.push(payload);
    if (type === FRAME_TYPES.AUDIO_END) played.push(staged);
  };
  gateway.requestFrame = async () => ({ payload: Buffer.from([0]) });
  gateway.writeFramesWithAck = async frames => {
    staged.push(frames[0].payload);
    if (begins === 2) throw Object.assign(new Error("missing packet confirmation"), { code: "DEVICE_RESPONSE_TIMEOUT" });
    staged.push(...frames.slice(1).map(({ payload }) => payload));
  };
  await gateway.playPcm16(pcm);
  await gateway.playPcm16(pcm);
  assert.equal(begins, 3);
  assert.equal(played.length, 2);
  assert.deepEqual(played[1], played[0]);
});

test("StackChan negotiates independently decodable IMA ADPCM packets over Wi-Fi", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.connectionState = "ready";
  gateway.transport = "wifi";
  gateway.capabilities = {
    capabilities: { audio: { playback: true, playbackStatus: true, completePlaybackSamples: 262144, imaAdpcm: true } },
  };
  const frames = new Map();
  gateway.writeWithAck = async (type, payload) => frames.set(type, payload);
  const pcm = Buffer.alloc(8);
  [100, 111, 97, 112].forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const generation = await gateway.beginPcm16Playback();
  await gateway.writePcm16PlaybackBatch([pcm], generation);
  assert.equal(frames.get(FRAME_TYPES.AUDIO_BEGIN)[10], 7);
  assert.deepEqual(frames.get(FRAME_TYPES.AUDIO_CHUNK), Buffer.from([4, 0, 100, 0, 0, 0xb7, 0x04]));
  gateway.capabilities.capabilities.audio.preferPcm16ForBufferedSpeech = true;
  await gateway.writePcm16PlaybackBatch([pcm], await gateway.beginPcm16Playback(16_000, 4));
  assert.equal(frames.get(FRAME_TYPES.AUDIO_BEGIN)[10], 3);
  assert.deepEqual(frames.get(FRAME_TYPES.AUDIO_CHUNK), pcm);
  await gateway.beginPcm16Playback();
  assert.equal(frames.get(FRAME_TYPES.AUDIO_BEGIN)[10], 7);
  gateway.transport = "usb";
  await gateway.writePcm16PlaybackChunk(pcm, await gateway.beginPcm16Playback());
  assert.equal(frames.get(FRAME_TYPES.AUDIO_BEGIN)[10], 3);
  assert.deepEqual(frames.get(FRAME_TYPES.AUDIO_CHUNK), pcm);
});

test("StackChan packs more PCM into each finite Wi-Fi TTS frame when supported", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.transport = "wifi";
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: {
    playback: true, playbackStatus: true, completePlaybackSamples: 262144,
    imaAdpcm: true, maxAdpcmPcmBytes: 12288,
  } } };
  const batches = [];
  gateway.writeWithAck = async () => {};
  gateway.requestFrame = async () => ({ payload: Buffer.from([0]) });
  gateway.writeFramesWithAck = async (frames) => batches.push(frames.map(({ payload }) => payload.readUInt16LE(0)));

  const playback = await gateway.playPcm16(Buffer.alloc(12288 * 2 + 34));
  assert.deepEqual(playback, { interrupted: false });
  assert.deepEqual(batches, [[6144], [6144], [17]]);
});

test("StackChan stages one complete phrase and prevents it playing after an interrupt", async () => {
  const gateway = new StackchanSerialGateway();
  gateway.transport = "wifi";
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: {
    playback: true, playbackStatus: true, completePlaybackSamples: 262144, stagedPlaybackSamples: 262144,
    imaAdpcm: true, maxAdpcmPcmBytes: 12288,
  } } };
  const events = [];
  gateway.writeFramesWithAck = async (frames) => {
    events.push(...frames.map(frame => frame.type));
    return frames.map(() => ({ sequence: events.length }));
  };
  gateway.requestFrame = async () => ({ payload: Buffer.from([0]) });
  const pcm = Buffer.alloc(16000);
  let staged;
  await gateway.playPcm16(pcm, 16000, {
    onPlaybackCommitted: (playback) => { staged = gateway.stagePcm16(pcm, playback); },
  });
  let handle = await staged;
  assert.ok(handle);
  assert.ok(events.includes(FRAME_TYPES.AUDIO_STAGE_END));
  assert.ok(!events.includes(FRAME_TYPES.AUDIO_STAGE_PLAY));
  await gateway.stopPlayback();
  assert.deepEqual(await gateway.playStagedPcm16(handle), { interrupted: true });
  assert.ok(!events.includes(FRAME_TYPES.AUDIO_STAGE_PLAY));
  await gateway.playPcm16(pcm, 16000, {
    onPlaybackCommitted: (playback) => { staged = gateway.stagePcm16(pcm, playback); },
  });
  handle = await staged;
  assert.deepEqual(await gateway.playStagedPcm16(handle), { interrupted: false });
  assert.equal(events.filter(type => type === FRAME_TYPES.AUDIO_STAGE_PLAY).length, 1);
});

test("StackChan reports a safe fallback only for an explicit staged playback rejection", async () => {
  const gateway = new StackchanSerialGateway();
  const staged = { sampleRate: 16000, totalSamples: 16000, completeBuffer: true };
  const refusal = Object.assign(new Error("staged playback refused"), {
    deviceResponse: { requestType: FRAME_TYPES.AUDIO_STAGE_PLAY, accepted: false },
  });
  gateway.commitPlayback = async () => { throw refusal; };
  assert.deepEqual(await gateway.playStagedPcm16({ ...staged, generation: gateway.playbackGeneration }),
    { stagedRejected: true });
  const timeout = Object.assign(new Error("speaker acknowledgement timeout"), { code: "DEVICE_RESPONSE_TIMEOUT" });
  gateway.commitPlayback = async () => { throw timeout; };
  await assert.rejects(gateway.playStagedPcm16({ ...staged, generation: gateway.playbackGeneration }), /timeout/);
});

for (const commitType of [FRAME_TYPES.AUDIO_END, FRAME_TYPES.AUDIO_STAGE_PLAY]) {
  test(`StackChan accepts speaker start when the commit ACK is lost for ${commitType}`, async () => {
    const gateway = new StackchanSerialGateway();
    gateway.connectionState = "ready";
    gateway.capabilities = { capabilities: { audio: {
      playback: true, playbackStatus: true, completePlaybackSamples: 262144,
    } } };
    const sequence = 81;
    const writes = [];
    let committed = 0;
    gateway.requestFrame = async () => ({ payload: Buffer.from([0]) });
    gateway.writeWithAck = async (type) => {
      writes.push(type);
      if (type === commitType) {
        // An unrelated or old notification must not confirm this commit.
        gateway.handleFrame({ type: FRAME_TYPES.AUDIO_PLAYBACK_STARTED, sequence: sequence - 1 });
        assert.equal(gateway.activePlayback.firstSoundAt, undefined);
        gateway.handleFrame({ type: FRAME_TYPES.AUDIO_PLAYBACK_STARTED, sequence });
        throw Object.assign(new Error("ACK timed out"), { code: "DEVICE_RESPONSE_TIMEOUT" });
      }
      return { sequence };
    };
    const options = { onPlaybackCommitted: () => { committed++; } };
    const result = commitType === FRAME_TYPES.AUDIO_END
      ? await gateway.endPcm16Playback(await gateway.beginPcm16Playback(16000, 16000, options))
      : await gateway.playStagedPcm16({ generation: 0, sampleRate: 16000, totalSamples: 16000,
        completeBuffer: true, sequence }, options);
    assert.deepEqual(result, { interrupted: false });
    assert.equal(committed, 1);
    assert.ok(!writes.includes(FRAME_TYPES.AUDIO_STOP));
  });
}

test("StackChan allows a streaming reply to drain its larger PSRAM queue", async (t) => {
  const gateway = new StackchanSerialGateway();
  gateway.connectionState = "ready";
  gateway.capabilities = {
    capabilities: { audio: { playback: true, playbackStatus: true, completePlaybackSamples: 262144 } },
  };
  gateway.writeWithAck = async () => {};
  let clock = 0;
  t.mock.method(Date, "now", () => clock);
  gateway.requestFrame = async () => {
    clock += 5000;
    return { payload: Buffer.from([clock < 15000 ? 1 : 0]) };
  };
  const generation = await gateway.beginPcm16Playback();
  assert.deepEqual(await gateway.endPcm16Playback(generation), { interrupted: false });
  assert.equal(clock, 15000);
});

test("RLCD and StackChan retain independent profiles and encrypted keys", () => {
  const fs=require("node:fs"), os=require("node:os"), path=require("node:path");
  const { Preferences }=require("../lib/preferences.cjs");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"stackchan-profile-test-"));
  const encryption={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(`encrypted:${s}`),decryptString:b=>b.toString().replace(/^encrypted:/,"")};
  const prefs=new Preferences(path.join(dir,"preferences.json"),encryption);
  prefs.patch({characterDeviceType:STACKCHAN_BOARD,deviceProfiles:{
    "rlcd42-default":{type:"waveshare-rlcd-4.2",deviceId:"cd-rlcd-001122334455",port:"COM4"},
    "stackchan-default":{type:STACKCHAN_BOARD,deviceId:"stackchan-aabbccddeeff",port:"COM5",captureMode:"hands-free"},
  }});
  prefs.setDevicePairingToken("rlcd42-default","aa".repeat(32));
  prefs.setDevicePairingToken("stackchan-default","bb".repeat(32));
  const reloaded=new Preferences(prefs.filePath,encryption);
  assert.equal(reloaded.data.characterDeviceType,STACKCHAN_BOARD);
  assert.equal(reloaded.data.deviceProfiles["rlcd42-default"].port,"COM4");
  assert.equal(reloaded.data.deviceProfiles["stackchan-default"].port,"COM5");
  assert.equal(reloaded.data.deviceProfiles["stackchan-default"].captureMode,"hands-free");
  assert.equal(reloaded.getDevicePairingToken("rlcd42-default"),"aa".repeat(32));
  assert.equal(reloaded.getDevicePairingToken("stackchan-default"),"bb".repeat(32));
});
