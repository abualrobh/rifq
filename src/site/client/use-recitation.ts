// React view of the tab's recitation engine (recitation.ts). The server render and the first
// client render use the idle state, so hydration matches the static HTML.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getEngine, idleSnap, type Engine, type Snap } from './recitation.ts';

const noop = () => () => undefined;

export function useRecitation(dev = false): { snap: Snap; engine: Engine | null } {
  const [engine, setEngine] = useState<Engine | null>(null);
  useEffect(() => { setEngine(getEngine(dev)); }, [dev]);
  const snap = useSyncExternalStore(engine ? engine.subscribe : noop, engine ? engine.get : idleSnap, idleSnap);
  return { snap, engine };
}
