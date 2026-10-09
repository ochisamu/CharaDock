// SPDX-License-Identifier: Apache-2.0
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CharaDockRemoteSpeechCaption = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const clean = value => String(value || '').trim();
  function create(onChange = () => {}) {
    let fullText = '', visibleText = '', captions = [], reading = false, retained = false;
    const state = () => ({ fullText, visibleText, captions: [...captions], reading });
    const emit = () => onChange(state());
    return {
      state,
      reset() { fullText = visibleText = ''; captions = []; reading = retained = false; emit(); },
      text(value) {
        const next = clean(value); if (!next) return;
        fullText = visibleText = next; captions = []; reading = retained = false; emit();
      },
      snapshot(value) {
        // PC completion/settings/history snapshots are not playback events.
        // Only a new dialogue event may replace the last played caption window.
        if (!reading && !retained) this.text(value);
      },
      begin(value = '') { fullText = clean(value); visibleText = ''; captions = []; reading = true; retained = false; emit(); },
      full(value) { const next = clean(value); if (next) { fullText = next; emit(); } },
      audio(value) {
        const next = clean(value); if (!next) return;
        captions = [...captions, next].slice(-2); visibleText = captions.join('\n'); reading = retained = true; emit();
      },
      finish() { reading = false; retained ||= captions.length > 0; if (!retained && fullText) visibleText = fullText; emit(); },
      cancel() { reading = false; retained ||= captions.length > 0; emit(); },
      live(value) {
        const next = clean(value); if (!next) return;
        fullText = next;
        // Live provides cumulative transcripts, not word-level audio timing.
        // Keep the newest two sentences (bounded even for unpunctuated speech).
        const sentences = next.match(/[^。！？.!?\n]+[。！？.!?\n]*|[。！？.!?\n]+/g) || [next];
        visibleText = Array.from(sentences.slice(-2).join('').trim()).slice(-240).join('');
        captions = [visibleText]; reading = false; retained = true; emit();
      },
    };
  }
  function audioChunks(result = {}, fallback = '') {
    const urls = Array.isArray(result?.audioDataUrls) ? result.audioDataUrls : result?.audioDataUrl ? [result.audioDataUrl] : [];
    return urls.map((url,index) => ({ url,
      text: clean(result?.audioTexts?.[index] || (index === 0 ? result?.audioText : '') || fallback),
    }));
  }
  return { create, audioChunks };
});
