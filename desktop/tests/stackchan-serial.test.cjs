// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { StackchanSerialGateway, STACKCHAN_BOARD } = require("../lib/stackchan-serial.cjs");
const { validatedDevice } = require("../lib/rlcd42-serial.cjs");
const { validDeviceId } = require("../lib/rlcd42-wifi.cjs");
const { rgb565Portrait } = require("../lib/stackchan-portrait.cjs");
const { FRAME_TYPES, crc32 } = require("../lib/device-protocol-v2.cjs");

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
  assert.equal(reloaded.data.deviceProfiles["stackchan-default"].captureMode,"push-to-talk");
  assert.equal(reloaded.getDevicePairingToken("rlcd42-default"),"aa".repeat(32));
  assert.equal(reloaded.getDevicePairingToken("stackchan-default"),"bb".repeat(32));
});
