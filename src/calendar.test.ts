import { describe, expect, it } from "vitest"
import type { EidosFileFieldInfo, EidosFileRow } from "@eidos.space/eidos-file"
import type { ChartConfig } from "./types"
import { buildCalendarModel, CALENDAR_COLORS, contrastText, dayKeyOf, scaleColor } from "./calendar"

const f = (o: Record<string, unknown>) => o as unknown as EidosFileFieldInfo
const rowsOf = (r: unknown[]) => r as unknown as EidosFileRow[]

const dateField = f({ id: "f_dt", name: "Date/Time", type: "datetime", tableColumnName: "dt" })
const numField = f({ id: "f_n", name: "Mood Number Values", type: "formula", tableColumnName: "n" })
const cfg = (
  aggregate: ChartConfig["aggregate"],
  value = "f_n",
  extra: Partial<ChartConfig> = {}
) => ({ group: "f_dt", value, aggregate, calendarTz: "UTC" as const, ...extra })

describe("colored calendar", () => {
  it("averages the numeric value per day and leaves days without entries empty", () => {
    const rows = rowsOf([
      { _id: "a", dt: "2026-11-17T18:17:00.000Z", n: 2 },
      { _id: "b", dt: "2026-11-17T03:00:00.000Z", n: "2" },
      { _id: "c", dt: "2026-11-16T12:00:00.000Z", n: 1n },
      { _id: "d", dt: "2026-11-16T18:00:00.000Z", n: -1 },
    ])
    const m = buildCalendarModel(rows, [dateField, numField], cfg("Average"), false)
    expect(m.error).toBeUndefined()
    expect(m.range).toEqual({ min: 0, max: 2 })
    expect(m.days.get("2026-11-17")).toMatchObject({ label: "2", count: 2, rowId: "a" })
    expect(m.days.get("2026-11-16")).toMatchObject({ label: "0", count: 2, rowId: "d" })
    expect(m.days.has("2026-11-18")).toBe(false)
  })

  it("applies Sum, Minimum, Maximum and Count", () => {
    const rows = rowsOf([
      { dt: "2026-11-16T10:00:00Z", n: 3 },
      { dt: "2026-11-16T11:00:00Z", n: 5 },
      { dt: "2026-11-16T12:00:00Z", n: null },
    ])
    const label = (agg: ChartConfig["aggregate"]) =>
      buildCalendarModel(rows, [dateField, numField], cfg(agg), false).days.get("2026-11-16")!.label
    expect(label("Sum")).toBe("8")
    expect(label("Minimum")).toBe("3")
    expect(label("Maximum")).toBe("5")
    expect(label("Count")).toBe("3")
  })

  it("leaves a day empty when it has entries but no numeric value", () => {
    const rows = rowsOf([
      { dt: "2026-11-16T10:00:00Z", n: null },
      { dt: "2026-11-17T10:00:00Z", n: 4 },
    ])
    const m = buildCalendarModel(rows, [dateField, numField], cfg("Average"), false)
    expect(m.days.has("2026-11-16")).toBe(false)
    expect(m.days.has("2026-11-17")).toBe(true)
  })

  it("Count needs no value field", () => {
    const rows = rowsOf([
      { dt: "2026-11-16T10:00:00Z" },
      { dt: "2026-11-17T10:00:00Z" },
      { dt: "2026-11-17T11:00:00Z" },
    ])
    const m = buildCalendarModel(rows, [dateField], cfg("Count", ""), false)
    expect(m.days.get("2026-11-17")!.label).toBe("2")
    expect(m.days.get("2026-11-17")!.color).not.toBe(m.days.get("2026-11-16")!.color)
  })

  it("uses the chosen base color, defaulting to blue", () => {
    const rows = rowsOf([{ dt: "2026-11-16T10:00:00Z" }, { dt: "2026-11-17T10:00:00Z" }, { dt: "2026-11-17T11:00:00Z" }])
    const blue = buildCalendarModel(rows, [dateField], cfg("Count", ""), false)
    const green = buildCalendarModel(rows, [dateField], cfg("Count", "", { color: "Green" }), false)
    expect(blue.baseColor).toBe(CALENDAR_COLORS.Blue)
    expect(green.baseColor).toBe(CALENDAR_COLORS.Green)
    // The maximum of the scale is the base color itself.
    expect(blue.days.get("2026-11-17")!.color).toBe("#3b8fe0")
    expect(green.days.get("2026-11-17")!.color).toBe("#2f9e7e")
  })

  it("reports an error instead of an empty calendar when values are unreadable", () => {
    const text = [{ dt: "2026-11-16T10:00:00Z", n: "Great" }]
    expect(buildCalendarModel(rowsOf(text), [dateField, numField], cfg("Average"), false).error).toMatch(/Mood Number Values/)
    const missing = [{ dt: "2026-11-16T10:00:00Z" }]
    expect(buildCalendarModel(rowsOf(missing), [dateField, numField], cfg("Average"), false).error).toMatch(/did not return/)
    const empty = [{ dt: "2026-11-16T10:00:00Z", n: null }]
    expect(buildCalendarModel(rowsOf(empty), [dateField, numField], cfg("Average"), false).error).toBeUndefined()
  })

  it("skips rows without a readable date", () => {
    const rows = rowsOf([{ dt: null, n: 1 }, { dt: "nope", n: 1 }, { dt: "2026-11-16T10:00:00Z", n: 1 }])
    const m = buildCalendarModel(rows, [dateField, numField], cfg("Sum"), false)
    expect(m.skipped).toBe(2)
    expect(m.days.size).toBe(1)
  })

  it("assigns days by UTC or by local time", () => {
    const raw = "2026-11-17T02:30:00.000Z"
    expect(dayKeyOf(raw, "UTC")).toBe("2026-11-17")
    const d = new Date(raw)
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    expect(dayKeyOf(raw, "Local")).toBe(local)
    expect(dayKeyOf("2026-11-17", "Local")).toBe("2026-11-17")
    expect(dayKeyOf("2026-11-17 23:30:00", "UTC")).toBe("2026-11-17")
    expect(dayKeyOf("hello", "UTC")).toBeNull()
  })

  it("scales from neutral to the base color with readable text", () => {
    expect(scaleColor(10, 0, 10, "#3b8fe0", false)).toBe("#3b8fe0")
    expect(scaleColor(5, 5, 5, "#3b8fe0", false)).not.toBe("#3b8fe0")
    expect(contrastText("#ffffff")).toBe("#1f1f1e")
    expect(contrastText("#000000")).toBe("#ffffff")
  })
})
