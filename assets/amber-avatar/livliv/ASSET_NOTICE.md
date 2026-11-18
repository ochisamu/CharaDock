# Kohaku LivLiv rig, revision 5

The visible character uses the original CharaDock Kohaku artwork and its registered eye/mouth variants, preserved without regenerating or rescaling facial features. Source artwork is in assets/kohaku-livliv-sources/original. Experimental generated revision-2 plates and prompts are retained separately and are not used by this build. Revision 5 adds four imagegen-authored expression masters; only localized eyebrow/mouth patches are composed, preserving the original eyes and silhouette. Exact prompts and image hashes are in assets/kohaku-livliv-sources/expressions-v5/generation.json. No LivLiv featured-character assets are included.

Character artwork retains the terms in DISTRIBUTION_ASSET_LICENSE.md. The player has its separate Apache-2.0 notice in vendor/livliv-player.

Run `node scripts/build-kohaku-livliv.cjs` to rebuild locally. The model has eight canonical layers, four localized expression layers and five mouth frames; every expression crop has a transparent sampling border. Independent pupil/brow movement and separated hair physics are intentionally disabled to retain the original drawing. Build and playback make no image-generation/API requests.
