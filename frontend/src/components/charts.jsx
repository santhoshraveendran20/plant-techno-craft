/**
 * The app's single Chart.js module. Every chart on every page comes from here, so colours, fonts,
 * tooltips and phone / tablet sizing stay consistent.
 */
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { cn, formatINR, formatNumber } from "@/lib/utils";
import { useIsPhone } from "@/hooks/useMediaQuery";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);

// Validated categorical palette (fixed order) + neutral for comparison series.
// Plant Technocrat brand order: leaf green, blue, logo gold, pink. Passes the dataviz
// validator on adjacent and all pairs (worst CVD dE 9.3); gold and pink sit below 3:1
// on white, so charts using slots 3-4 keep visible legends with values or a table.
export const COLORS = {
  series1: "#578417",
  series2: "#2a78d6",
  series3: "#bf9637",
  series4: "#e87ba4",
  muted: "#a3aaa2",
  grid: "#e3e7e1",
  text: "#5f6b63",
  ink: "#10241a",
};
export const SERIES = [COLORS.series1, COLORS.series2, COLORS.series3, COLORS.series4];
// Ordinal green ramp (light -> dark, validated with --ordinal) for ordered buckets like dues ageing.
export const SEQUENTIAL = ["#8fbf55", "#578417", "#2d4f0e"];

/** Translucent version of a #rrggbb colour, for area fills. */
export const tint = (hex, alpha = 0.1) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

ChartJS.defaults.font.family = "Inter, ui-sans-serif, system-ui, sans-serif";
ChartJS.defaults.font.size = 12;
ChartJS.defaults.color = COLORS.text;
ChartJS.defaults.responsive = true;
ChartJS.defaults.maintainAspectRatio = false;
ChartJS.defaults.plugins.tooltip.backgroundColor = COLORS.ink;
ChartJS.defaults.plugins.tooltip.padding = 10;
ChartJS.defaults.plugins.tooltip.cornerRadius = 6;
ChartJS.defaults.plugins.tooltip.boxPadding = 4;
ChartJS.defaults.plugins.legend.labels.usePointStyle = true;
ChartJS.defaults.plugins.legend.labels.pointStyle = "circle";
ChartJS.defaults.plugins.legend.labels.boxWidth = 8;
ChartJS.defaults.plugins.legend.labels.boxHeight = 8;

export const moneyTick = (v) => formatINR(v, { compact: true });
export const countTick = (v) => formatNumber(v);

/** Phone-aware sizing shared by every chart. */
function useChartLayout(height, phoneHeight) {
  const phone = useIsPhone();
  return {
    phone,
    height: phone ? phoneHeight ?? Math.round(height * 0.82) : height,
    fontSize: phone ? 10 : 12,
    labelMax: phone ? 14 : 22,
  };
}

const truncate = (label, max) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);

function scales({ valueFormatter = moneyTick, horizontal = false, layout, stacked = false }) {
  const value = {
    beginAtZero: true,
    stacked,
    grid: { color: COLORS.grid, drawTicks: false },
    border: { display: false },
    ticks: { callback: valueFormatter, padding: 6, maxRotation: 0, autoSkip: true, maxTicksLimit: layout.phone ? 4 : 6, font: { size: layout.fontSize } },
  };
  const category = {
    stacked,
    grid: { display: false },
    border: { color: COLORS.grid },
    ticks: horizontal
      ? {
          autoSkip: false,
          padding: 6,
          font: { size: layout.fontSize },
          callback(v) {
            return truncate(this.getLabelForValue(v), layout.labelMax);
          },
        }
      : { maxRotation: 0, autoSkip: true, autoSkipPadding: layout.phone ? 8 : 12, padding: 6, font: { size: layout.fontSize } },
  };
  return horizontal ? { x: value, y: category } : { x: category, y: value };
}

const legendFor = (layout) => ({
  position: "top",
  align: layout.phone ? "start" : "end",
  labels: { font: { size: layout.fontSize }, padding: layout.phone ? 10 : 14 },
});

/** Height for a horizontal bar chart so each bar gets the same room however many there are. */
export const barsHeight = (count, per = 28) => Math.max(140, count * per + 48);

/** Sales trend: this period (solid) vs previous period (dashed neutral), shared crosshair tooltip. */
export function TrendChart({ labels, current, previous, previousLabels, height = 280, phoneHeight = 220 }) {
  const layout = useChartLayout(height, phoneHeight);
  const data = {
    labels,
    datasets: [
      {
        label: "This period",
        data: current,
        borderColor: COLORS.series1,
        backgroundColor: tint(COLORS.series1),
        fill: true,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2,
        pointHoverBackgroundColor: "#fff",
      },
      {
        label: "Previous period",
        data: previous,
        borderColor: COLORS.muted,
        borderDash: [5, 4],
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
      },
    ],
  };
  const options = {
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: legendFor(layout),
      tooltip: {
        callbacks: {
          title: (items) => {
            const i = items[0]?.dataIndex ?? 0;
            return previousLabels?.[i] ? `${labels[i]}  vs  ${previousLabels[i]}` : labels[i];
          },
          label: (ctx) => ` ${ctx.dataset.label}: ${formatINR(ctx.parsed.y)}`,
        },
      },
    },
    scales: scales({ layout }),
  };
  return (
    <div style={{ height: layout.height }}>
      <Line data={data} options={options} />
    </div>
  );
}

/** Single-series bar chart (vertical or horizontal). */
export function BarChart({
  labels, data, label = "Value", color = COLORS.series1, colors, horizontal = false, height = 260, phoneHeight,
  valueFormatter = moneyTick, tooltipFormatter = (v) => formatINR(v),
}) {
  const layout = useChartLayout(height, phoneHeight ?? (horizontal ? height : undefined));
  const chartData = {
    labels,
    datasets: [
      {
        label,
        data,
        backgroundColor: colors || color,
        hoverBackgroundColor: colors || color,
        borderRadius: 4,
        borderSkipped: "start",
        maxBarThickness: horizontal ? 18 : 28,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
      },
    ],
  };
  const options = {
    indexAxis: horizontal ? "y" : "x",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => labels[items[0]?.dataIndex ?? 0],
          label: (ctx) => ` ${label}: ${tooltipFormatter(horizontal ? ctx.parsed.x : ctx.parsed.y, ctx.dataIndex)}`,
        },
      },
    },
    scales: scales({ valueFormatter, horizontal, layout }),
  };
  return (
    <div style={{ height: layout.height }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}

/** Two to four series side by side (or stacked) per category; colours follow the fixed palette order. */
export function GroupedBarChart({
  labels, series, horizontal = false, stacked = false, height = 260, phoneHeight,
  valueFormatter = moneyTick, tooltipFormatter = (v) => formatINR(v), onSelect,
}) {
  const layout = useChartLayout(height, phoneHeight ?? (horizontal ? height : undefined));
  const data = {
    labels,
    datasets: series.map((s, i) => ({
      label: s.label,
      data: s.data,
      backgroundColor: s.color || SERIES[i],
      hoverBackgroundColor: s.color || SERIES[i],
      borderRadius: 4,
      borderSkipped: "start",
      // 2px surface gap between stacked segments
      borderColor: "#fff",
      borderWidth: stacked ? { top: horizontal ? 0 : 2, right: horizontal ? 2 : 0 } : 0,
      maxBarThickness: horizontal ? 14 : 22,
      categoryPercentage: 0.75,
      barPercentage: 0.9,
    })),
  };
  const options = {
    indexAxis: horizontal ? "y" : "x",
    interaction: { mode: "index", intersect: false },
    ...(onSelect && {
      onClick: (_evt, elements) => elements.length && onSelect(elements[0].index),
      onHover: (evt, elements) => {
        if (evt.native?.target) evt.native.target.style.cursor = elements.length ? "pointer" : "default";
      },
    }),
    plugins: {
      legend: legendFor(layout),
      tooltip: {
        callbacks: {
          title: (items) => labels[items[0]?.dataIndex ?? 0],
          label: (ctx) => ` ${ctx.dataset.label}: ${tooltipFormatter(horizontal ? ctx.parsed.x : ctx.parsed.y, ctx.dataIndex)}`,
        },
      },
    },
    scales: scales({ valueFormatter, horizontal, layout, stacked }),
  };
  return (
    <div style={{ height: layout.height }}>
      <Bar data={data} options={options} />
    </div>
  );
}

/** One or more lines over a category axis (dates). */
export function LineChart({
  labels, series, height = 240, phoneHeight, fill = false, stepped = false,
  valueFormatter = moneyTick, tooltipFormatter = (v) => formatINR(v),
}) {
  const layout = useChartLayout(height, phoneHeight);
  const data = {
    labels,
    datasets: series.map((s, i) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color || SERIES[i],
      backgroundColor: fill && i === 0 ? tint(s.color || SERIES[i]) : "transparent",
      fill: fill && i === 0,
      borderWidth: 2,
      tension: stepped ? 0 : 0.3,
      stepped: stepped ? "before" : false,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBorderWidth: 2,
      pointHoverBackgroundColor: "#fff",
    })),
  };
  const options = {
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: series.length > 1 ? legendFor(layout) : { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${tooltipFormatter(ctx.parsed.y, ctx.dataIndex)}`,
        },
      },
    },
    scales: scales({ valueFormatter, layout }),
  };
  return (
    <div style={{ height: layout.height }}>
      <Line data={data} options={options} />
    </div>
  );
}

/** Part-to-whole with a value list (labels are never colour-only). `wide` puts the list beside the ring. */
export function DonutWithLegend({
  items, height = 200, centerLabel, centerValue, formatValue = formatINR, emptyText = "No data", wide = false, className,
}) {
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const data = {
    labels: items.map((i) => i.label),
    datasets: [
      {
        data: items.map((i) => i.value),
        backgroundColor: items.map((i) => i.color),
        borderColor: "#fff",
        borderWidth: 2,
        hoverOffset: 4,
      },
    ],
  };
  const options = {
    cutout: "68%",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.label}: ${formatValue(ctx.parsed)} (${total ? Math.round((ctx.parsed / total) * 100) : 0}%)`,
        },
      },
    },
  };
  return (
    <div className={cn("flex flex-col items-center gap-5", wide && "sm:flex-row sm:gap-8", className)}>
      <div className="relative w-full max-w-[200px] shrink-0" style={{ height }}>
        {total > 0 ? (
          <Doughnut data={data} options={options} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-full border-8 border-muted text-xs text-muted-foreground">{emptyText}</div>
        )}
        {total > 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs text-muted-foreground">{centerLabel}</span>
            <span className="tabular text-base font-semibold">{centerValue}</span>
          </div>
        )}
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2.5">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.color }} />
              <span className="truncate">{i.label}</span>
            </span>
            <span className="tabular shrink-0 font-medium">
              {formatValue(i.value)}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {total ? Math.round((i.value / total) * 100) : 0}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Empty placeholder with the same footprint as a chart. */
export function ChartEmpty({ height = 200, children = "No data for this period" }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" style={{ height }}>
      {children}
    </div>
  );
}
