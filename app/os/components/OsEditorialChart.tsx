"use client";

import { useMemo, useState } from "react";

export type EditorialHourlyPoint = {
  hour: number;
  label: string;
  todaySales: number;
  todayOrders: number;
  lastWeekSales: number;
  lastWeekOrders: number;
};

function formatYen(value: number) {
  return `¥${new Intl.NumberFormat("ja-JP").format(Math.round(value))}`;
}

function buildSmoothPath(points: Array<[number, number]>) {
  if (!points.length) return "";
  return points.reduce((acc, [x, y], index) => {
    if (index === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    const [px, py] = points[index - 1];
    const cx = ((px + x) / 2).toFixed(1);
    return `${acc} C ${cx} ${py.toFixed(1)}, ${cx} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
  }, "");
}

export function OsEditorialChart({
  series,
  isLoading
}: {
  series: EditorialHourlyPoint[];
  isLoading?: boolean;
}) {
  const defaultActiveIndex = useMemo(() => {
    if (!series.length) return 0;
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (series[i].todaySales > 0 || series[i].todayOrders > 0) return i;
    }
    const nowJstHour = Number(
      new Intl.DateTimeFormat("ja-JP", { hour: "numeric", hour12: false, timeZone: "Asia/Tokyo" }).format(new Date())
    );
    const closest = series.findIndex((point) => point.hour >= nowJstHour);
    return closest >= 0 ? closest : Math.max(0, series.length - 1);
  }, [series]);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeIndex = hoveredIndex !== null && hoveredIndex < series.length ? hoveredIndex : defaultActiveIndex;

  if (isLoading && !series.length) {
    return (
      <div className="os-ed-chart-skeleton" aria-busy="true">
        <span />
      </div>
    );
  }

  if (!series.length) {
    return null;
  }

  const hasAnySales = series.some((point) => point.todaySales > 0 || point.lastWeekSales > 0);
  const activePoint = series[activeIndex] ?? series[0];

  const width = 640;
  const height = 172;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 26;
  const maxValue = Math.max(
    1000,
    ...series.map((point) => Math.max(point.todaySales, point.lastWeekSales))
  ) * 1.14;
  const stepX = series.length > 1 ? (width - padL - padR) / (series.length - 1) : 0;
  const yOf = (value: number) => padT + (height - padT - padB) * (1 - value / maxValue);

  const todayCoords: Array<[number, number]> = series.map((point, index) => [
    padL + index * stepX,
    yOf(point.todaySales)
  ]);
  const lastWeekCoords: Array<[number, number]> = series.map((point, index) => [
    padL + index * stepX,
    yOf(point.lastWeekSales)
  ]);

  const todayLine = buildSmoothPath(todayCoords);
  const lastWeekLine = buildSmoothPath(lastWeekCoords);
  const baselineY = height - padB;
  const todayArea = todayCoords.length
    ? `${todayLine} L ${todayCoords[todayCoords.length - 1][0].toFixed(1)} ${baselineY.toFixed(1)} L ${todayCoords[0][0].toFixed(1)} ${baselineY.toFixed(1)} Z`
    : "";

  const activeCoord = todayCoords[activeIndex] ?? [padL, baselineY];

  return (
    <div className="os-ed-chart">
      <div className="os-ed-chart-legend">
        <div className="os-ed-chart-readout">
          <span className="os-ed-legend-item is-today">
            <i aria-hidden="true" />
            <span>本日</span>
            <strong className="os-ed-tabular" data-i18n-ignore>
              {activePoint.label} · {formatYen(activePoint.todaySales)}
            </strong>
            <small className="os-ed-tabular">({activePoint.todayOrders}件)</small>
          </span>
          <span className="os-ed-legend-item is-prev">
            <i aria-hidden="true" />
            <span>先週同日</span>
            <span className="os-ed-tabular" data-i18n-ignore>
              {formatYen(activePoint.lastWeekSales)}
            </span>
          </span>
        </div>
        {!hasAnySales ? (
          <span className="os-ed-chart-hint">本日の会計が入ると時間帯別に反映されます</span>
        ) : (
          <span className="os-ed-chart-hint">時間帯を選択して詳細を確認</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="os-ed-chart-svg"
        role="img"
        aria-label="時間帯別売上推移"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id="osEditorialSalesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#135c47" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#135c47" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = padT + (height - padT - padB) * fraction;
          return (
            <line
              key={fraction}
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="#eff2f6"
              strokeWidth="1"
            />
          );
        })}

        {lastWeekLine ? (
          <path
            d={lastWeekLine}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        ) : null}

        {todayArea ? <path d={todayArea} fill="url(#osEditorialSalesFill)" /> : null}

        {todayLine ? (
          <path
            d={todayLine}
            fill="none"
            stroke="#135c47"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        ) : null}

        <line
          x1={activeCoord[0]}
          y1={padT}
          x2={activeCoord[0]}
          y2={baselineY}
          stroke="#135c47"
          strokeOpacity="0.28"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <circle cx={activeCoord[0]} cy={activeCoord[1]} r="6.5" fill="#135c47" fillOpacity="0.15" />
        <circle cx={activeCoord[0]} cy={activeCoord[1]} r="3.5" fill="#135c47" stroke="#ffffff" strokeWidth="2" />

        {series.map((point, index) => {
          const [x] = todayCoords[index];
          const isCurrent = index === activeIndex;
          const showLabel = series.length <= 14 || index % 2 === 0 || isCurrent;
          const hitWidth = Math.max(stepX, 24);

          return (
            <g key={point.hour}>
              {showLabel ? (
                <text
                  x={x}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill={isCurrent ? "#0f172a" : "#94a3b8"}
                  fontWeight={isCurrent ? "600" : "400"}
                >
                  {point.label}
                </text>
              ) : null}
              <rect
                x={x - hitWidth / 2}
                y={0}
                width={hitWidth}
                height={height}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredIndex(index)}
                onClick={() => setHoveredIndex(index)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
