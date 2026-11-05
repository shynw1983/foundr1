type AvailabilityDefault = { workDate: string; availableStart: string; availableEnd: string };
type AvailabilityRequest = {
  requestType: string;
  workDate: string | null;
  note: string | null;
  windows?: Array<{ workDate: string; availableStart: string | null; availableEnd: string | null; note: string | null }>;
};

export function createAvailabilityDrafts(dates: string[], requests: AvailabilityRequest[], defaults: AvailabilityDefault[] = []) {
  return dates.map((workDate) => {
    const existing = requests.find((request) => (
      request.requestType === "availability"
      && (request.workDate === workDate || request.windows?.some((window) => window.workDate === workDate))
    ));
    const window = existing?.windows?.find((entry) => entry.workDate === workDate);
    const defaultTimes = defaults.find((entry) => entry.workDate === workDate);
    return {
      workDate,
      wantsWork: Boolean(existing),
      availableStart: window?.availableStart ?? defaultTimes?.availableStart ?? "",
      availableEnd: window?.availableEnd ?? defaultTimes?.availableEnd ?? "",
      note: window?.note ?? existing?.note ?? ""
    };
  });
}
