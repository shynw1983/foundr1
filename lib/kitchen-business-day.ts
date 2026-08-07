import {
  getStoreCashBusinessDayState,
  getTokyoDateTimeParts
} from "./store-business-hours.ts";

export type KitchenBusinessDayWindow = {
  businessDate: string;
  startAt: string;
  endAt: string;
};

export function getKitchenBusinessDayWindow(
  businessHours: unknown,
  now = new Date()
): KitchenBusinessDayWindow {
  const businessDay = getStoreCashBusinessDayState(businessHours, now);
  if (businessDay.openAt && businessDay.closeAt) {
    return {
      businessDate: businessDay.businessDate,
      startAt: businessDay.openAt,
      endAt: businessDay.closeAt
    };
  }

  const { date } = getTokyoDateTimeParts(now);
  return {
    businessDate: date,
    startAt: `${date}T00:00`,
    endAt: `${date}T23:59`
  };
}
