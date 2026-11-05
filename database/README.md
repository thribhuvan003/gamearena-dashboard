# SQL reports

Keep each question in its own file. This makes it easier to read a query, explain its result and change it without touching unrelated reports.

## Original investigation steps

`01_data_check.sql` through `04_performance_check.sql` are the original checks. They are kept for reference and can be run individually in CMD. The dashboard does not run these files.

## Reports used by the dashboard

| File in `dashboard` | Question it answers |
| --- | --- |
| `range.sql` | Which dates are stored? |
| `overview.sql` | Which sessions recorded attempts, successes, failures or connection signals? |
| `trend.sql` | How many distinct sessions had events, successes or failures on each UTC day? |
| `failures.sql` | Where were pipeline failure events recorded, and how many sessions were involved? |
| `coverage.sql` | How many statistics batches and measured sessions are in the selected period? |
| `metrics.sql` | What are the daily numeric totals, counts and extremes for each measurement? |
| `inventory.sql` | Which measurement fields and arrays were recorded each day? |
| `investigation.sql` | Which session and connection patterns deserve investigation? |
| `payload.sql` | How often do the approved payload fields occur? |
| `readiness.sql` | What do the reported readiness durations show? |

The backend binds the selected dates as parameters and uses a read-only transaction. Success and failure counts can overlap. Repeated failure events are not distinct failed sessions. The queries return aggregates, not individual records.

The `%(start)s` and `%(end)s` placeholders are supplied by Python. Run dashboard reports through the application; they are not standalone CMD scripts.
