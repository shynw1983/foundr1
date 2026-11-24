"use client";

import { useMemo, useState } from "react";

export type EditorialSeriesPoint = {
  key: string;
  label: string;
  currentSales: number;
  currentOrders: number;
  previousSales: number;
  previousOrders: number;
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
  granularity = "hourly",
  currentLabel = "当期",
  previousLabel = "前期比較",
  isLoading
}: {
  series: EditorialSeriesPoint[];
  granularity?: "hourly" | "daily";
  currentLabel?: string;
  previousLabel?: string;
  isLoading?: boolean;
}) {
  const defaultActiveIndex = useMemo(() => {
    if (!series.length) return 0;
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (series[i].currentSales > 0 || series[i].currentOrders > 0) return i;
    }
    return Math.max(0, series.length - 1);
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

  const hasAnySales = series.some((point) => point.currentSales > 0 || point.previousSales > 0);
  const activePoint = series[activeIndex] ?? series[0];

  const width = 640;
  const height = 166;
  const padL = 10;
  const padR = 10;
  const padT = 16;
  const padB = 26;
  const maxValue = Math.max(
    1000,
    ...series.map((point) => Math.max(point.currentSales, point.previousSales))
  ) * 1.14;
  const stepX = series.length > 1 ? (width - padL - padR) / (series.length - 1) : 0;
  const yOf = (value: number) => padT + (height - padT - padB) * (1 - value / maxValue);

  const currentCoords: Array<[number, number]> = series.map((point, index) => [
    series.length === 1 ? width / 2 : padL + index * stepX,
    yOf(point.currentSales)
  ]);
  const prevCoords: Array<[number, number]> = series.map((point, index) => [
    series.length === 1 ? width / 2 : padL + index * stepX,
    yOf(point.previousSales)
  ]);

  const currentLine = buildSmoothPath(currentCoords);
  const prevLine = buildSmoothPath(prevCoords);
  const baselineY = height - padB;
  const currentArea = currentCoords.length > 1
    ? `${currentLine} L ${currentCoords[currentCoords.length - 1][0].toFixed(1)} ${baselineY.toFixed(1)} L ${currentCoords[0][0].toFixed(1)} ${baselineY.toFixed(1)} Z`
    : "";

  const activeCoord = currentCoords[activeIndex] ?? [padL, baselineY];
  const labelStride = series.length <= 10 ? 1 : series.length <= 18 ? 2 : 5;

  return (
    <div className="os-ed-chart">
      <div className="os-ed-chart-legend">
        <div className="os-ed-chart-readout">
          <span className="os-ed-legend-item is-today">
            <i aria-hidden="true" />
            <span>{currentLabel}</span>
            <strong className="os-ed-tabular" data-i18n-ignore>
              {activePoint.label} · {formatYen(activePoint.currentSales)}
            </strong>
            <small className="os-ed-tabular">({activePoint.currentOrders}件)</small>
          </span>
          <span className="os-ed-legend-item is-prev">
            <i aria-hidden="true" />
            <span>{previousLabel}</span>
            <span className="os-ed-tabular" data-i18n-ignore>
              {formatYen(activePoint.previousSales)}
            </span>
          </span>
        </div>
        {!hasAnySales ? (
          <span className="os-ed-chart-hint">会計データが入ると推移グラフに反映されます</span>
        ) : (
          <span className="os-ed-chart-hint">
            {granularity === "hourly" ? "時間帯をタップして詳細を確認" : "日付をタップして詳細を確認"}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="os-ed-chart-svg"
        role="img"
        aria-label={granularity === "hourly" ? "時間帯別売上推移" : "日別売上推移"}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id="osFoundr1SalesFill" x1="0" y1="0" x2="0" y2="1">
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
              stroke="#edf1ef"
              strokeWidth="1"
            />
          );
        })}

        {prevCoords.length > 1 ? (
          <path
            d={prevLine}
            fill="none"
            stroke="#c9d4ce"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        ) : null}

        {currentArea ? <path d={currentArea} fill="url(#osFoundr1SalesFill)" /> : null}

        {currentCoords.length > 1 ? (
          <path
            d={currentLine}
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
          const [x] = currentCoords[index];
          const isCurrent = index === activeIndex;
          const showLabel = index === 0 || index === series.length - 1 || index % labelStride === 0 || isCurrent;
          const hitWidth = Math.max(stepX, 22);

          return (
            <g key={point.key}>
              {showLabel ? (
                <text
                  x={x}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill={isCurrent ? "#0f172a" : "#8a9992"}
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
