"""Date and number helpers: turn picked dates into a UTC range, read page numbers, work out
percentages."""
from datetime import date, datetime, time, timedelta, timezone


def date_window(start, end):
    # Ends at midnight after the last day, so the whole end date is included.
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first > last:
        raise ValueError("Start date is after end date.")
    return {
        "start": datetime.combine(first, time.min, timezone.utc),
        "end": datetime.combine(last + timedelta(days=1), time.min, timezone.utc),
    }


def percent(part, total):
    # An empty period has no percentage; 0% would look like a measured result.
    return round(part * 100 / total, 1) if total else None


def recent_start(first, last):
    # The last 30 days of data, not the last 30 days before today.
    if first is None or last is None:
        return None
    return max(first, last - timedelta(days=29))


def page_number(value):
    page = int(value)
    if not 1 <= page <= 100000:
        raise ValueError("Invalid page")
    return page
