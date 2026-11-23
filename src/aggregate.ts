import type {
  EidosFileFieldInfo,
  EidosFileRow,
} from "@eidos.space/eidos-file"
import type {
  TableAggregateDateInterval,
  TableAggregateMetric,
  TableAggregateOptions,
} from "@eidos.space/plugin-sdk"
import type {
  ChartAggregate,
  ChartConfig,
  ChartDataItem,
  ChartDataResult,
} from "./types"

export const NOTION_COLORS_LIGHT = [
  "#2383e2", // blue
  "#0f7b6c", // green
  "#dfab01", // yellow
  "#d9730d", // orange
  "#e03e3e", // red
  "#6940a5", // purple
  "#ad1a72", // pink
  "#64473a", // brown
  "#4d5566", // slate
  "#0b6e99", // cyan
]

export const NOTION_COLORS_DARK = [
  "#529cca", // blue
  "#4dab9a", // green
  "#ffdc49", // yellow
  "#ffa344", // orange
  "#ff7369", // red
  "#9a6dd7", // purple
  "#e255a1", // pink
  "#937264", // brown
  "#979ca6", // slate
  "#529cca", // cyan
]

export function getChartColor(index: number, isDark: boolean): string {
  const palette = isDark ? NOTION_COLORS_DARK : NOTION_COLORS_LIGHT
  return palette[index % palette.length]!
}

export function getChartPalette(count: number, isDark: boolean): string[] {
  const palette = isDark ? NOTION_COLORS_DARK : NOTION_COLORS_LIGHT
  const colors: string[] = []
  for (let i = 0; i < count; i++) {
    colors.push(palette[i % palette.length]!)
  }
  return colors
}

export function toTableAggregateOptions(
  config: ChartConfig
): TableAggregateOptions {
  const opMap: Record<ChartAggregate, TableAggregateMetric> = {
    Count: "count",
    Sum: "sum",
    Average: "average",
    Minimum: "min",
    Maximum: "max",
  }
  const intervalMap: Record<
    ChartConfig["date"],
    TableAggregateDateInterval
  > = {
    Exact: "exact",
    Day: "day",
    Month: "month",
    Year: "year",
  }
  const sortMap: Record<
    ChartConfig["sort"],
    "label" | "value-desc" | "value-asc"
  > = {
    Label: "label",
    "Value descending": "value-desc",
    "Value ascending": "value-asc",
  }

  return {
    groupBy: config.group
      ? {
          fieldId: config.group,
          dateInterval: intervalMap[config.date] ?? "exact",
        }
      : undefined,
    metric: {
      fieldId:
        config.aggregate === "Count" ? undefined : config.value || undefined,
      op: opMap[config.aggregate] ?? "count",
    },
    sort: sortMap[config.sort] ?? "label",
  }
}

export function formatMetricNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString()
  }
  return Number(value.toFixed(2)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/**
 * Coerces a raw SQLite/host cell into a finite number. Row cells are
 * `string | number | bigint | null | boolean`, and virtual Formula fields can
 * surface integers as bigint or numbers as numeric text.
 */
export function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === "bigint") {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  if (typeof raw === "string") {
    const text = raw.trim()
    if (!text) return undefined
    const n = Number(text.replace(",", "."))
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Error text for a value field whose cells cannot be read as numbers. */
export function unreadableValuesMessage(
  field: EidosFileFieldInfo,
  probe: { keyed: boolean; sample: unknown }
): string {
  const why = probe.keyed
    ? `found non-numeric values (example: ${typeof probe.sample} ${String(probe.sample)})`
    : "the host did not return this field in the rows"
  return `Could not read numeric values from "${field.name}" (${field.type} field): ${why}.`
}

/**
 * Reads a cell from a row. Rows are keyed by `tableColumnName`; virtual fields
 * (Formula, Lookup) may be keyed differently depending on the host, so fall
 * back to the other identifiers the field exposes.
 */
export function readCell(
  row: EidosFileRow,
  field: EidosFileFieldInfo | undefined,
  fallbackKey: string
): unknown {
  const keys = [
    field?.tableColumnName,
    field?.physicalName ?? undefined,
    field?.id,
    field?.name,
    fallbackKey,
  ]
  for (const key of keys) {
    if (key && Object.prototype.hasOwnProperty.call(row, key)) {
      return (row as Record<string, unknown>)[key]
    }
  }
  return undefined
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const HAS_TIMEZONE = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/

/**
 * Converts a datetime value to a UTC ISO string. Strings without an explicit
 * timezone (e.g. SQLite's "YYYY-MM-DD HH:MM:SS") are treated as UTC instead of
 * the viewer's local time, so buckets do not depend on the browser timezone.
 * Returns null when the value cannot be parsed.
 */
export function toUtcIso(value: string | number): string | null {
  let timestamp: number
  if (typeof value === "number") {
    timestamp = value
  } else {
    let text = value.trim()
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) {
      text = text.replace(" ", "T")
      if (!HAS_TIMEZONE.test(text)) text += "Z"
    }
    timestamp = Date.parse(text)
  }
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function formatDateKey(raw: string | number, interval: ChartConfig["date"]): string {
  if (interval === "Exact") return String(raw)

  const text = String(raw).trim()
  if (!text) return String(raw)

  // Date-only values are already calendar dates. Datetime values are
  // normalized to UTC before extracting the requested calendar interval.
  const calendarValue =
    typeof raw === "string" && DATE_ONLY.test(text)
      ? text
      : toUtcIso(raw) ?? text

  if (interval === "Year") return calendarValue.slice(0, 4)
  if (interval === "Month") return calendarValue.slice(0, 7)
  if (interval === "Day") return calendarValue.slice(0, 10)
  return String(raw)
}

/**
 * Client-side aggregation engine used for local fallback or testing.
 */
export function aggregateRowsClientSide(
  rows: EidosFileRow[],
  fields: EidosFileFieldInfo[],
  config: ChartConfig
): ChartDataResult {
  const aggregator = createRowAggregator(fields, config)
  aggregator.addRows(rows)
  return aggregator.finish()
}

export function createRowAggregator(
  fields: EidosFileFieldInfo[],
  config: ChartConfig
) {
  const groupField = fields.find((f) => f.id === config.group)
  const valueField = fields.find((f) => f.id === config.value)

  const groupCol = groupField?.tableColumnName ?? config.group
  const valueCol = valueField?.tableColumnName ?? config.value

  const optionsMap = new Map<string, string>()
  if (
    (groupField?.type === "select" || groupField?.type === "multi-select") &&
    Array.isArray(groupField.property?.options)
  ) {
    for (const opt of groupField.property.options as Array<{
      id: string
      name: string
    }>) {
      optionsMap.set(opt.id, opt.name)
    }
  }

  const needsValues = config.aggregate !== "Count"
  const probe = {
    keyed: false,
    raw: false,
    numeric: false,
    sample: undefined as unknown,
  }
  let totalRecords = 0
  const readValue = (row: EidosFileRow): number | undefined => {
    const raw = readCell(row, valueField, valueCol)
    if (raw !== undefined) probe.keyed = true
    if (raw !== undefined && raw !== null && raw !== "") {
      probe.raw = true
      probe.sample ??= raw
    }
    const n = toFiniteNumber(raw)
    if (n !== undefined) probe.numeric = true
    return n
  }
  function newBucket(key: unknown, label: string) {
    return {
      key,
      label,
      count: 0,
      numericCount: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
    }
  }
  const groups = new Map<string, ReturnType<typeof newBucket>>()
  const total = newBucket(null, "Total")

  const isList =
    groupField?.storageCodec === "json_array" ||
    groupField?.storageCodec === "relation"

  function addValue(
    bucket: ReturnType<typeof newBucket>,
    value: number | undefined
  ) {
    bucket.count++
    if (value === undefined) return
    bucket.numericCount++
    bucket.sum += value
    bucket.min = Math.min(bucket.min, value)
    bucket.max = Math.max(bucket.max, value)
  }

  function addRows(rows: EidosFileRow[]) {
    totalRecords += rows.length
    for (const row of rows) {
      const numeric = needsValues ? readValue(row) : undefined
      if (!groupField) {
        addValue(total, numeric)
        continue
      }

      const rawGroupVal = readCell(row, groupField, groupCol)
      for (const key of isList ? listKeys(rawGroupVal) : [rawGroupVal]) {
        const bucketKey =
          (groupField.type === "date" && typeof key === "string") ||
          (groupField.type === "datetime" &&
            (typeof key === "string" || typeof key === "number"))
            ? formatDateKey(key, config.date)
            : key
        const stringKey = bucketKey == null ? "__null__" : String(bucketKey)

        let bucket = groups.get(stringKey)
        if (!bucket) {
          let label = String(bucketKey)
          if (bucketKey == null || bucketKey === "") {
            label = "(Empty)"
          } else if (groupField.type === "checkbox") {
            label = bucketKey === 1 || bucketKey === true ? "Checked" : "Unchecked"
          } else if (typeof bucketKey === "string") {
            label = optionsMap.get(bucketKey) ?? label
          }
          bucket = newBucket(bucketKey, label)
          groups.set(stringKey, bucket)
        }
        addValue(bucket, numeric)
      }
    }
  }

  function finish(): ChartDataResult {
    if (
      needsValues &&
      valueField &&
      totalRecords > 0 &&
      !probe.numeric &&
      (!probe.keyed || probe.raw)
    ) {
      throw new Error(unreadableValuesMessage(valueField, probe))
    }

    const items: ChartDataItem[] = []
    for (const bucket of groupField ? groups.values() : [total]) {
      let value = 0
      switch (config.aggregate) {
        case "Count":
          value = bucket.count
          break
        case "Sum":
          value = bucket.sum
          break
        case "Average":
          value = bucket.numericCount ? bucket.sum / bucket.numericCount : 0
          break
        case "Minimum":
          value = bucket.numericCount ? bucket.min : 0
          break
        case "Maximum":
          value = bucket.numericCount ? bucket.max : 0
          break
      }
      items.push({ key: bucket.key, label: bucket.label, value })
    }

    if (config.sort === "Value descending") {
      items.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    } else if (config.sort === "Value ascending") {
      items.sort((a, b) => a.value - b.value || a.label.localeCompare(b.label))
    } else {
      items.sort((a, b) => a.label.localeCompare(b.label))
    }
    return { items, totalRecords }
  }

  return { addRows, finish }
}

function listKeys(value: unknown): unknown[] {
  if (value == null) return [null]
  if (Array.isArray(value)) return value.length ? value : [null]
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const entries: unknown[] = JSON.parse(value)
      return entries.length ? entries : [null]
    } catch {
      return [value]
    }
  }
  return [value]
}
