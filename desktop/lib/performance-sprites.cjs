// SPDX-License-Identifier: Apache-2.0
const POSES = Object.freeze(["ponder", "explain", "celebrate"]);
const cap = value => value[0].toUpperCase() + value.slice(1);
const PERFORMANCE_IMAGE_FILES = Object.freeze(Object.fromEntries(POSES.flatMap(pose =>
  ["open", "closed"].flatMap(eye => ["closed", "half", "open"].map(mouth => [
    `performance${cap(pose)}Eyes${cap(eye)}Mouth${cap(mouth)}`,
    `performance-${pose}-eyes-${eye}-mouth-${mouth}.png`,
  ])))));
module.exports = { POSES, PERFORMANCE_IMAGE_FILES };
