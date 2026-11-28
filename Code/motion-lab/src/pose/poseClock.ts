export type PoseTick = { timeMs: number; running: boolean; transfer: boolean };
export type PoseClock = ReturnType<typeof createPoseClock>;

export function createPoseClock() {
  let current: PoseTick = { timeMs: 0, running: false, transfer: false };
  const listeners = new Set<(tick: PoseTick) => void>();
  return {
    current: () => current,
    publish(next: PoseTick) {
      if (next.timeMs === current.timeMs && next.running === current.running && next.transfer === current.transfer) return;
      current = next;
      listeners.forEach((listener) => listener(next));
    },
    subscribe(listener: (tick: PoseTick) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
