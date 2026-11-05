# Logic: small Python functions

- `summary.py` includes both selected dates, finds the latest 30 stored days, calculates percentages and separates overlapping outcomes.
- `measurements.py` combines daily totals for the selected period and month. It divides the total of valid readings by their count, rather than averaging daily averages.

These functions do not connect to the database or import Django. The backend supplies the rows and receives the results. Their tests live in `tests`.
