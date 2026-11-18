// SPDX-License-Identifier: Apache-2.0

const commands = {
  right: [8, "右を向くね。", "I’ll turn right."],
  left: [9, "左を向くね。", "I’ll turn left."],
  center: [10, "正面に戻るね。", "I’ll face forward."],
  sweep: [11, "首を左右に振るね。", "I’ll look from side to side."],
  nod: [12, "うなずくね。", "I’ll nod."],
  up: [13, "上を向くね。", "I’ll look up."],
  down: [14, "下を向くね。", "I’ll look down."],
  bow: [15, "おじぎするね。", "I’ll bow."],
  tilt: [16, "首をかしげるね。", "I’ll tilt my head."],
  upRight: [17, "右上を向くね。", "I’ll look up and to the right."],
  upLeft: [18, "左上を向くね。", "I’ll look up and to the left."],
  downRight: [19, "右下を向くね。", "I’ll look down and to the right."],
  downLeft: [20, "左下を向くね。", "I’ll look down and to the left."],
};

const directions = [
  ["right", "右(?:の方)?", "turn right"],
  ["left", "左(?:の方)?", "turn left"],
  ["up", "上(?:の方)?", "look up"],
  ["down", "下(?:の方)?", "look down"],
  ["upRight", "右上", "look up(?: and)? right"],
  ["upLeft", "左上", "look up(?: and)? left"],
  ["downRight", "右下", "look down(?: and)? right"],
  ["downLeft", "左下", "look down(?: and)? left"],
].map(([action, ja, en]) => [action, new RegExp(`^(?:${ja}(?:を|に)?(?:向け|向いて|見て)|${en})$`, "iu")]);

const gestures = [
  ...directions,
  ["center", /^(?:(?:正面|前|こっち|こちら)(?:を|に)?(?:向いて|向け|戻って)|首(?:の動き)?を止めて|face forward|look at me)$/iu],
  ["sweep", /^(?:(?:[一1]回|一度|くるっと|クル[ッっ]と)?(?:回って|回転して)|[一1]回転して|首を(?:左右に)?振って|(?:首を)?横に振って|turn around|shake your head)$/iu],
  ["nod", /^(?:(?:うなず|頷)いて|nod)$/iu],
  ["up", /^(?:見上げて|顔を上げて)$/u],
  ["down", /^(?:見下ろして|(?:顔|目線)を下げて)$/u],
  ["bow", /^(?:お?辞儀して|おじぎして|ぺこりとして|bow)$/iu],
  ["tilt", /^(?:首を(?:かしげ|傾げ|傾け)て|tilt your head)$/iu],
];

function stackchanVoiceMotion(text, { directed = false } = {}) {
  let phrase = String(text || "").normalize("NFKC").trim();
  const name = /^(?:スタック(?:チャン|ちゃん)|stack\s*-?\s*chan)(?:[、,、]\s*|\s*)/iu;
  if (!directed && !name.test(phrase)) return null;
  phrase = phrase.replace(name, "").replace(/[。.!！?？]+$/u, "").trim()
    .replace(/(?:(?:ください|下さい)(?:ね)?|くれ(?:る|ますか)|ね)$/u, "").trimEnd();
  const action = gestures.find(([, pattern]) => pattern.test(phrase))?.[0];
  if (!action) return null;
  const [id, ja, en] = commands[action];
  return { id, ja, en };
}

class StackchanLiveMotionInput {
  constructor({ settleMs = 850 } = {}) {
    this.settleMs = settleMs;
    this.turn = null;
    this.timer = null;
  }

  begin() {
    this.cancel();
    this.turn = { text: "", ended: false, final: false, dispatched: false, execute: null };
  }

  cancel() {
    clearTimeout(this.timer);
    this.turn = null;
  }

  end() {
    if (!this.turn) return;
    this.turn.ended = true;
    this.schedule();
  }

  transcript(text, execute, { final = false } = {}) {
    const turn = this.turn;
    if (!turn || turn.dispatched || turn.final) return;
    const value = String(text || "");
    if (final) {
      if (value.trim()) turn.text = value;
    } else if (value) {
      turn.text += value;
    }
    turn.final = final;
    turn.execute = execute;
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    const turn = this.turn;
    if (!turn?.ended || !turn.execute || turn.dispatched) return;
    const dispatch = () => {
      if (this.turn !== turn || turn.dispatched) return;
      const motion = stackchanVoiceMotion(turn.text, { directed: true });
      if (!motion) return;
      turn.dispatched = true;
      turn.execute(motion);
    };
    if (turn.final) dispatch();
    // Some Live sessions only emit transcript deltas. A local capture end
    // and a quiet transcript together make that input eligible for motion.
    else this.timer = setTimeout(dispatch, this.settleMs);
  }
}

module.exports = { StackchanLiveMotionInput, stackchanVoiceMotion };
