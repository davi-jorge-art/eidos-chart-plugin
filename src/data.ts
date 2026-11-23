import type { EidosFileFieldInfo, EidosFileRow } from "@eidos.space/eidos-file"
import type { EidosTable, EidosTableSnapshot } from "@eidos.space/plugin-sdk"
import { createRowAggregator, toTableAggregateOptions } from "./aggregate"
import { createCalendarAggregator, type CalendarModel } from "./calendar"
import type { ChartConfig, ChartDataResult } from "./types"

export type LoadedChartData = ChartDataResult & { calendar?: CalendarModel }

function fieldResultType(field: EidosFileFieldInfo): unknown {
  if (
    field.type === "lookup" &&
    (field.storageCodec === "json_array" ||
      field.property?.aggregate === "values")
  ) {
    return "list"
  }
  return field.type === "formula" || field.type === "lookup"
    ? (field.property?.valueType ?? field.property?.displayType)
    : field.type
}

const DATE_TYPES = new Set<unknown>([
  "date",
  "datetime",
  "created-time",
  "last-edited-time",
])
const NUMERIC_TYPES = new Set<unknown>(["number", "integer", "rating"])

/** Scale bounds are text settings so they can be left empty (= automatic). */
function parseScaleBound(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined
  if (typeof raw !== "string" || !raw.trim()) return undefined
  const value = Number(raw.trim().replace(",", "."))
  return Number.isFinite(value) ? value : undefined
}

export function readChartSettings(snapshot?: EidosTableSnapshot) {
  const saved = snapshot?.view.properties?.plugin as
    | (Omit<Partial<ChartConfig>, "type"> & {
        type?: ChartConfig["type"] | "Calendar" | "Colored Calendar"
        timezone?: ChartConfig["calendarTz"]
        "scale-min"?: unknown
        "scale-max"?: unknown
      })
    | undefined
  const type = saved?.type
  const config: ChartConfig = {
    type:
      type === "Calendar" || type === "Colored Calendar"
        ? "Calendar Heatmap"
        : (type ?? "Column"),
    group: saved?.group ?? "",
    value: saved?.value ?? "",
    aggregate: saved?.aggregate ?? "Count",
    date: saved?.date ?? "Exact",
    sort: saved?.sort ?? "Label",
    legend: saved?.legend ?? true,
    calendarTz: saved?.timezone ?? "Local",
    color: saved?.color ?? "Blue",
    scaleMin: parseScaleBound(saved?.["scale-min"]),
    scaleMax: parseScaleBound(saved?.["scale-max"]),
  }
  const fields = snapshot?.fields ?? []
  const groupField = fields.find((field) => field.id === config.group)
  const valueField = fields.find((field) => field.id === config.value)
  const needsValues = config.aggregate !== "Count"
  const valueType = valueField && fieldResultType(valueField)
  const groupType = groupField && fieldResultType(groupField)
  let configProblem = ""
  if (
    config.type === "Calendar Heatmap" &&
    groupField &&
    groupType != null &&
    !DATE_TYPES.has(groupType)
  ) {
    configProblem = `Choose a date field for Group by. "${groupField.name}" cannot place records on days.`
  } else if (
    needsValues &&
    valueField &&
    valueType != null &&
    !NUMERIC_TYPES.has(valueType)
  ) {
    configProblem = `"${valueField.name}" is incompatible with ${config.aggregate}. Choose a numeric Value field or set Calculate to Count.`
  }

  return {
    config,
    fields,
    groupField,
    valueField,
    configProblem,
    isConfigured:
      !configProblem &&
      (config.type === "Number" || groupField !== undefined) &&
      (!needsValues || valueField !== undefined),
    // Older hosts can ignore datetime intervals or omit virtual field result types.
    useRows:
      (groupField?.type === "datetime" && config.date !== "Exact") ||
      (needsValues && valueField !== undefined && valueType == null),
  }
}

export async function loadChartData(
  table: Pick<EidosTable, "aggregate" | "readRows">,
  settings: ReturnType<typeof readChartSettings>,
  signal: AbortSignal
): Promise<LoadedChartData> {
  const { config, fields, useRows } = settings
  signal.throwIfAborted()
  if (config.type === "Calendar Heatmap") {
    const aggregator = createCalendarAggregator(fields, config)
    await readRowPages(table, signal, aggregator.addRows)
    const calendar = aggregator.finish()
    return { items: [], totalRecords: calendar.totalRecords, calendar }
  }
  if (!useRows && typeof table.aggregate === "function") {
    try {
      const result = await table.aggregate(toTableAggregateOptions(config))
      signal.throwIfAborted()
      return result
    } catch (cause) {
      signal.throwIfAborted()
      console.warn("Host table.aggregate unavailable, falling back:", cause)
    }
  }

  const aggregator = createRowAggregator(fields, config)
  await readRowPages(table, signal, aggregator.addRows)
  return aggregator.finish()
}

async function readRowPages(
  table: Pick<EidosTable, "readRows">,
  signal: AbortSignal,
  addRows: (rows: EidosFileRow[]) => void
) {
  let offset = 0
  let total: number | undefined
  while (true) {
    const page = await table.readRows({ offset, limit: 1000 })
    signal.throwIfAborted()
    total ??= page.total
    const nextOffset = offset + page.rows.length
    if (
      !Number.isSafeInteger(total) ||
      page.total !== total ||
      nextOffset > total ||
      (nextOffset < total && nextOffset === offset)
    ) {
      throw new Error(
        "The table changed while loading the chart. Retry to refresh the data."
      )
    }
    addRows(page.rows)
    if (nextOffset === total) return
    offset = nextOffset
  }
}
