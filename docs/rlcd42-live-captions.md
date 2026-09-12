# RLCD Live captions

Live assistant transcript events use a local `sendMascotStream` dispatcher,
not normal conversation's `publishChatStream`. The former used to notify only
PC renderers, leaving RLCD caption state and scene synchronization untouched.
`syncRlcd42LiveCaption` now bridges that route for the RLCD voice target only,
without reapplying the turn coordinator or duplicating PC transcript events.

- Keep full text on PC; show the most recent two sentences, capped at 88
  Unicode code points, on RLCD's four-line caption panel.
- Coalesce incremental updates at 180 ms without resetting a pending timer
  on every token; flush the final caption immediately.
- Keep the final caption for 15 seconds. Clear on new accepted speech,
  interruption, session closure, or error. Honor caption-mode OFF.
- Retaining final text does not force the device state to `speaking`.
- Text follows transcript arrival, not exact PCM sample timing. No new
  firmware protocol is required for this fix.

Regression coverage: `desktop/tests/rlcd42-live-caption.test.cjs` exercises
the actual Live dispatcher, target isolation, incremental/final updates,
Unicode truncation, and completed-caption scene selection. Hardware display
verification requires running the updated PC app with a connected RLCD.
