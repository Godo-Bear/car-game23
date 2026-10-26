/// <reference lib="webworker" />
import type { TrackId } from '../../shared/api';
import { relaxRacingLine } from '../ai/RacingLine';
import { TrackPath } from './TrackPath';
import { TRACKS } from './tracks';

/** Computes racing lines off the main thread so loading a circuit doesn't freeze the page. */
self.onmessage = (e: MessageEvent<TrackId>) => {
  const id = e.data;
  const offsets = relaxRacingLine(new TrackPath(TRACKS[id].layout));
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, offsets }, [offsets.buffer]);
};
