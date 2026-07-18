export const storeTerminalWorkstations = [
  { value: "レジ", label: "レジ" },
  { value: "厨房", label: "厨房" },
  { value: "受取口", label: "受取口" },
  { value: "客席", label: "客席" },
  { value: "勤怠打刻", label: "勤怠打刻" },
  { value: "バックヤード", label: "バックヤード" },
  { value: "事務所", label: "事務所" },
  { value: "倉庫", label: "倉庫" }
] as const;

export const storeTerminalNumbers = [1, 2, 3, 4, 5] as const;

export const storeTerminalNameOptions = storeTerminalWorkstations.flatMap((workstation) => (
  storeTerminalNumbers.map((number) => ({
    value: `${workstation.value} ${number}`,
    label: `${workstation.label} ${number}`
  }))
));

const storeTerminalNameSet = new Set(storeTerminalNameOptions.map((option) => option.value));

export function isStoreTerminalName(value: string) {
  return storeTerminalNameSet.has(value);
}
