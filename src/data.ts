import type { EidosFileFieldInfo } from "@eidos.space/eidos-file"
import type { EidosTable, EidosTableSnapshot } from "@eidos.space/plugin-sdk"
import { createRowAggregator, toTableAggregateOptions } from "./aggregate"
import type { ChartConfig, ChartDataResult } from "./types"

function isNumericField(field: EidosFileFieldInfo): boolean | undefined {
  if (
    field.type === "lookup" &&
    (field.storageCodec === "json_array" ||
      field.property?.aggregate === "values")
  ) {
    return false
  }

  const type =
    field.type === "formula" || field.type === "lookup"
      ? (field.property?.valueType ?? field.property?.displayType)
      : field.type
  if (type == null) return undefined
  return type === "number" || type === "integer" || type === "rating"
}

export function readChartSettings(snapshot?: EidosTableSnapshot) {
  const saved = snapshot?.view.properties?.plugin as
    | Partial<ChartConfig>
    | undefined
  const config: ChartConfig = {
    type: saved?.type ?? "Column",
    group: saved?.group ?? "",
    value: saved?.value ?? "",
    aggregate: saved?.aggregate ?? "Count",
    date: saved?.date ?? "Exact",
    sort: saved?.sort ?? "Label",
    legend: saved?.legend ?? true,
  }
  const fields = snapshot?.fields ?? []
  const groupField = fields.find((field) => field.id === config.group)
  const valueField = fields.find((field) => field.id === config.value)
  const needsValues = config.aggregate !== "Count"
  const numeric = valueField && isNumericField(valueField)
  const configProblem =
    needsValues && valueField && numeric === false
      ? `"${valueField.name}" is incompatible with ${config.aggregate}. Choose a numeric Value field or set Calculate to Count.`
      : ""

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
      (needsValues && valueField !== undefined && numeric === undefined),
  }
}

export async function loadChartData(
  table: Pick<EidosTable, "aggregate" | "readRows">,
  settings: ReturnType<typeof readChartSettings>,
  signal: AbortSignal
): Promise<ChartDataResult> {
  const { config, fields, useRows } = settings
  signal.throwIfAborted()
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
    aggregator.addRows(page.rows)
    if (nextOffset === total) return aggregator.finish()
    offset = nextOffset
  }
}
