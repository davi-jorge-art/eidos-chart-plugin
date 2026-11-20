import type {
  EidosFileFieldInfo,
  EidosFileViewInfo,
} from "@eidos.space/eidos-file"

export type ChartType =
  | "Column"
  | "Bar"
  | "Line"
  | "Donut"
  | "Number"
  | "Colored Calendar"

export type CalendarTimezone = "Local" | "UTC"

export type CalendarColorName =
  | "Blue"
  | "Green"
  | "Yellow"
  | "Orange"
  | "Red"
  | "Pink"
  | "Purple"
  | "Brown"
  | "Gray"

export type ChartAggregate = "Count" | "Sum" | "Average" | "Minimum" | "Maximum"

export type ChartDateGrouping = "Exact" | "Day" | "Month" | "Year"

export type ChartSort = "Label" | "Value descending" | "Value ascending"

export interface ChartConfig {
  type: ChartType
  group: string
  value: string
  aggregate: ChartAggregate
  date: ChartDateGrouping
  sort: ChartSort
  legend: boolean
  /** Calendar only: timezone used to decide which day a datetime belongs to. */
  calendarTz?: CalendarTimezone
  /** Colored Calendar only: base color of the value scale. */
  color?: CalendarColorName
}

export interface ChartDataItem {
  key: unknown
  label: string
  value: number
  color?: string
}

export interface ChartDataResult {
  items: ChartDataItem[]
  totalRecords: number
}

export interface EidosTableSnapshot {
  fields: EidosFileFieldInfo[]
  view: EidosFileViewInfo
}
