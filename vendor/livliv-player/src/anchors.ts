/** A rendered attachment point. Coordinates are shares of the canvas, from its top left. */
export type AnchorName = 'head' | 'body'
export type AttachmentAnchor = {
  x: number; y: number
  /** Clockwise radians in the rendered canvas. */
  rotation: number
  /** Rendered attachment width as a share of the canvas width. */
  scale: number
}

/** One projected centre and a point half an attachment width to its right. */
export function projectedAnchor(center: [number, number], right: [number, number], heightOverWidth: number): AttachmentAnchor {
  const dx = right[0] - center[0], dy = (right[1] - center[1]) * heightOverWidth
  return { x: center[0], y: center[1], rotation: Math.atan2(dy, dx), scale: Math.hypot(dx, dy) * 2 }
}
