import { describe, expect, it } from "vitest"
import type { EidosFileFieldInfo, EidosFileRow } from "@eidos.space/eidos-file"
import {
  aggregateRowsClientSide,
  formatMetricNumber,
  toTableAggregateOptions,
} from "./aggregate"
import type { ChartConfig } from "./types"

const sampleFields = [
  {
    id: "f_status",
    name: "Status",
    type: "select",
    tableColumnName: "col_status",
    property: {
      options: [
        { id: "opt_todo", name: "To Do", color: "gray" },
        { id: "opt_done", name: "Done", color: "green" },
      ],
    },
  },
  {
    id: "f_amount",
    name: "Amount",
    type: "number",
    tableColumnName: "col_amount",
  },
  {
    id: "f_date",
    name: "Date",
    type: "date",
    tableColumnName: "col_date",
  },
  {
    id: "f_tags",
    name: "Tags",
    type: "multi-select",
    storageCodec: "json_array",
    tableColumnName: "col_tags",
    property: {
      options: [
        { id: "bug", name: "Bug", color: "red" },
        { id: "feat", name: "Feature", color: "blue" },
      ],
    },
  },
] as unknown as EidosFileFieldInfo[]

const sampleRows = [
  { col_status: "opt_todo", col_amount: 100, col_date: "2026-03-01", col_tags: ["bug"] },
  { col_status: "opt_todo", col_amount: 200, col_date: "2026-03-15", col_tags: ["bug", "feat"] },
  { col_status: "opt_done", col_amount: 50, col_date: "2026-04-10", col_tags: ["feat"] },
  { col_status: null, col_amount: 150, col_date: "2026-04-20", col_tags: [] },
] as unknown as EidosFileRow[]

describe("aggregate", () => {
  it("converts ChartConfig to TableAggregateOptions", () => {
    const config: ChartConfig = {
      type: "Column",
      group: "f_status",
      value: "f_amount",
      aggregate: "Sum",
      date: "Month",
      sort: "Value descending",
      legend: true,
    }
    const options = toTableAggregateOptions(config)
    expect(options).toEqual({
      groupBy: { fieldId: "f_status", dateInterval: "month" },
      metric: { fieldId: "f_amount", op: "sum" },
      sort: "value-desc",
    })
  })

  it("calculates table-level total metric when no group field is chosen", () => {
    const config: ChartConfig = {
      type: "Number",
      group: "",
      value: "f_amount",
      aggregate: "Sum",
      date: "Exact",
      sort: "Label",
      legend: false,
    }
    const result = aggregateRowsClientSide(sampleRows, sampleFields, config)
    expect(result.totalRecords).toBe(4)
    expect(result.items).toEqual([{ key: null, label: "Total", value: 500 }])
  })

  it("calculates grouped sum by status with select option label mapping", () => {
    const config: ChartConfig = {
      type: "Column",
      group: "f_status",
      value: "f_amount",
      aggregate: "Sum",
      date: "Exact",
      sort: "Value descending",
      legend: true,
    }
    const result = aggregateRowsClientSide(sampleRows, sampleFields, config)
    expect(result.totalRecords).toBe(4)
    expect(result.items).toEqual([
      { key: "opt_todo", label: "To Do", value: 300 },
      { key: null, label: "(Empty)", value: 150 },
      { key: "opt_done", label: "Done", value: 50 },
    ])
  })

  it("calculates grouped count by date with month interval", () => {
    const config: ChartConfig = {
      type: "Line",
      group: "f_date",
      value: "",
      aggregate: "Count",
      date: "Month",
      sort: "Label",
      legend: true,
    }
    const result = aggregateRowsClientSide(sampleRows, sampleFields, config)
    expect(result.totalRecords).toBe(4)
    expect(result.items).toEqual([
      { key: "2026-03", label: "2026-03", value: 2 },
      { key: "2026-04", label: "2026-04", value: 2 },
    ])
  })

  it("unpacks multi-select tags properly for count", () => {
    const config: ChartConfig = {
      type: "Bar",
      group: "f_tags",
      value: "",
      aggregate: "Count",
      date: "Exact",
      sort: "Value descending",
      legend: true,
    }
    const result = aggregateRowsClientSide(sampleRows, sampleFields, config)
    expect(result.items).toEqual([
      { key: "bug", label: "Bug", value: 2 },
      { key: "feat", label: "Feature", value: 2 },
      { key: null, label: "(Empty)", value: 1 },
    ])
  })

  it("formats metric numbers nicely", () => {
    expect(formatMetricNumber(1200)).toBe("1,200")
    expect(formatMetricNumber(1234.567)).toBe("1,234.57")
    expect(formatMetricNumber(0)).toBe("0")
  })

  it("calculates average grouped by UTC day for datetime fields", () => {
    const fields = [
      {
        id: "f_datetime",
        name: "Date/Time",
        type: "datetime",
        tableColumnName: "col_datetime",
      },
      {
        id: "f_mood",
        name: "Mood Number Values",
        type: "formula",
        tableColumnName: "col_mood",
      },
    ] as unknown as EidosFileFieldInfo[]
    const rows = [
      { col_datetime: "2026-11-16T09:00:00.000Z", col_mood: -2 },
      { col_datetime: "2026-11-16T14:00:00.000Z", col_mood: 2 },
      { col_datetime: "2026-11-17T09:00:00.000Z", col_mood: 0 },
    ] as unknown as EidosFileRow[]
    const config: ChartConfig = {
      type: "Line",
      group: "f_datetime",
      value: "f_mood",
      aggregate: "Average",
      date: "Day",
      sort: "Label",
      legend: false,
    }

    const result = aggregateRowsClientSide(rows, fields, config)
    expect(result.totalRecords).toBe(3)
    expect(result.items).toEqual([
      { key: "2026-11-16", label: "2026-11-16", value: 0 },
      { key: "2026-11-17", label: "2026-11-17", value: 0 },
    ])
  })

  it("normalizes datetime offsets to UTC before daily grouping", () => {
    const fields = [
      {
        id: "f_datetime",
        name: "Date/Time",
        type: "datetime",
        tableColumnName: "col_datetime",
      },
      {
        id: "f_mood",
        name: "Mood Number Values",
        type: "formula",
        tableColumnName: "col_mood",
      },
    ] as unknown as EidosFileFieldInfo[]
    const rows = [
      { col_datetime: "2026-11-17T01:00:00.000+03:00", col_mood: 1 },
      { col_datetime: "2026-11-16T22:00:00.000Z", col_mood: -1 },
    ] as unknown as EidosFileRow[]
    const config: ChartConfig = {
      type: "Line",
      group: "f_datetime",
      value: "f_mood",
      aggregate: "Average",
      date: "Day",
      sort: "Label",
      legend: false,
    }

    const result = aggregateRowsClientSide(rows, fields, config)
    expect(result.items).toEqual([
      { key: "2026-11-16", label: "2026-11-16", value: 0 },
    ])
  })

  it("treats datetime strings without timezone as UTC, regardless of local timezone", () => {
    const fields = [
      { id: "f_dt", name: "Date/Time", type: "datetime", tableColumnName: "col_dt" },
      { id: "f_mood", name: "Mood", type: "formula", tableColumnName: "col_mood" },
    ] as unknown as EidosFileFieldInfo[]
    const rows = [
      { col_dt: "2026-11-16 23:30:00", col_mood: 4 },
      { col_dt: "2026-11-16T00:15:00", col_mood: 2 },
      { col_dt: "2026-11-17 00:30:00", col_mood: 10 },
    ] as unknown as EidosFileRow[]
    const config: ChartConfig = {
      type: "Line", group: "f_dt", value: "f_mood", aggregate: "Average",
      date: "Day", sort: "Label", legend: false,
    }
    const result = aggregateRowsClientSide(rows, fields, config)
    expect(result.items).toEqual([
      { key: "2026-11-16", label: "2026-11-16", value: 3 },
      { key: "2026-11-17", label: "2026-11-17", value: 10 },
    ])
  })

  it("groups numeric epoch datetime values by UTC month", () => {
    const fields = [
      { id: "f_dt", name: "Date/Time", type: "datetime", tableColumnName: "col_dt" },
    ] as unknown as EidosFileFieldInfo[]
    const rows = [
      { col_dt: Date.UTC(2026, 10, 30, 23, 0) },
      { col_dt: Date.UTC(2026, 11, 1, 1, 0) },
      { col_dt: Date.UTC(2026, 11, 20, 1, 0) },
    ] as unknown as EidosFileRow[]
    const config: ChartConfig = {
      type: "Column", group: "f_dt", value: "", aggregate: "Count",
      date: "Month", sort: "Label", legend: false,
    }
    const result = aggregateRowsClientSide(rows, fields, config)
    expect(result.items.map((i) => [i.label, i.value])).toEqual([
      ["2026-11", 1],
      ["2026-12", 2],
    ])
  })

  it("averages formula values read as bigint or numeric text (two Great = +2 on the same day)", () => {
    const fields = [
      { id: "f_dt", name: "Date/Time", type: "datetime", tableColumnName: "col_dt" },
      { id: "f_mood", name: "Mood Number Values", type: "formula", tableColumnName: "col_mood", physicalName: null },
    ] as unknown as EidosFileFieldInfo[]
    const config: ChartConfig = {
      type: "Line", group: "f_dt", value: "f_mood", aggregate: "Average",
      date: "Day", sort: "Label", legend: false,
    }
    const variants: unknown[][] = [
      ["2", "2"],
      [2n, 2n],
      [" 2.0 ", 2],
    ]
    for (const [a, b] of variants) {
      const rows = [
        { col_dt: "2026-11-17T18:17:00.000Z", col_mood: a },
        { col_dt: "2026-11-17T03:00:00.000Z", col_mood: b },
      ] as unknown as EidosFileRow[]
      const result = aggregateRowsClientSide(rows, fields, config)
      expect(result.items).toEqual([
        { key: "2026-11-17", label: "2026-11-17", value: 2 },
      ])
    }
  })

  it("finds virtual field values keyed by field id when the column name is absent", () => {
    const fields = [
      { id: "f_dt", name: "Date/Time", type: "datetime", tableColumnName: "col_dt" },
      { id: "f_mood", name: "Mood Number Values", type: "formula", tableColumnName: "col_mood" },
    ] as unknown as EidosFileFieldInfo[]
    const rows = [
      { col_dt: "2026-11-17T18:17:00.000Z", f_mood: 2 },
      { col_dt: "2026-11-17T03:00:00.000Z", f_mood: 2 },
    ] as unknown as EidosFileRow[]
    const config: ChartConfig = {
      type: "Line", group: "f_dt", value: "f_mood", aggregate: "Average",
      date: "Day", sort: "Label", legend: false,
    }
    expect(aggregateRowsClientSide(rows, fields, config).items[0]!.value).toBe(2)
  })

  it("fails loudly instead of returning 0 when the value field cannot be read", () => {
    const fields = [
      { id: "f_dt", name: "Date/Time", type: "datetime", tableColumnName: "col_dt" },
      { id: "f_mood", name: "Mood Number Values", type: "formula", tableColumnName: "col_mood" },
    ] as unknown as EidosFileFieldInfo[]
    const config: ChartConfig = {
      type: "Line", group: "f_dt", value: "f_mood", aggregate: "Average",
      date: "Day", sort: "Label", legend: false,
    }
    const missing = [{ col_dt: "2026-11-17T18:17:00.000Z" }] as unknown as EidosFileRow[]
    expect(() => aggregateRowsClientSide(missing, fields, config)).toThrow(/Mood Number Values/)
    const text = [{ col_dt: "2026-11-17T18:17:00.000Z", col_mood: "Great" }] as unknown as EidosFileRow[]
    expect(() => aggregateRowsClientSide(text, fields, config)).toThrow(/non-numeric values/)
    const empty = [{ col_dt: "2026-11-17T18:17:00.000Z", col_mood: null }] as unknown as EidosFileRow[]
    expect(aggregateRowsClientSide(empty, fields, config).items[0]!.value).toBe(0)
  })
})
