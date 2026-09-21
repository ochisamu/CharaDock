// Early semantic phrases for Live, not one API request per delta.
// The revision gate below limits rate and count; short replies use done.
function readyForTranscriptCue(text) {
  const value = String(text || "").trim();
  // A delta may contain the full stop AND the next word. Checking only the
  // last character accidentally delayed those replies until the final event.
  // Commas alone often contain only an introduction, not the actual intent.
  // An expressive opening already supplies intent, even before a full sentence.
  // This only starts semantic classification; it never chooses the expression.
  const opening = /^(?:マスター[、,！!\s]*)?(?:え[っえぇー]*[、,！!？?]|わ[あぁー]+[、,！!]|やった[ー！!]|大丈夫[、,。]|うーん[、,。]|ふふん[、,。！!]|やれやれ[、,。！!]|まさか[、,。！!？?]|本当に[！!？?])/u.test(value);
  return opening || value.length >= 28 || (value.length >= 12 && /[。！？!?]/.test(value));
}
// Incremental, bounded revisions. Classify the new phrase, not the entire
// accumulated answer (which otherwise keeps its opening emotion forever).
function nextTranscriptCue(state, text, { final = false, now = Date.now() } = {}) {
  const value = String(text || '').trim();
  if (!state.cueCursor) state.cueCursor = 0;
  if ((state.cueCount || 0) >= 5 || value.length <= state.cueCursor) return null;
  const tail = value.slice(state.cueCursor).trim();
  if (!tail || (state.cueCount && tail.length < 8) || (!final && (!readyForTranscriptCue(tail) || (state.cueCount && now - state.cueAt < 650)))) return null;
  state.cueCursor = value.length; state.cueAt = now; state.cueCount = (state.cueCount || 0) + 1;
  return tail;
}
module.exports = { readyForTranscriptCue, nextTranscriptCue };
