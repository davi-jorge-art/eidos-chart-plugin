import type { EidosFileFieldInfo, EidosFileRow } from "@eidos.space/eidos-file"
import type { EidosTable, EidosTableSnapshot } from "@eidos.space/plugin-sdk"
import { describe, expect, it, vi } from "vitest"
import { loadChartData, readChartSettings } from "./data"
import type { ChartConfig } from "./types"

const datetime = {
  id: "time",
  name: "Timestamp",
  type: "datetime",
  tableColumnName: "time",
} as EidosFileFieldInfo
const amount = {
  id: "amount",
  name: "Amount",
  type: "number",
  tableColumnName: "amount",
} as EidosFileFieldInfo
const day = "2026-11-22"
const nextDay = "2026-11-23"

function settings(
  config: Partial<ChartConfig> & Record<string, unknown>,
  fields: EidosFileFieldInfo[] = [datetime, amount]
) {
  const view: EidosTableSnapshot["view"] = {
    id: "chart",
    name: "Chart",
    type: "plugin:chart",
    tableId: "records",
    query: "{}",
    properties: { plugin: { group: "time", date: "Day", ...config } },
    filter: null,
    sorts: [],
    orderMap: null,
    hiddenFields: [],
    position: null,
    createdAt: "",
    updatedAt: "",
  }
  return readChartSettings({ fields, view })
}

function mockTable(
  page: (
    offset: number,
    limit: number
  ) => { rows: EidosFileRow[]; total: number }
) {
  return {
    aggregate: vi.fn<EidosTable["aggregate"]>(),
    readRows: vi.fn<EidosTable["readRows"]>(async ({ offset, limit }) => ({
      tableId: "records",
      offset,
      limit,
      ...page(offset, limit),
    })),
  }
}

describe("calendar color scale settings", () => {
  const cal = { type: "Calendar Heatmap" as const, aggregate: "Count" as const }

  it("leaves limits undefined for existing configurations", () => {
    const { config, configProblem } = settings(cal)
    expect(config.colorScaleMin).toBeUndefined()
    expect(config.colorScaleMax).toBeUndefined()
    expect(configProblem).toBe("")
  })

  it("reads valid user limits", () => {
    const { config, configProblem, isConfigured } = settings({
      ...cal,
      "scale-min": "-2",
      "scale-max": " 2 ",
    })
    expect(config.colorScaleMin).toBe(-2)
    expect(config.colorScaleMax).toBe(2)
    expect(configProblem).toBe("")
    expect(isConfigured).toBe(true)
  })

  it("rejects a single limit", () => {
    const r = settings({ ...cal, "scale-min": "-2" })
    expect(r.configProblem).toContain("both")
    expect(r.isConfigured).toBe(false)
  })

  it("rejects inverted limits", () => {
    const r = settings({ ...cal, "scale-min": "2", "scale-max": "-2" })
    expect(r.configProblem).toContain("less than or equal")
    expect(r.isConfigured).toBe(false)
  })

  it("accepts a decimal comma and treats empty text as automatic", () => {
    const ok = settings({ ...cal, "scale-min": "-1,5", "scale-max": "0.5" })
    expect(ok.config.colorScaleMin).toBe(-1.5)
    expect(ok.config.colorScaleMax).toBe(0.5)
    const empty = settings({ ...cal, "scale-min": "", "scale-max": "  " })
    expect(empty.config.colorScaleMin).toBeUndefined()
    expect(empty.configProblem).toBe("")
  })

  it("rejects text that is not a number", () => {
    const r = settings({ ...cal, "scale-min": "abc", "scale-max": "2" })
    expect(r.configProblem).toContain("must be numbers")
    expect(r.isConfigured).toBe(false)
    const both = settings({ ...cal, "scale-min": "x", "scale-max": "y" })
    expect(both.configProblem).toContain("must be numbers")
  })

  it("ignores the limits for other chart types", () => {
    const r = settings({ type: "Column", "scale-min": "5" })
    expect(r.configProblem).toBe("")
  })
})

describe("loadChartData", () => {
  it("includes the last UTC day when more than 50,000 records match", async () => {
    const total = 50_001
    const table = mockTable((offset, limit) => ({
      total,
      rows: Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({
        time: `${offset + i < 50_000 ? day : nextDay}T12:15:00.000Z`,
      })),
    }))
    const result = await loadChartData(
      table,
      settings({}),
      new AbortController().signal
    )
    expect(table.aggregate).not.toHaveBeenCalled()
    expect(table.readRows).toHaveBeenLastCalledWith({
      offset: 50_000,
      limit: 1000,
    })
    expect(result).toEqual({
      totalRecords: total,
      items: [
        { key: day, label: day, value: 50_000 },
        { key: nextDay, label: nextDay, value: 1 },
      ],
    })
  })

  it("streams the full table into Calendar Heatmap and preserves the last day", async () => {
    const total = 50_001
    const table = mockTable((offset, limit) => ({
      total,
      rows: Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({
        time: `${offset + i < 50_000 ? day : nextDay}T12:15:00.000Z`,
        amount: offset + i < 50_000 ? 2 : null,
      })),
    }))
    const result = await loadChartData(
      table,
      settings({ type: "Calendar Heatmap", value: "amount" }),
      new AbortController().signal
    )
    expect(table.aggregate).not.toHaveBeenCalled()
    expect(table.readRows).toHaveBeenCalledTimes(51)
    expect(result.totalRecords).toBe(total)
    expect(result.calendar?.days.get(day)).toMatchObject({ value: 50_000 })
    expect(result.calendar?.days.get(nextDay)).toMatchObject({ value: 1 })
  })

  it.each([
    ["Sum", 10],
    ["Average", 10 / 3],
    ["Minimum", -2],
    ["Maximum", 8],
  ] as const)(
    "merges %s across short pages and skips null values",
    async (aggregate, expected) => {
      const time = `${day}T00:00:00.000Z`
      const table = mockTable((offset) => ({
        total: 4,
        rows:
          offset === 0
            ? [{ time, amount: 8 }]
            : [
                { time, amount: null },
                { time, amount: 4 },
                { time, amount: -2 },
              ],
      }))
      const result = await loadChartData(
        table,
        settings({ aggregate, value: "amount" }),
        new AbortController().signal
      )
      expect(result.items).toEqual([{ key: day, label: day, value: expected }])
      expect(table.readRows).toHaveBeenLastCalledWith({
        offset: 1,
        limit: 1000,
      })
    }
  )

  it("counts records on both paths when the saved Value field has empty cells", async () => {
    const time = `${day}T00:00:00.000Z`
    const table = mockTable(() => ({
      total: 2,
      rows: [
        { time, amount: 2 },
        { time, amount: null },
      ],
    }))
    table.aggregate.mockImplementation(async ({ metric }) => ({
      items: [{ key: time, label: time, value: metric.fieldId ? 1 : 2 }],
      totalRecords: 2,
    }))
    const signal = new AbortController().signal
    const exact = await loadChartData(
      table,
      settings({ date: "Exact", value: "amount" }),
      signal
    )
    const daily = await loadChartData(
      table,
      settings({ date: "Day", value: "amount" }),
      signal
    )
    expect(table.aggregate).toHaveBeenCalledTimes(1)
    expect(exact.items[0]?.value).toBe(2)
    expect(daily.items[0]?.value).toBe(2)
  })

  it("rejects an incomplete scan when pagination stops before the reported total", async () => {
    const table = mockTable(() => ({ total: 1, rows: [] }))
    await expect(
      loadChartData(table, settings({}), new AbortController().signal)
    ).rejects.toThrow("The table changed")
  })

  it("stops requesting pages when the view is invalidated", async () => {
    const controller = new AbortController()
    const table = mockTable(() => {
      controller.abort()
      return { total: 2, rows: [{ time: day }] }
    })
    await expect(
      loadChartData(table, settings({}), controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(table.readRows).toHaveBeenCalledTimes(1)
  })
})

describe("Value field settings", () => {
  it.each([
    { type: "formula", property: { displayType: "text" } },
    {
      type: "lookup",
      property: { aggregate: "values", displayType: "integer" },
    },
    { type: "lookup", property: { aggregate: "first", valueType: "checkbox" } },
  ] as const)(
    "rejects a non-numeric $type before selecting a data path",
    (field) => {
      const fields = [datetime, { ...amount, ...field } as EidosFileFieldInfo]
      const average = settings(
        { date: "Exact", aggregate: "Average", value: "amount" },
        fields
      )
      expect(average.isConfigured).toBe(false)
      expect(average.configProblem).toContain('"Amount"')
      expect(settings({ value: "amount" }, fields).isConfigured).toBe(true)
    }
  )

  it("uses the host for a numeric Lookup and validates legacy Formula values from rows", async () => {
    const average = {
      date: "Exact",
      aggregate: "Average",
      value: "amount",
    } as const
    const lookup: EidosFileFieldInfo = {
      ...amount,
      type: "lookup",
      property: { aggregate: "sum", valueType: "integer" },
    }
    const numericLookup = settings(average, [datetime, lookup])
    expect(numericLookup.isConfigured).toBe(true)
    expect(numericLookup.useRows).toBe(false)

    const formula: EidosFileFieldInfo = {
      ...amount,
      type: "formula",
      property: null,
    }
    const legacy = settings(average, [datetime, formula])
    expect(legacy.isConfigured).toBe(true)
    expect(legacy.useRows).toBe(true)
    const table = mockTable(() => ({
      total: 1,
      rows: [{ time: `${day}T00:00:00.000Z`, amount: "Not a score" }],
    }))
    await expect(
      loadChartData(table, legacy, new AbortController().signal)
    ).rejects.toThrow(/non-numeric values/)
    expect(table.aggregate).not.toHaveBeenCalled()
  })
})

describe("Calendar Heatmap settings", () => {
  const calendar = { type: "Calendar Heatmap" } as const
  const temporalFormula: EidosFileFieldInfo = {
    ...datetime,
    type: "formula",
    property: { displayType: "date" },
  }

  it("uses result types rather than accepting every Formula or Lookup as a date", () => {
    expect(settings(calendar, [temporalFormula]).isConfigured).toBe(true)
    expect(
      settings(calendar, [
        {
          ...temporalFormula,
          type: "lookup",
          property: { valueType: "datetime" },
        },
      ]).isConfigured
    ).toBe(true)
    expect(
      settings(calendar, [
        { ...temporalFormula, property: { displayType: "integer" } },
      ]).configProblem
    ).toContain("Choose a date field")
    expect(
      settings(calendar, [
        {
          ...temporalFormula,
          type: "lookup",
          property: { aggregate: "values", displayType: "date" },
        },
      ]).isConfigured
    ).toBe(false)
  })

  it("keeps #4's numeric field validation in the heatmap", () => {
    const badScore: EidosFileFieldInfo = {
      ...amount,
      type: "formula",
      property: { displayType: "text" },
    }
    expect(
      settings({ ...calendar, aggregate: "Average", value: badScore.id }, [
        datetime,
        badScore,
      ]).configProblem
    ).toContain('"Amount" is incompatible')
  })
})
