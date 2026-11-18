/** One Euro filter (Casiez, Roussel, Vogel, CHI 2012): smooths hard while the signal holds still (no jitter) and
 *  less and less as it moves faster (little lag). minCutoff (Hz): smoothing at rest, lower is steadier; beta: how fast
 *  the cutoff rises with speed (per unit of the signal per second) */
export class OneEuro {
  minCutoff: number
  beta: number
  private x: number | null = null
  private dx = 0
  constructor(minCutoff: number, beta: number) { this.minCutoff = minCutoff; this.beta = beta }
  reset() { this.x = null; this.dx = 0 }
  filter(v: number, dt: number): number {
    if (this.x === null || !(dt > 0)) { this.x = v; return v }
    const alpha = (cutoff: number) => { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1) }
    this.dx += ((v - this.x) / dt - this.dx) * alpha(1)
    this.x += (v - this.x) * alpha(this.minCutoff + this.beta * Math.abs(this.dx))
    return this.x
  }
}
