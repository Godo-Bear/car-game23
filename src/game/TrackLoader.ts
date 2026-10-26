import type { TrackId } from '../../shared/api';
import { RacingLine, relaxRacingLine } from '../ai/RacingLine';
import { TrackPath } from '../track/TrackPath';
import { TRACKS } from '../track/tracks';

const CACHE_KEY = 'tokyo-circuit.line.v1.';

/**
 * Circuit geometry and racing lines, cached per track. Racing lines are the slow part of
 * loading, so they are relaxed in a Web Worker (in parallel with building the scenery),
 * prefetched for the other circuits while you sit on the homescreen, and remembered on this
 * device so later visits skip the work entirely.
 */
export class TrackLoader {
  private readonly tracks = new Map<TrackId, TrackPath>();
  private readonly lines = new Map<TrackId, Promise<RacingLine>>();
  private readonly waiting = new Map<TrackId, (offsets: Float32Array) => void>();
  private worker: Worker | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL('../track/racingLine.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: TrackId; offsets: Float32Array }>) => {
        this.waiting.get(e.data.id)?.(e.data.offsets);
        this.waiting.delete(e.data.id);
      };
      this.worker.onerror = () => this.fallBack();
    } catch {
      this.worker = null;
    }
  }

  track(id: TrackId): TrackPath {
    let track = this.tracks.get(id);
    if (!track) {
      track = new TrackPath(TRACKS[id].layout);
      this.tracks.set(id, track);
    }
    return track;
  }

  line(id: TrackId): Promise<RacingLine> {
    let line = this.lines.get(id);
    if (!line) {
      const track = this.track(id);
      const key = `${CACHE_KEY}${id}.${track.count}.${track.length.toFixed(2)}`;
      const cached = readOffsets(key, track.count);
      const worker = this.worker;
      const offsets = cached
        ? Promise.resolve(cached)
        : worker
          ? new Promise<Float32Array>((resolve) => {
              this.waiting.set(id, resolve);
              worker.postMessage(id);
            })
          : Promise.resolve(relaxRacingLine(track));
      line = offsets.then((o) => {
        if (!cached) writeOffsets(key, o);
        return new RacingLine(track, o);
      });
      this.lines.set(id, line);
    }
    return line;
  }

  /** Queue the other circuits so switching to them later is quick. */
  prefetchAll(): void {
    for (const id of Object.keys(TRACKS) as TrackId[]) void this.line(id);
  }

  /** The worker failed to start (e.g. blocked by policy): finish outstanding work here. */
  private fallBack(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, resolve] of this.waiting) resolve(relaxRacingLine(this.track(id)));
    this.waiting.clear();
  }
}

function readOffsets(key: string, count: number): Float32Array | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    const offsets = new Float32Array(bytes.buffer);
    return offsets.length === count && offsets.every(Number.isFinite) ? offsets : null;
  } catch {
    return null;
  }
}

function writeOffsets(key: string, offsets: Float32Array): void {
  try {
    const bytes = new Uint8Array(offsets.buffer, offsets.byteOffset, offsets.byteLength);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    localStorage.setItem(key, btoa(s));
  } catch {
    // Storage full or blocked: it'll just be computed again next time.
  }
}
