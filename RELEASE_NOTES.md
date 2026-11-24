# Chart 0.4.0

- **Calendar Heatmap** colors each day by Count or by Sum, Average, Minimum, or Maximum of a numeric Value field. Group by a date or date/time field to aggregate all matching records.
- Choose a scale color and use Local or UTC for date/time grouping and Today. Date-only fields keep their calendar day.
- Browse by month or week and select a populated day to open its latest record.

# Chart 0.3.3

- Group all matching `datetime` records by UTC day, month, or year. Timestamps without a timezone are read as UTC.
- Count every matching record at any time interval, including records with an empty Value field.
- Calculate Sum, Average, Min, and Max over numeric Formula results, including values returned as `bigint` or numeric text. Chart checks the result type of Formula and Lookup fields and shows a settings message for non-numeric fields.
- Clear chart data and hide PNG export when loading fails. Retry reloads the chart with the current settings.

# Chart 0.3.0

Requires Eidos Lite 0.20.0 or later and Plugin API 3. Update Lite before installing this package.

Charts use the Eidos table capability for context and aggregation. Existing chart settings remain in the Eidos File. CLI Serve requires Eidos CLI 3.0.0 or later.
