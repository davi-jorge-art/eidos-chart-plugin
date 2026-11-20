import { useState } from "react"
import type { CalendarModel } from "../calendar"

type Layout = "Month" | "Week"

const pad = (n: number) => String(n).padStart(2, "0")
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

function locale(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en"
}

/** First day of the week as a JS day index (0 = Sunday). */
function firstWeekday(): number {
  try {
    const loc = new Intl.Locale(locale()) as Intl.Locale & {
      weekInfo?: { firstDay: number }
      getWeekInfo?: () => { firstDay: number }
    }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {
    /* fall through */
  }
  return 0
}

export function CalendarView({
  model,
  legendLabel,
  onOpenRecord,
}: {
  model: CalendarModel
  legendLabel: string
  onOpenRecord?: (rowId: string) => void
}) {
  const [layout, setLayout] = useState<Layout>("Month")
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))

  const start = firstWeekday()
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), o)

  // Visible days
  let visible: Array<Date | null>
  let title: string
  if (layout === "Month") {
    const y = anchor.getFullYear()
    const m = anchor.getMonth()
    const lead = (new Date(y, m, 1).getDay() - start + 7) % 7
    const count = new Date(y, m + 1, 0).getDate()
    visible = [
      ...Array<null>(lead).fill(null),
      ...Array.from({ length: count }, (_, i) => new Date(y, m, i + 1)),
    ]
    while (visible.length % 7 !== 0) visible.push(null)
    title = fmt({ month: "long", year: "numeric" }).format(new Date(y, m, 1))
  } else {
    const weekStart = addDays(anchor, -((anchor.getDay() - start + 7) % 7))
    visible = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const f = fmt({ day: "numeric", month: "short", year: "numeric" })
    title =
      typeof f.formatRange === "function"
        ? f.formatRange(visible[0]!, visible[6]!)
        : `${f.format(visible[0]!)} – ${f.format(visible[6]!)}`
  }

  const move = (dir: -1 | 1) =>
    setAnchor((a) =>
      layout === "Month"
        ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
        : addDays(a, dir * 7)
    )

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    fmt({ weekday: "short" }).format(new Date(2026, 0, 4 + ((start + i) % 7))) // 2026-01-04 is a Sunday
  )
  const todayKey = keyOf(new Date())
  const { min, max } = model.range ?? { min: 0, max: 1 }

  return (
    <div className={`cal-root${layout === "Week" ? " cal-week" : ""}`}>
      <div className="cal-toolbar">
        <div className="cal-title" aria-live="polite">
          {title}
        </div>
        <div className="cal-segment" role="group" aria-label="Calendar layout">
          {(["Month", "Week"] as const).map((l) => (
            <button
              key={l}
              className={`chart-btn${layout === l ? " cal-active" : ""}`}
              aria-pressed={layout === l}
              onClick={() => setLayout(l)}
            >
              {l}
            </button>
          ))}
        </div>
        <button className="chart-btn" onClick={() => setAnchor(startOfDay(new Date()))}>
          Today
        </button>
        <button
          className="chart-btn"
          onClick={() => move(-1)}
          aria-label={layout === "Month" ? "Previous month" : "Previous week"}
        >
          ‹
        </button>
        <button
          className="chart-btn"
          onClick={() => move(1)}
          aria-label={layout === "Month" ? "Next month" : "Next week"}
        >
          ›
        </button>
      </div>

      <div className="cal-grid" role="grid" aria-label={title}>
        {weekdays.map((w, i) => (
          <div className="cal-dow" key={`dow-${i}`} role="columnheader">
            {w}
          </div>
        ))}
        {visible.map((date, i) => {
          if (!date) return <div className="cal-cell cal-cell-blank" key={`b-${i}`} />
          const key = keyOf(date)
          const info = model.days.get(key)
          const clickable = !!(info?.rowId && onOpenRecord)
          return (
            <div
              key={key}
              role="gridcell"
              className={`cal-cell${info ? " cal-cell-filled" : ""}${clickable ? " cal-cell-clickable" : ""}${key === todayKey ? " cal-cell-today" : ""}`}
              style={info ? { background: info.color, color: info.textColor } : undefined}
              title={
                info
                  ? `${key} · ${info.label}${info.count > 1 ? ` (${info.count} entries)` : ""}`
                  : key
              }
              onClick={clickable ? () => onOpenRecord!(info!.rowId!) : undefined}
            >
              <span className="cal-daynum">{date.getDate()}</span>
              {info && <span className="cal-label">{info.label}</span>}
            </div>
          )
        })}
      </div>

      <div className="cal-legend">
        <div className="cal-scale">
          <span className="cal-legend-text">{min.toLocaleString()}</span>
          <span
            className="cal-gradient"
            style={{
              background: `linear-gradient(90deg, var(--cal-neutral), ${model.baseColor})`,
            }}
          />
          <span className="cal-legend-text">{max.toLocaleString()}</span>
        </div>
        <span className="cal-legend-text cal-legend-field">{legendLabel}</span>
        {model.skipped > 0 && (
          <span className="cal-legend-text">{model.skipped} without a readable date</span>
        )}
      </div>
    </div>
  )
}
