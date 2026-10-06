/** All engine time values are game minutes; host pulses only schedule fixed steps. */
export const TICKS_PER_MINUTE = 10;
export const MINUTES_PER_DAY = 1440;
export const TICKS_PER_DAY = TICKS_PER_MINUTE * MINUTES_PER_DAY;
export const FIXED_DELTA = 1 / TICKS_PER_MINUTE;
export const HOST_FRAME_MS = 100;
export const SIMULATION_SPEEDS = [1, 4, 16] as const;
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number];
export function gameCalendar(tick: number) {
  const minutes = Math.floor(tick / TICKS_PER_MINUTE);
  return {
    day: Math.floor(minutes / MINUTES_PER_DAY) + 1,
    hour: Math.floor(minutes / 60) % 24,
    minute: minutes % 60,
  };
}
