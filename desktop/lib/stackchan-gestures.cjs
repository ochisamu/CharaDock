// SPDX-License-Identifier: Apache-2.0
const STACKCHAN_GESTURES = Object.freeze({ waiting: 1, nod: 2, ponder: 3, delight: 4, reassure: 5, waitingLook: 7 });

const STACKCHAN_EXPRESSIONS = { neutral: 0, thinking: 2, happy: 3, surprised: 4, soft: 5 };
const GESTURE_EXPRESSIONS = { ponder: "thinking", delight: "happy", reassure: "soft" };

function replyGesture(text, final = false) {
  const opening = String(text || "").trim().split(/[。！？!?\n]/u, 1)[0].trim().slice(0, 90);
  if (!final && !/[、。,！？!?\n]/u.test(String(text || ""))) return null;
  if (/^(?:う[ー〜]+ん|ん[ー〜]+|考えてみるね|let me think|hmm)(?:[、,\s]|$)/iu.test(opening))
    return "ponder";
  if (/^(?:はい|うん|なるほど|わかったよ|分かったよ|そうなんだ|okay|yes|i see|got it)(?:[、,\s]|$)/iu.test(opening))
    return "nod";
  if (!final && !/[。！？!?\n]/u.test(String(text || ""))) return null;
  if (/^(?:やった(?:ね|ー+)?|嬉しい|うれしい|よかった(?:ね)?|おめでとう|that(?:'|’)s wonderful|congratulations)(?:[、,\s]|$)/iu.test(opening))
    return "delight";
  if (/^(?:つらかったね|辛かったね|大変だったね|無理しなくていいよ|that sounds hard)(?:[、,\s]|$)/iu.test(opening))
    return "reassure";
  return null;
}

class StackchanConversationGestures {
  constructor({ send, sendExpression = () => {}, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { send, sendExpression, now, schedule, cancel });
    this.generation = 0;
    this.reset();
  }

  reset() {
    this.generation += 1;
    this.cancel(this.waitTimer);
    this.waitTimer = null;
    this.active = false;
    this.pending = null;
    this.pendingExpression = undefined;
    this.expressionSent = false;
    this.playingSince = null;
    this.answered = false;
    this.waited = false;
    this.sent = false;
    this.lastPhraseAt = null;
    this.lastPhraseFace = undefined;
  }

  beginTurn() {
    this.reset();
    this.active = true;
  }

  waitForReply() {
    if (!this.active || this.answered || this.waited || this.waitTimer) return;
    const generation = this.generation;
    this.waitTimer = this.schedule(() => {
      this.waitTimer = null;
      if (generation === this.generation && this.active && !this.answered) {
        this.waited = true;
        this.send(STACKCHAN_GESTURES.waiting);
        this.waitTimer = this.schedule(() => {
          this.waitTimer = null;
          if (generation === this.generation && this.active && !this.answered) this.send(STACKCHAN_GESTURES.waitingLook);
        }, 3_600);
        this.waitTimer?.unref?.();
      }
    }, 950);
    this.waitTimer?.unref?.();
  }

  observeSpeech(text, { final = false } = {}) {
    if (!this.active || !String(text || "").trim()) return;
    this.answered = true;
    this.cancel(this.waitTimer);
    this.waitTimer = null;
    const gesture = replyGesture(text, final);
    this.pendingExpression ??= STACKCHAN_EXPRESSIONS[GESTURE_EXPRESSIONS[gesture]];
    this.offer(gesture);
    this.flush();
  }

  observeExpression(expression, generation) {
    if (generation !== this.generation) return;
    const performance = { nod: "nod", ponder: "ponder", celebrate: "delight", reassure: "reassure" };
    const reaction = expression?.reaction === "sad" ? "soft" : expression?.reaction;
    const face = STACKCHAN_EXPRESSIONS[expression?.emotion] ?? STACKCHAN_EXPRESSIONS[reaction];
    if (face !== undefined) this.pendingExpression = face;
    this.offer(performance[expression?.nikePerformance]);
    this.flush();
  }

  observePhrase(text, expression, { atPause = false } = {}) {
    if (!this.active || this.playingSince === null) return;
    const now = this.now();
    if (this.lastPhraseAt !== null && now - this.lastPhraseAt < 1400) return;
    const performance = { nod: "nod", ponder: "ponder", celebrate: "delight", reassure: "reassure" };
    const gesture = performance[expression?.nikePerformance] || replyGesture(text, true);
    const emotion = expression?.emotion || (expression?.reaction === "sad" ? "soft" : expression?.reaction);
    const face = STACKCHAN_EXPRESSIONS[emotion] ?? STACKCHAN_EXPRESSIONS[GESTURE_EXPRESSIONS[gesture]];
    if (face === undefined || face === 0 || face === this.lastPhraseFace) return;
    this.lastPhraseFace = face;
    this.lastPhraseAt = now;
    this.sendExpression(face, { atPause });
    // A buffered Live transcript does not provide a precise motor cue.
    if (!atPause && gesture && gesture !== "nod") this.send(STACKCHAN_GESTURES[gesture]);
  }

  offer(gesture) {
    if (!this.active || !gesture || this.sent || this.pending) return;
    this.pending = gesture;
    this.flush();
  }

  playbackReady() {
    if (!this.active) return;
    this.answered = true;
    this.cancel(this.waitTimer);
    this.waitTimer = null;
    this.playingSince ??= this.now();
    this.flush();
  }

  flush() {
    if (!this.active || this.playingSince === null || this.now() - this.playingSince > 1200) return;
    if (this.pending && !this.sent) {
      this.send(STACKCHAN_GESTURES[this.pending]);
      this.pending = null;
      this.sent = true;
    }
    if (!this.expressionSent && this.pendingExpression !== undefined) {
      this.sendExpression(this.pendingExpression);
      this.expressionSent = true;
      this.lastPhraseFace = this.pendingExpression;
    }
  }
}

module.exports = { STACKCHAN_GESTURES, StackchanConversationGestures, replyGesture };
