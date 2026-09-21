# Approved doya speech variants

The approved `proud-v3-doya-candidate.png` is the closed-mouth master.
The built-in imagegen edits below produced `proud-v3-half.png` and
`proud-v3-open.png`; no API-key image fallback was used.

## Half prompt

Use case: identity-preserve. Edit target is this approved AI Nike DOYA face. Change ONLY the mouth aperture, preserving the proud cheeky upward smile corners. Mouth slightly open for a small speech syllable, a narrow opening with dark interior, no exaggerated teeth. Preserve exact eyes, brows, face geometry, nose, head pose, hair, every outfit detail and lettering, square canvas and original placement. Do NOT redraw whole face or change crop or scale. Transparent background, one single sprite.

## Open prompt

Use case: identity-preserve. Edit target is this approved AI Nike DOYA face. Change ONLY the mouth aperture, preserving the proud cheeky upward smile corners. Mouth moderately open mid-speech in a smiling shape, dark interior and small natural tongue. Preserve exact eyes, brows, face geometry, nose, head pose, hair, every outfit detail and lettering, square canvas and original placement. Do NOT redraw whole face or change crop or scale. Transparent background, one single sprite.

## Runtime integration

`node scripts/build-nike-doya.cjs` registers the eyes and the small mouth
region onto canonical 1536px sprites, preserves alpha, and validates all
three speech states. `build-nike-extra-emotions.cjs` also invokes this builder.
The rig opts only proud into bounded authored mouth variants; other expressions
retain canonical speech pixels. Source masters remain unmodified.

Actual Live/Beatrice retake and prior recordings are combined by the local
`work/nike-flagship/encode-showcase-clean.cjs`, without editorial labels.
