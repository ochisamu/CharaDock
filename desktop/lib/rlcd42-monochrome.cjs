// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const RLCD_WIDTH = 400;
const RLCD_HEIGHT = 300;
const RLCD_PORTRAIT_SOURCE = "rlcd42-portrait.png";
const RLCD_PORTRAIT_FRAME_SOURCES = Object.freeze({
  neutral: RLCD_PORTRAIT_SOURCE,
  blink: "rlcd42-portrait-blink.png",
  mouthHalf: "rlcd42-portrait-mouth-half.png",
  mouthOpen: "rlcd42-portrait-mouth-open.png",
});
const GENERIC_PORTRAIT_FRAME_SOURCES = Object.freeze({
  neutral: "eyes-open-mouth-closed.png",
  blink: "eyes-closed-mouth-closed.png",
  mouthHalf: "eyes-open-mouth-half.png",
  mouthOpen: "eyes-open-mouth-open.png",
});
// Reflective ST7305 panels make anti-aliased source contours look lighter than
// the same 1-bit preview on a desktop display.  Keep a little more of the gray
// edge coverage so generated manga ink survives the 400x300 reduction without
// dilating every stroke into a heavy blob.
const RLCD_LINE_ART_THRESHOLD = 224;
const BAYER_4 = Object.freeze([
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]);
const MANGA_PIPELINE = "manga-v3-clean-lineart";

function decodeLayer(source) {
  if (source && Number.isInteger(source.width) && Number.isInteger(source.height) && source.data) return source;
  const bytes = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  return PNG.sync.read(bytes);
}

function compositePngLayers(sources) {
  const layers = (Array.isArray(sources) ? sources : []).filter(Boolean).map(decodeLayer);
  if (!layers.length) throw new Error("RLCD表示用のキャラクター画像がありません。");
  const { width, height } = layers[0];
  if (!width || !height || layers.some((layer) => layer.width !== width || layer.height !== height)) {
    throw new Error("RLCD表示用レイヤーの大きさが一致しません。");
  }
  const output = new PNG({ width, height });
  for (const layer of layers) {
    for (let index = 0; index < output.data.length; index += 4) {
      const topAlpha = layer.data[index + 3] / 255;
      if (topAlpha <= 0) continue;
      const bottomAlpha = output.data[index + 3] / 255;
      const resultAlpha = topAlpha + bottomAlpha * (1 - topAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[index + channel] = Math.round(
          ((layer.data[index + channel] * topAlpha) + (output.data[index + channel] * bottomAlpha * (1 - topAlpha))) / resultAlpha,
        );
      }
      output.data[index + 3] = Math.round(resultAlpha * 255);
    }
  }
  return output;
}

function normalizedFaceCenter(faceCenter, width, height) {
  const x = Number(faceCenter?.x);
  const y = Number(faceCenter?.y);
  return {
    x: Number.isFinite(x) ? Math.max(0, Math.min(width, x)) : width * 0.5,
    y: Number.isFinite(y) ? Math.max(0, Math.min(height, y)) : height * 0.43,
  };
}

function portraitCrop(source, faceCenter, outputWidth = RLCD_WIDTH, outputHeight = RLCD_HEIGHT) {
  const targetAspect = outputWidth / outputHeight;
  let width = source.width;
  let height = width / targetAspect;
  if (height > source.height) {
    height = source.height;
    width = height * targetAspect;
  }
  const face = normalizedFaceCenter(faceCenter, source.width, source.height);
  const x = Math.max(0, Math.min(source.width - width, face.x - width * 0.5));
  // A face slightly above center leaves room for shoulders and captions.
  const y = Math.max(0, Math.min(source.height - height, face.y - height * 0.42));
  return { x, y, width, height };
}

function sourceLuminance(source, x, y) {
  const clampedX = Math.max(0, Math.min(source.width - 1, x));
  const clampedY = Math.max(0, Math.min(source.height - 1, y));
  const index = (clampedY * source.width + clampedX) * 4;
  const alpha = source.data[index + 3] / 255;
  const red = source.data[index] * alpha + 255 * (1 - alpha);
  const green = source.data[index + 1] * alpha + 255 * (1 - alpha);
  const blue = source.data[index + 2] * alpha + 255 * (1 - alpha);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function resizeToLuminance(source, crop, width, height) {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = crop.y + ((y + 0.5) * crop.height / height) - 0.5;
    const y0 = Math.floor(sourceY);
    const y1 = y0 + 1;
    const fy = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = crop.x + ((x + 0.5) * crop.width / width) - 0.5;
      const x0 = Math.floor(sourceX);
      const x1 = x0 + 1;
      const fx = sourceX - x0;
      const top = sourceLuminance(source, x0, y0) * (1 - fx) + sourceLuminance(source, x1, y0) * fx;
      const bottom = sourceLuminance(source, x0, y1) * (1 - fx) + sourceLuminance(source, x1, y1) * fx;
      output[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return output;
}

function percentileBounds(values, cutoffFraction = 0.01) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  const cutoff = Math.floor(values.length * cutoffFraction);
  let cumulative = 0;
  let low = 0;
  for (; low < 255; low += 1) {
    cumulative += histogram[low];
    if (cumulative > cutoff) break;
  }
  cumulative = 0;
  let high = 255;
  for (; high > 0; high -= 1) {
    cumulative += histogram[high];
    if (cumulative > cutoff) break;
  }
  return high > low + 8 ? { low, high } : { low: 0, high: 255 };
}

function prepareLuminance(values, width, height, style, faceFocus) {
  const { low, high } = percentileBounds(values);
  const normalized = Uint8Array.from(values, (value) => Math.max(0, Math.min(255, Math.round((value - low) * 255 / (high - low)))));
  if (style !== "manga") return normalized;

  // Recover thin strokes softened by the mandatory downscale without smoothing
  // the source first. This is deliberately local and content-independent so it
  // works for imported .purupuru characters as well as bundled characters.
  const detail = new Uint8Array(normalized.length);
  const normalizedAt = (x, y) => normalized[
    Math.max(0, Math.min(height - 1, y)) * width
      + Math.max(0, Math.min(width - 1, x))
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = normalizedAt(x, y);
      const localMean = (
        normalizedAt(x - 1, y) + normalizedAt(x + 1, y)
        + normalizedAt(x, y - 1) + normalizedAt(x, y + 1)
      ) / 4;
      detail[y * width + x] = Math.max(0, Math.min(255, Math.round(center + ((center - localMean) * 0.32))));
    }
  }

  const ink = new Uint8Array(normalized.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (dx, dy) => detail[
        Math.max(0, Math.min(height - 1, y + dy)) * width
          + Math.max(0, Math.min(width - 1, x + dx))
      ];
      const gx = -at(-1, -1) + at(1, -1)
        - (2 * at(-1, 0)) + (2 * at(1, 0))
        - at(-1, 1) + at(1, 1);
      const gy = -at(-1, -1) - (2 * at(0, -1)) - at(1, -1)
        + at(-1, 1) + (2 * at(0, 1)) + at(1, 1);
      const edge = Math.abs(gx) + Math.abs(gy);
      const tone = detail[y * width + x];
      const localMean = (
        at(-1, -1) + at(0, -1) + at(1, -1)
        + at(-1, 0) + at(1, 0)
        + at(-1, 1) + at(0, 1) + at(1, 1)
      ) / 8;
      const faceDx = faceFocus ? (x - faceFocus.x) / faceFocus.radiusX : 2;
      const faceDy = faceFocus ? (y - faceFocus.y) / faceFocus.radiusY : 2;
      const insideFace = (faceDx * faceDx) + (faceDy * faceDy) <= 1;
      // Sobel responds on both sides of a boundary. Drawing both sides made
      // eyelashes and hair strands two pixels thick. Keep only its darker side.
      const darkSide = tone + 3 < localMean;
      const outlined = edge >= (insideFace ? 120 : 105) && tone < 246 && darkSide;
      // A one-pixel dark stroke has equal bright neighbors on both sides, so
      // Sobel can cancel at its center. Preserve only true local minima; broad
      // dark fills still go through the clustered screen below.
      const fineInk = tone < 112 && tone + 18 < localMean;
      // The reflective panel exposes every halftone dot instead of visually
      // blending it. Manga therefore means clean line art here: flat colors and
      // gradients become white, while boundaries and small dark details remain.
      const black = outlined || fineInk;
      ink[y * width + x] = black ? 0 : 255;
    }
  }
  return ink;
}

function packRaw1Msb(luminance, width, height, style, mangaThreshold = 128) {
  const output = Buffer.alloc(Math.ceil(width / 8) * height);
  const thresholdSpan = 112;
  const thresholdBase = 128 - Math.floor(thresholdSpan / 2);
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const threshold = style === "manga"
        ? mangaThreshold
        : thresholdBase + Math.floor(BAYER_4[y & 3][x & 3] * thresholdSpan / 15);
      if (luminance[y * width + x] < threshold) output[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return output;
}

function portraitMetrics(pixels, width, height, faceFocus) {
  const rowBytes = Math.ceil(width / 8);
  let blackPixels = 0;
  let facePixels = 0;
  let blackFacePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const black = Boolean(pixels[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)));
      if (black) blackPixels += 1;
      if (!faceFocus) continue;
      const dx = (x - faceFocus.x) / faceFocus.radiusX;
      const dy = (y - faceFocus.y) / faceFocus.radiusY;
      if ((dx * dx) + (dy * dy) > 1) continue;
      facePixels += 1;
      if (black) blackFacePixels += 1;
    }
  }
  return {
    blackRatio: Number((blackPixels / (width * height)).toFixed(4)),
    faceBlackRatio: facePixels ? Number((blackFacePixels / facePixels).toFixed(4)) : null,
  };
}

function renderMonochromePortrait({
  layers,
  faceCenter,
  style = "manga",
  width = RLCD_WIDTH,
  height = RLCD_HEIGHT,
  lineArtSource = false,
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > RLCD_WIDTH || height > RLCD_HEIGHT) {
    throw new RangeError("RLCD portrait dimensions are outside 400x300.");
  }
  if (!["illustration", "manga"].includes(style)) throw new RangeError(`Unsupported RLCD art style: ${style}`);
  const composite = compositePngLayers(layers);
  const crop = portraitCrop(composite, faceCenter, width, height);
  const resized = resizeToLuminance(composite, crop, width, height);
  const normalizedFace = normalizedFaceCenter(faceCenter, composite.width, composite.height);
  const faceFocus = {
    x: (normalizedFace.x - crop.x) * width / crop.width,
    y: (normalizedFace.y - crop.y) * height / crop.height,
    radiusX: width * 0.17,
    radiusY: height * 0.21,
  };
  // A dedicated monochrome drawing already contains the artist's intended line
  // weight. Running edge extraction over it would turn every broad stroke back
  // into a faint one-pixel outline, so preserve the resized ink directly.
  const prepared = lineArtSource && style === "manga"
    ? resized
    : prepareLuminance(resized, width, height, style, faceFocus);
  const pixels = packRaw1Msb(
    prepared,
    width,
    height,
    style,
    lineArtSource ? RLCD_LINE_ART_THRESHOLD : 128,
  );
  const algorithm = lineArtSource && style === "manga"
    ? "selective-fill-v2-direct-ink"
    : style === "manga" ? MANGA_PIPELINE : "illustration-v1-bayer";
  const digest = crypto.createHash("sha256")
    .update(Buffer.from(`${width}x${height}:${style}:${algorithm}:raw1-msb\0`, "ascii"))
    .update(pixels)
    .digest("hex");
  return {
    width,
    height,
    format: "raw1-msb",
    style,
    algorithm,
    crop,
    metrics: portraitMetrics(pixels, width, height, faceFocus),
    pixels,
    revision: `sha256:${digest.slice(0, 32)}`,
  };
}

function characterPortraitLayerPaths(directory) {
  // A character may provide a display-specific clean line drawing. This is an
  // optional source, not a requirement: imported characters without one keep
  // using the generic layered-color conversion below.
  const dedicatedPortrait = path.join(directory, RLCD_PORTRAIT_SOURCE);
  if (fs.existsSync(dedicatedPortrait)) return [dedicatedPortrait];
  const candidates = ["back-hair.png", "eyes-open-mouth-closed.png", "front-hair.png"];
  const layers = candidates.map((filename) => path.join(directory, filename)).filter((filePath) => fs.existsSync(filePath));
  if (!layers.length) {
    const fallback = ["thumbnail.png", "reference.png"].map((filename) => path.join(directory, filename)).find((filePath) => fs.existsSync(filePath));
    if (fallback) layers.push(fallback);
  }
  return layers;
}

function renderCharacterPortrait({ directory, settings = {}, style = "manga" } = {}) {
  const dedicatedPortrait = path.join(directory, RLCD_PORTRAIT_SOURCE);
  return renderMonochromePortrait({
    layers: characterPortraitLayerPaths(directory),
    faceCenter: settings?.faceCenterSetup?.center,
    style,
    lineArtSource: fs.existsSync(dedicatedPortrait),
  });
}

function characterPortraitFrameLayerPaths(directory, frame = "neutral") {
  const dedicatedName = RLCD_PORTRAIT_FRAME_SOURCES[frame];
  const dedicated = dedicatedName && path.join(directory, dedicatedName);
  if (dedicated && fs.existsSync(dedicated)) return { layers: [dedicated], dedicated: true };

  const faceName = GENERIC_PORTRAIT_FRAME_SOURCES[frame] || GENERIC_PORTRAIT_FRAME_SOURCES.neutral;
  const face = path.join(directory, faceName);
  if (!fs.existsSync(face)) return null;
  const layers = ["back-hair.png", faceName, "front-hair.png"]
    .map((filename) => path.join(directory, filename))
    .filter((filePath) => fs.existsSync(filePath));
  return { layers, dedicated: false };
}

function renderCharacterPortraitFrames({ directory, settings = {}, style = "manga" } = {}) {
  const neutral = renderCharacterPortrait({ directory, settings, style });
  const frames = { neutral };
  const hasDedicatedNeutral = fs.existsSync(path.join(directory, RLCD_PORTRAIT_SOURCE));
  for (const frame of ["blink", "mouthHalf", "mouthOpen"]) {
    // Never mix a display-specific drawing with a frame reconstructed from the
    // regular colour layers.  The two compositions can differ substantially,
    // which makes every blink look like the whole character was replaced.
    // Until a matching dedicated frame is supplied, upload the neutral drawing
    // for that slot so stale frames already cached by the device are replaced.
    const dedicatedName = RLCD_PORTRAIT_FRAME_SOURCES[frame];
    if (hasDedicatedNeutral && !fs.existsSync(path.join(directory, dedicatedName))) {
      frames[frame] = neutral;
      continue;
    }
    const source = characterPortraitFrameLayerPaths(directory, frame);
    if (!source) continue;
    frames[frame] = renderMonochromePortrait({
      layers: source.layers,
      faceCenter: settings?.faceCenterSetup?.center,
      style,
      lineArtSource: source.dedicated,
    });
  }
  return frames;
}

module.exports = {
  BAYER_4,
  MANGA_PIPELINE,
  RLCD_HEIGHT,
  RLCD_LINE_ART_THRESHOLD,
  RLCD_PORTRAIT_FRAME_SOURCES,
  RLCD_PORTRAIT_SOURCE,
  RLCD_WIDTH,
  characterPortraitLayerPaths,
  compositePngLayers,
  portraitCrop,
  renderCharacterPortrait,
  renderCharacterPortraitFrames,
  renderMonochromePortrait,
};
