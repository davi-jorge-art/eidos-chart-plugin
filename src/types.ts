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
  | "Calendar Heatmap"

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
  /** Timezone for Calendar Heatmap datetime grouping and navigation. */
  calendarTz?: CalendarTimezone
  /** Base color of the Calendar Heatmap value scale. */
  color?: CalendarColorName
  /** Calendar Heatmap fixed scale ends. Unset = lowest/highest day shown. */
  scaleMin?: number
  scaleMax?: number
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
