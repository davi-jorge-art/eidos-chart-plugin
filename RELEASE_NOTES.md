# Chart 0.4.0

- New **Colored Calendar** chart type: a month/week grid that colors each day by the Calculate result (Count, or Sum/Average/Minimum/Maximum of a numeric Value field). Days without data stay empty.
- Group by is the date field. Value field must be numeric.
- Scale color is configurable (**Colored Calendar color**); day assignment can use Local time or UTC (**Calendar day timezone**).
- Month/Week layout, Today and previous/next navigation. Click a day to open its latest record.

# Chart 0.3.3

- Fix daily/monthly/yearly grouping of `datetime` fields (for example a daily average of a Mood score). Timestamps are normalized to UTC before bucketing, strings without a timezone are read as UTC, and grouped `datetime` charts no longer trust host aggregation that returns one point per record.
- Fix Sum/Average/Min/Max over Formula fields showing 0 when the host returns values as `bigint` or numeric text. If no numeric value can be read, the chart now reports an error naming the field instead of plotting 0.
- Show a clear message when a non-numeric Value field (select, text, date...) is combined with Sum/Average/Min/Max, instead of a flat line at 0.

# Chart 0.3.0

Requires Eidos Lite 0.20.0 or later and Plugin API 3. Update Lite before installing this package.

Charts use the Eidos table capability for context and aggregation. Existing chart settings remain in the Eidos File. CLI Serve requires Eidos CLI 3.0.0 or later.
