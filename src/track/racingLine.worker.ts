/// <reference lib="webworker" />
import { relaxRacingLine } from '../ai/RacingLine';
import { TrackPath } from './TrackPath';
import { type LineId, layoutOf } from './tracks';

/** Computes racing lines off the main thread so loading a circuit doesn't freeze the page. */
self.onmessage = (e: MessageEvent<LineId>) => {
  const id = e.data;
  const offsets = relaxRacingLine(new TrackPath(layoutOf(id)));
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, offsets }, [offsets.buffer]);
};
