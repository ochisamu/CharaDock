// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { STACKCHAN_GESTURES: G, StackchanConversationGestures, replyGesture } = require("../lib/stackchan-gestures.cjs");
const { StackchanSerialGateway } = require("../lib/stackchan-serial.cjs");
const { FRAME_TYPES } = require("../lib/device-protocol-v2.cjs");

function fixture() {
  const sent = [];
  const timers = new Map();
  let now = 0;
  const director = new StackchanConversationGestures({
    send: id => sent.push(id),
    now: () => now,
    schedule(fn, delay) { timers.set(fn, now + delay); return fn; },
    cancel: fn => timers.delete(fn),
  });
  return { director, sent, tick(ms) {
    now += ms;
    for (const [timer, due] of [...timers]) {
      if (now < due) continue;
      timers.delete(timer);
      timer();
    }
  } };
}

test("a recognized reply adds a context cue, and chunks or noise don't imply agreement", () => {
  assert.equal(replyGesture("はい"), null);
  assert.equal(replyGesture("はい、順番に見ていこう。"), "nod");
  assert.equal(replyGesture("うーん、もう少し考えたい。"), "ponder");
  assert.equal(replyGesture("よかったね！"), "delight");
  assert.equal(replyGesture("つらかったね。"), "reassure");
  assert.equal(replyGesture("「はい」と言えば次に進む。"), null);
  assert.equal(replyGesture("はいってくる場合がある。"), null);
});

test("waiting is one-shot and an early reply suppresses it; spoken cues follow playback start", () => {
  const { director, sent, tick } = fixture();
  director.beginTurn();
  director.waitForReply();
  director.observeSpeech("なるほど、");
  tick(1000);
  assert.deepEqual(sent, []);
  director.playbackReady();
  director.observeSpeech("なるほど、分かったよ。", { final: true });
  assert.deepEqual(sent, [G.nod]);

  director.beginTurn();
  director.waitForReply();
  tick(1000);
  director.waitForReply();
  tick(1000);
  assert.deepEqual(sent, [G.nod, G.waiting]);
});

test("interrupts, late transcripts and decisions from another turn cannot start motion", () => {
  const { director, sent, tick } = fixture();
  director.beginTurn();
  const cancelledGeneration = director.generation;
  director.waitForReply();
  director.reset();
  tick(1000);
  director.beginTurn();
  director.playbackReady();
  director.observeExpression({ nikePerformance: "nod" }, cancelledGeneration);
  tick(1201);
  director.observeSpeech("うーん、", { final: true });
  assert.deepEqual(sent, []);
});

test("a long wait gets one brief look and playback cancels it for the next turn", () => {
  const { director, sent, tick } = fixture();
  director.beginTurn();
  director.waitForReply();
  tick(950);
  tick(3600);
  tick(10000);
  assert.deepEqual(sent, [G.waiting, G.waitingLook]);
  director.beginTurn();
  director.waitForReply();
  tick(950);
  director.playbackReady();
  tick(5000);
  assert.deepEqual(sent, [G.waiting, G.waitingLook, G.waiting]);
});

test("a model expression reaches the native face only during the current reply", () => {
  const sent = [];
  const director = new StackchanConversationGestures({
    send: id => sent.push(["motion", id]),
    sendExpression: id => sent.push(["face", id]),
  });
  director.beginTurn();
  const generation = director.generation;
  director.observeExpression({ emotion: "surprised", nikePerformance: "reassure" }, generation);
  assert.deepEqual(sent, []);
  director.playbackReady();
  assert.deepEqual(sent, [["motion", G.reassure], ["face", 4]]);
  director.reset();
  director.observeExpression({ emotion: "happy" }, generation);
  assert.equal(sent.length, 2);
  director.beginTurn();
  director.observeExpression({ emotion: null, reaction: "happy" }, director.generation);
  director.playbackReady();
  assert.deepEqual(sent.at(-1), ["face", 3]);
});

test("gesture frames are negotiated and accept only known preset ids", async () => {
  const gateway = new StackchanSerialGateway();
  const calls = [];
  gateway.writeWithAck = async (type, payload) => calls.push([type, ...payload]);
  assert.equal(await gateway.sendConversationGesture(G.nod), false);
  gateway.capabilities = { capabilities: { motion: { conversationGestures: true } } };
  assert.equal(await gateway.sendConversationGesture(200), false);
  assert.equal(await gateway.sendConversationGesture(G.nod), true);
  assert.deepEqual(calls, [[FRAME_TYPES.GESTURE, G.nod]]);
});

test("later clauses can change the face without moving the servos during Live", () => {
  const sent = [];
  let now = 0;
  const director = new StackchanConversationGestures({
    now: () => now,
    send: id => sent.push(["motion", id]),
    sendExpression: (id, { atPause }) => sent.push(["face", id, atPause]),
  });
  director.beginTurn();
  director.playbackReady();
  director.observePhrase("つらかったね。", { emotion: "soft" });
  director.observePhrase("よかったね！", { emotion: "happy" }, { atPause: true });
  now += 2000;
  director.observePhrase("よかったね！", { emotion: "happy" }, { atPause: true });
  director.reset();
  director.observePhrase("つらかったね。", { emotion: "soft" });
  assert.deepEqual(sent, [["face", 5, false], ["motion", G.reassure], ["face", 3, true]]);
});
