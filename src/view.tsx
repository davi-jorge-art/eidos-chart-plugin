import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import type { Mount, EidosTable } from "@eidos.space/plugin-sdk"
import { exportChartPng, type ChartHostUI } from "./export"
import { loadChartData, readChartSettings } from "./data"
import { ChartCanvas } from "./charts/chart-canvas"
import { NumberCard } from "./charts/number-card"
import type { ChartDataResult } from "./types"
import "./style.css"

const EMPTY_CHART: ChartDataResult = { items: [], totalRecords: 0 }

function useColorScheme(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return false
    const hostScheme = getComputedStyle(document.documentElement)
      .getPropertyValue("--eidos-color-scheme")
      .trim()
    if (hostScheme) return hostScheme === "dark"
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })

  useEffect(() => {
    const check = () => {
      const hostScheme = getComputedStyle(document.documentElement)
        .getPropertyValue("--eidos-color-scheme")
        .trim()
      if (hostScheme) {
        setIsDark(hostScheme === "dark")
      } else {
        setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches)
      }
    }

    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    })

    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    mql.addEventListener("change", check)

    return () => {
      observer.disconnect()
      mql.removeEventListener("change", check)
    }
  }, [])

  return isDark
}

function ChartView({
  table,
  ui,
  embedded,
}: {
  table: EidosTable
  ui: ChartHostUI
  embedded: boolean
}) {
  const chartRoot = useRef<HTMLElement>(null)
  const exportBusy = useRef(false)
  const active = useRef(true)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState("")
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const isDark = useColorScheme()
  const [settings, setSettings] = useState(() => readChartSettings())
  const { config, groupField, valueField, configProblem, isConfigured } = settings
  const [data, setData] = useState(EMPTY_CHART)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)

  // Listen to invalidation events from the table
  useEffect(() => {
    const observation = table.watch(() => setRevision((v) => v + 1))
    return () => observation.dispose()
  }, [table])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setLoading(true)
    setError("")

    async function loadData() {
      try {
        const snapshot = await table.readContext()
        if (signal.aborted) return
        const next = readChartSettings(snapshot)
        setSettings(next)
        const result = next.isConfigured
          ? await loadChartData(table, next, signal)
          : EMPTY_CHART
        if (!signal.aborted) setData(result)
      } catch (err) {
        if (!signal.aborted) {
          setData(EMPTY_CHART)
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void loadData()
    return () => controller.abort()
  }, [table, revision])

  const exportImage = async () => {
    if (exportBusy.current || loading || error || !ui.exportFile) return
    exportBusy.current = true
    setExporting(true)
    setExportStatus("")
    try {
      const canvas =
        chartRoot.current?.querySelector<HTMLCanvasElement>(
          ".chart-canvas-container canvas"
        ) ?? null
      const status = await exportChartPng(
        canvas,
        ui.exportFile,
        `chart-${Date.now()}.png`
      )
      if (active.current) setExportStatus(status)
    } catch (cause) {
      if (active.current)
        setExportStatus(
          `Export failed: ${cause instanceof Error ? cause.message : String(cause)}`
        )
    } finally {
      exportBusy.current = false
      if (active.current) setExporting(false)
    }
  }

  return (
    <main className={`chart-root${embedded ? " chart-embedded" : ""}`} ref={chartRoot}>
      {!embedded && (
        <header className="chart-header">
          <div className="chart-title-area">
            <h1 className="chart-title">
              {config.type === "Number"
                ? "Metric"
                : `${groupField?.name ?? "Items"} by ${config.aggregate}`}
            </h1>
            {isConfigured && !error && (
              <span className="chart-record-count">
                · {data.totalRecords.toLocaleString()}{" "}
                {data.totalRecords === 1 ? "record" : "records"}
              </span>
            )}
          </div>
          <div className="chart-actions">
            {config.type !== "Number" &&
              isConfigured &&
              !error &&
              data.items.length > 0 && (
                <button
                  className="chart-btn"
                  onClick={exportImage}
                  disabled={exporting || loading || !ui.exportFile}
                  title={
                    ui.exportFile
                      ? "Export as PNG image"
                      : "PNG export requires an Eidos host with file export support"
                  }
                >
                  {exporting ? "Exporting…" : "Export PNG"}
                </button>
              )}
            <button
              className="chart-btn"
              onClick={() => setRevision((v) => v + 1)}
              title="Refresh chart"
            >
              ↻
            </button>
          </div>
        </header>
      )}
      <div role="status" aria-live="polite" className="chart-export-status">
        {exportStatus ||
          (!ui.exportFile && config.type !== "Number"
            ? "PNG export requires an Eidos host with file export support."
            : "")}
      </div>

      {error && (
        <div className="chart-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setRevision((v) => v + 1)}>Retry</button>
        </div>
      )}

      <div className="chart-content">
        {error ? null : !isConfigured ? (
          <div className="chart-empty">
            <svg
              className="chart-empty-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 3v18h18" />
              <path d="M7 16v-5" />
              <path d="M12 16V7" />
              <path d="M17 16v-8" />
            </svg>
            <div className="chart-empty-title">
              {configProblem ? "Check Chart settings" : "Configure Chart"}
            </div>
            <div className="chart-empty-hint">
              {configProblem
                ? configProblem
                : !groupField && config.type !== "Number"
                ? "Select a 'Group by' field in the View settings menu above."
                : "Select a numeric 'Value field' in View settings to calculate."}
            </div>
          </div>
        ) : loading && data.items.length === 0 ? (
          <div className="chart-loading">Loading chart data…</div>
        ) : data.totalRecords === 0 ? (
          <div className="chart-empty">
            <div className="chart-empty-title">No Records</div>
            <div className="chart-empty-hint">
              There are no matching records for the current filters.
            </div>
          </div>
        ) : config.type === "Number" ? (
          <NumberCard
            item={data.items[0]}
            totalRecords={data.totalRecords}
            config={config}
            valueFieldName={valueField?.name}
          />
        ) : (
          <ChartCanvas items={data.items} config={config} isDark={isDark} />
        )}
      </div>
    </main>
  )
}

const mount: Mount = (ctx, element) => {
  const table = ctx.capabilities.eidos?.table
  if (!table) {
    throw new Error("Chart plugin requires a table view")
  }
  const root = createRoot(element)
  const presentation = ctx.presentation
  root.render(
    <ChartView
      table={table}
      ui={ctx.capabilities.ui}
      embedded={presentation?.mode === "embedded"}
    />
  )
  return {
    dispose: () => root.unmount(),
  }
}

export default mount
