// SPDX-License-Identifier: Apache-2.0
const { PNG } = require("pngjs");

function assembleNeutralKohaku(model, readTexture) {
  const [width, height] = model.canvas;
  const image = new PNG({ width, height });

  for (const layer of model.layers) {
    if (layer.role?.startsWith("lid_") || layer.role === "expr") continue;
    const texture = PNG.sync.read(readTexture(layer.texture));
    for (let y = 0; y < texture.height; y++) {
      for (let x = 0; x < texture.width; x++) {
        const source = (y * texture.width + x) * 4;
        const target = ((y + layer.y) * width + x + layer.x) * 4;
        const sourceAlpha = texture.data[source + 3] / 255;
        const retainedAlpha = image.data[target + 3] / 255 * (1 - sourceAlpha);
        const alpha = sourceAlpha + retainedAlpha;
        if (!alpha) continue;
        for (let channel = 0; channel < 3; channel++) {
          image.data[target + channel] = Math.round(
            (texture.data[source + channel] * sourceAlpha + image.data[target + channel] * retainedAlpha) / alpha,
          );
        }
        image.data[target + 3] = Math.round(alpha * 255);
      }
    }
  }
  return image;
}

module.exports = { assembleNeutralKohaku };
