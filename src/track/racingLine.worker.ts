/// <reference lib="webworker" />
import { relaxRacingLine } from '../ai/RacingLine';
import { TrackPath } from './TrackPath';
import { WORLDS, type WorldId } from './tracks';

/** Computes racing lines off the main thread so loading a circuit doesn't freeze the page. */
self.onmessage = (e: MessageEvent<WorldId>) => {
  const id = e.data;
  const offsets = relaxRacingLine(new TrackPath(WORLDS[id].layout));
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, offsets }, [offsets.buffer]);
};
