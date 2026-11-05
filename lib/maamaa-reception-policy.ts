import type { StoreCashBusinessDayState } from "./store-business-hours";
import type { StoreReceptionMode } from "./store-reception-mode";
import type { ReservationWindow } from "./store-reservation-windows";

// Conservative launch setting while staffing/opening time is unstable.
export const maamaaSameDayReceptionStartTime = "12:00";

// A calendar-day 24-hour window is not an overnight continuation. Keep the
// existing Maamaa noon reception rule visible to clients using the API windows.
export function applyMaamaaReceptionWindowPolicy(
  windows: ReservationWindow[],
  input: {
    businessDay: Pick<StoreCashBusinessDayState, "businessDate" | "closeExclusive">;
    acceptanceMode?: StoreReceptionMode;
  }
): ReservationWindow[] {
  if (!input.businessDay.closeExclusive || (input.acceptanceMode ?? "auto") !== "auto") return windows;
  return windows.flatMap((window) => {
    if (window.date !== input.businessDay.businessDate) return [window];
    const start = window.start < maamaaSameDayReceptionStartTime ? maamaaSameDayReceptionStartTime : window.start;
    return window.end < start ? [] : [{ ...window, start }];
  });
}
