export type MinuteInterval = {
  start: number;
  end: number;
};

function timeToMinutes(value: string | null | undefined) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function getBusinessInterval(open: string, close: string): MinuteInterval {
  const start = timeToMinutes(open) ?? 0;
  const closeBase = timeToMinutes(close) ?? start;
  return {
    start,
    end: closeBase <= start ? closeBase + 1440 : closeBase
  };
}

function distanceToInterval(value: number, interval: MinuteInterval) {
  if (value < interval.start) return interval.start - value;
  if (value > interval.end) return value - interval.end;
  return 0;
}

function alignToBusinessDay(value: number, business: MinuteInterval) {
  const candidates = [value - 1440, value, value + 1440, value + 2880];
  return candidates.reduce((best, candidate) => (
    distanceToInterval(candidate, business) < distanceToInterval(best, business) ? candidate : best
  ));
}

export function getShiftInterval(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  business: MinuteInterval
): MinuteInterval | null {
  const startBase = timeToMinutes(startValue);
  const endBase = timeToMinutes(endValue);
  if (startBase === null || endBase === null) return null;

  const start = alignToBusinessDay(startBase, business);
  let end = alignToBusinessDay(endBase, business);
  while (end <= start) end += 1440;
  return { start, end };
}

export function getTimelineInterval(business: MinuteInterval, shifts: Array<MinuteInterval | null>): MinuteInterval {
  return shifts.reduce<MinuteInterval>((timeline, shift) => {
    if (!shift) return timeline;
    return {
      start: Math.min(timeline.start, shift.start),
      end: Math.max(timeline.end, shift.end)
    };
  }, business);
}

export function getTimelineBarStyle(interval: MinuteInterval | null, timeline: MinuteInterval) {
  if (!interval) return { display: "none" as const };
  const total = Math.max(1, timeline.end - timeline.start);
  const left = Math.max(0, Math.min(100, ((interval.start - timeline.start) / total) * 100));
  const availableWidth = Math.max(0, 100 - left);
  const proportionalWidth = ((interval.end - interval.start) / total) * 100;
  const width = Math.min(availableWidth, Math.max(1, proportionalWidth));
  return { left: `${left}%`, width: `${width}%` };
}

export function formatTimelineMinute(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
