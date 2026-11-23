import type { EidosFileFieldInfo, EidosFileRow } from "@eidos.space/eidos-file"
import {
  createNumericValueReader,
  MetricAccumulator,
  readCell,
  toUtcIso,
} from "./aggregate"
import type { CalendarColorName, CalendarTimezone, ChartConfig } from "./types"

/** Same color names the Eidos interface offers for select options. */
export const CALENDAR_COLORS: Record<CalendarColorName, string> = {
  Blue: "#3b8fe0",
  Green: "#2f9e7e",
  Yellow: "#e6b422",
  Orange: "#e08a2e",
  Red: "#e5534b",
  Pink: "#d9488f",
  Purple: "#8e5fd0",
  Brown: "#937264",
  Gray: "#8f8e8a",
}

export interface CalendarDay {
  value: number
  count: number
  rowId?: string
}

export interface CalendarModel {
  /** Days without data are simply absent, so they render empty. */
  days: Map<string, CalendarDay>
  range?: { min: number; max: number }
  totalRecords: number
  /** Rows whose date could not be read. */
  skipped: number
}

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "")
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function mix(a: Rgb, b: Rgb, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * k))
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

const neutralRgb = (isDark: boolean): Rgb =>
  isDark ? [62, 62, 60] : [232, 232, 230]

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrastText(background: string): string {
  const light = luminance(background) + 0.05
  if (light / (luminance("#1f1f1e") + 0.05) >= 4.5) return "#1f1f1e"
  return 1.05 / light >= 4.5 ? "#ffffff" : "#000000"
}

/** Color for a value on the scale min..max (neutral -> base color). */
export function scaleColor(
  value: number,
  min: number,
  max: number,
  baseColor: string,
  isDark: boolean
): string {
  const clamped = Math.min(max, Math.max(min, value))
  const t = max === min ? 0.7 : 0.15 + 0.85 * ((clamped - min) / (max - min))
  return mix(neutralRgb(isDark), hexToRgb(baseColor), t)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

export function dayKeyForInstant(
  date: Date,
  timezone: CalendarTimezone
): string {
  if (timezone === "UTC") return date.toISOString().slice(0, 10)
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dayPlacement(raw: unknown, timezone: CalendarTimezone) {
  const value = typeof raw === "string" ? raw.trim() : raw
  const dateOnly = typeof value === "string" && DATE.test(value)
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && (dateOnly || DATETIME.test(value)))
  )
    return null
  const iso = toUtcIso(value)
  if (!iso || !DATE.test(iso.slice(0, 10))) return null
  if (dateOnly && iso.slice(0, 10) !== value) return null
  const date = new Date(iso)
  const key = dateOnly ? iso.slice(0, 10) : dayKeyForInstant(date, timezone)
  return { key, timestamp: date.getTime() }
}

export function dayKeyOf(
  raw: unknown,
  timezone: CalendarTimezone
): string | null {
  return dayPlacement(raw, timezone)?.key ?? null
}

type CalendarConfig = Pick<
  ChartConfig,
  "group" | "value" | "aggregate" | "calendarTz" | "scaleMin" | "scaleMax"
>

interface RecordOrder {
  rowId: string
  timestamp: number
  createdAt: number
}

function comesAfter(record: RecordOrder, previous: RecordOrder | undefined) {
  if (!previous) return true
  if (record.timestamp !== previous.timestamp) {
    return record.timestamp > previous.timestamp
  }
  if (record.createdAt !== previous.createdAt) {
    return record.createdAt > previous.createdAt
  }
  return record.rowId > previous.rowId
}

export function createCalendarAggregator(
  fields: EidosFileFieldInfo[],
  config: CalendarConfig
) {
  const timezone = config.calendarTz ?? "Local"
  const dateField = fields.find((f) => f.id === config.group)
  const valueField = fields.find((f) => f.id === config.value)
  const idField = fields.find((f) => f.systemRole === "row-id")
  const createdField = fields.find(
    (f) => f.systemRole === "created-time" || f.type === "created-time"
  )
  const useValues = config.aggregate !== "Count"
  const values = createNumericValueReader(valueField, config.value)
  const buckets = new Map<
    string,
    { metric: MetricAccumulator; latest?: RecordOrder }
  >()
  let skipped = 0
  let totalRecords = 0

  function addRows(rows: EidosFileRow[]) {
    totalRecords += rows.length
    for (const row of rows) {
      const placement = dayPlacement(
        readCell(row, dateField, config.group),
        timezone
      )
      if (!placement) {
        skipped++
        continue
      }
      const { key, timestamp } = placement
      const bucket = buckets.get(key) ?? { metric: new MetricAccumulator() }
      bucket.metric.add(useValues ? values.read(row) : undefined)
      const rowId = row._id ?? readCell(row, idField, "_id")
      if (typeof rowId === "string" && rowId) {
        const creation = readCell(row, createdField, "_created_at")
        const createdAt = dayPlacement(creation, "UTC")?.timestamp ?? -Infinity
        const record = { timestamp, rowId, createdAt }
        if (comesAfter(record, bucket.latest)) bucket.latest = record
      }
      buckets.set(key, bucket)
    }
  }

  function finish(): CalendarModel {
    if (useValues) values.assertReadable(totalRecords - skipped)

    const days = new Map<string, CalendarDay>()
    let min = Infinity
    let max = -Infinity
    for (const [key, { metric, latest }] of buckets) {
      if (useValues && !metric.numericCount) continue
      const value = metric.value(config.aggregate)
      days.set(key, { value, count: metric.count, rowId: latest?.rowId })
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    // A fixed scale (e.g. -2..2 for a mood score) makes colors comparable
    // across months; otherwise the lowest/highest day shown sets the ends.
    let rangeMin = config.scaleMin ?? min
    let rangeMax = config.scaleMax ?? max
    if (rangeMin > rangeMax) {
      rangeMin = min
      rangeMax = max
    }
    return {
      days,
      range: days.size ? { min: rangeMin, max: rangeMax } : undefined,
      totalRecords,
      skipped,
    }
  }

  return { addRows, finish }
}

export function buildCalendarModel(
  rows: EidosFileRow[],
  fields: EidosFileFieldInfo[],
  config: CalendarConfig
): CalendarModel {
  const aggregator = createCalendarAggregator(fields, config)
  aggregator.addRows(rows)
  return aggregator.finish()
}
