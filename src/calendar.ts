import type {
  EidosFileFieldInfo,
  EidosFileRow,
} from "@eidos.space/eidos-file"
import {
  formatMetricNumber,
  readCell,
  toFiniteNumber,
  toUtcIso,
  unreadableValuesMessage,
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
  key: string // YYYY-MM-DD
  color: string
  textColor: string
  label: string
  count: number
  rowId?: string
}

export interface CalendarModel {
  /** Days without data are simply absent, so they render empty. */
  days: Map<string, CalendarDay>
  range?: { min: number; max: number }
  baseColor: string
  totalRecords: number
  /** Rows whose date could not be read. */
  skipped: number
  error?: string
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

export const neutralRgb = (isDark: boolean): Rgb =>
  isDark ? [62, 62, 60] : [232, 232, 230]

/** Readable text color (dark or white) for a #rrggbb background. */
export function contrastText(background: string): string {
  const [r, g, b] = hexToRgb(background)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1f1f1e" : "#ffffff"
}

/** Color for a value on the scale min..max (neutral -> base color). */
export function scaleColor(
  value: number,
  min: number,
  max: number,
  baseColor: string,
  isDark: boolean
): string {
  const t = max === min ? 0.7 : 0.15 + 0.85 * ((value - min) / (max - min))
  return mix(neutralRgb(isDark), hexToRgb(baseColor), t)
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Calendar day (YYYY-MM-DD) of a date/datetime cell, or null when unreadable. */
export function dayKeyOf(raw: unknown, tz: CalendarTimezone): string | null {
  let value: string | number
  if (typeof raw === "string") {
    const text = raw.trim()
    if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text // calendar date, no timezone
    value = text
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw
  } else {
    return null
  }
  const iso = toUtcIso(value)
  if (!iso) return null
  if (tz === "UTC") return iso.slice(0, 10)
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function buildCalendarModel(
  rows: EidosFileRow[],
  fields: EidosFileFieldInfo[],
  config: Pick<ChartConfig, "group" | "value" | "aggregate" | "calendarTz" | "color">,
  isDark: boolean
): CalendarModel {
  const tz: CalendarTimezone = config.calendarTz ?? "Local"
  const baseColor = CALENDAR_COLORS[config.color ?? "Blue"] ?? CALENDAR_COLORS.Blue
  const dateField = fields.find((f) => f.id === config.group)
  const valueField = fields.find((f) => f.id === config.value)
  const dateCol = dateField?.tableColumnName ?? config.group
  const valueCol = valueField?.tableColumnName ?? config.value
  const idCol = fields.find((f) => f.systemRole === "row-id")?.tableColumnName ?? "_id"
  const useValues = config.aggregate !== "Count" && !!valueField

  type Bucket = { ts: number; values: number[]; count: number; rowId?: string }
  const buckets = new Map<string, Bucket>()
  const probe = { keyed: false, raw: false, numeric: false, sample: undefined as unknown }
  let skipped = 0

  for (const row of rows) {
    const rawDate = readCell(row, dateField, dateCol)
    const key = dayKeyOf(rawDate, tz)
    if (!key) {
      skipped++
      continue
    }
    const parsed = typeof rawDate === "string" ? Date.parse(rawDate) : Number(rawDate)
    const ts = Number.isFinite(parsed) ? parsed : 0
    const bucket = buckets.get(key) ?? { ts: -Infinity, values: [], count: 0 }
    bucket.count++
    const rowId = (row as Record<string, unknown>)[idCol]
    if (ts >= bucket.ts) {
      bucket.ts = ts
      if (typeof rowId === "string") bucket.rowId = rowId // latest entry of the day
    }
    if (useValues) {
      const raw = readCell(row, valueField, valueCol)
      if (raw !== undefined) probe.keyed = true
      if (raw !== undefined && raw !== null && raw !== "") {
        probe.raw = true
        probe.sample ??= raw
      }
      const n = toFiniteNumber(raw)
      if (n !== undefined) {
        probe.numeric = true
        bucket.values.push(n)
      }
    }
    buckets.set(key, bucket)
  }

  const model: CalendarModel = {
    days: new Map(),
    baseColor,
    totalRecords: rows.length,
    skipped,
  }

  if (useValues && rows.length > 0 && !probe.numeric && (!probe.keyed || probe.raw)) {
    model.error = unreadableValuesMessage(valueField!, probe)
    return model
  }

  const results: Array<{ key: string; bucket: Bucket; value: number }> = []
  for (const [key, bucket] of buckets) {
    let value: number
    if (config.aggregate === "Count" || !valueField) {
      value = bucket.count
    } else {
      if (bucket.values.length === 0) continue // no numeric value: leave the day empty
      const v = bucket.values
      value =
        config.aggregate === "Sum"
          ? v.reduce((a, b) => a + b, 0)
          : config.aggregate === "Average"
            ? v.reduce((a, b) => a + b, 0) / v.length
            : config.aggregate === "Minimum"
              ? Math.min(...v)
              : Math.max(...v)
    }
    results.push({ key, bucket, value })
  }
  if (results.length === 0) return model

  const min = Math.min(...results.map((r) => r.value))
  const max = Math.max(...results.map((r) => r.value))
  model.range = { min, max }
  for (const { key, bucket, value } of results) {
    const color = scaleColor(value, min, max, baseColor, isDark)
    model.days.set(key, {
      key,
      color,
      textColor: contrastText(color),
      label: formatMetricNumber(value),
      count: bucket.count,
      rowId: bucket.rowId,
    })
  }
  return model
}
