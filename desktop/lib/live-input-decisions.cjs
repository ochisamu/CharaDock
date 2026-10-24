// SPDX-License-Identifier: Apache-2.0
const { nextTranscriptCue } = require('./jev-transcript-cue.cjs');

// Shared by every Live surface. Partial transcripts can animate the listener;
// only a final user utterance can reserve a media operation.
class LiveInputDecisions {
  constructor({ media, expression, cancelExpression = () => {}, expressionEnabled = () => true,
    active = () => true, onReceipt = () => {}, now = Date.now }) {
    Object.assign(this, { media, expression, cancelExpression, expressionEnabled, active, onReceipt, now });
    this.input = null;
    this.closed = false;
  }
  begin() {
    this.cancelExpression();
    return this.input = { text: '', cues: {}, ticket: this.media.begin(), finished: false, answering: false };
  }
  cue(input, text, final = false) {
    if (input.answering || !this.expressionEnabled()) return;
    const cue = nextTranscriptCue(input.cues, text, { final, now: this.now() });
    if (cue) this.expression(cue, { source: 'user' });
  }
  delta(delta) {
    if (this.closed || !this.active() || !delta) return;
    const input = !this.input || this.input.finished ? this.begin() : this.input;
    input.text += String(delta);
    if (input.text.length > 8192) {
      input.text = input.text.slice(-4096);
      input.cues.cueCursor = 0;
    }
    this.cue(input, input.text);
  }
  assistantCue() {
    // The first meaningful assistant phrase owns the next expression. A late
    // final user transcript must not overwrite it with a listener reaction.
    if (this.input) this.input.answering = true;
  }
  finish(text) {
    if (this.closed || !this.active()) return false;
    const value = String(text || '').trim();
    if (!value && (!this.input || this.input.finished)) return false;
    // Native done notifications can be replayed. New transcript deltas start a
    // new utterance, allowing two intentional identical commands to both work.
    if (this.input?.finished && this.input.finalText === value) return false;
    const input = !this.input || this.input.finished ? this.begin() : this.input;
    input.finished = true;
    input.finalText = value;
    if (value) {
      // ASR can revise an earlier fragment. Classify the corrected phrase rather
      // than applying a tail cut at a cursor from the obsolete transcript.
      if (!value.startsWith(input.text.trim())) input.cues.cueCursor = 0;
      this.cue(input, value, true);
    } else input.ticket.cancelled = true;
    input.completion = this.media.finish(value, input.ticket).then(result => {
      if (result && !this.closed && this.active() && this.input === input) return this.onReceipt(result, input.ticket);
    }).catch(() => {});
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.input = null;
    this.media.close();
    if (this.active()) this.cancelExpression();
  }
}
module.exports = { LiveInputDecisions };
