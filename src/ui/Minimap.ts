import type { RaceSimulation } from '../race/RaceSimulation';
import type { TrackPath } from '../track/TrackPath';

/** Track map with live car positions (north-up). The circuit outline is pre-rendered once. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly scale: number;
  private readonly ox: number;
  private readonly oz: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    track: TrackPath,
    private readonly colors: string[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    const size = canvas.width;
    const b = track.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    this.scale = (size * 0.62) / span;
    this.ox = size / 2 - ((b.minX + b.maxX) / 2) * this.scale;
    this.oz = size / 2 - ((b.minZ + b.maxZ) / 2) * this.scale;

    this.base = document.createElement('canvas');
    this.base.width = this.base.height = size;
    const g = this.base.getContext('2d')!;
    const path = new Path2D();
    track.samples.forEach((s, i) => {
      const [x, y] = this.toMap(s.x, s.z);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 16;
    g.stroke(path);
    g.strokeStyle = 'rgba(235,238,250,0.85)';
    g.lineWidth = 8;
    g.stroke(path);
    // Start/finish marker
    const s0 = track.samples[0];
    const [sx, sy] = this.toMap(s0.x, s0.z);
    g.save();
    g.translate(sx, sy);
    g.rotate(Math.atan2(s0.tz, s0.tx));
    g.fillStyle = '#ff2d6f';
    g.fillRect(-2, -12, 4, 24);
    g.restore();
  }

  private toMap(x: number, z: number): [number, number] {
    return [this.ox + x * this.scale, this.oz + z * this.scale];
  }

  draw(sim: RaceSimulation): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    let playerDot: [number, number] | null = null;
    for (const car of sim.cars) {
      const [x, y] = this.toMap(car.physics.x, car.physics.z);
      if (car.isPlayer) {
        playerDot = [x, y];
        continue;
      }
      g.fillStyle = this.colors[car.id] ?? '#fff';
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.fill();
    }
    if (playerDot) {
      g.fillStyle = '#ffcc33';
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(playerDot[0], playerDot[1], 12, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
}
