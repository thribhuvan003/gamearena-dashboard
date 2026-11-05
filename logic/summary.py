from datetime import date, datetime, time, timedelta, timezone


def date_window(start, end):
    """Include the whole end date, even when events have fractional seconds."""
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first > last:
        raise ValueError("The start date must come before the end date.")
    # Stop at midnight after the last day so all of the selected end date is included.
    return {
        "start": datetime.combine(first, time.min, timezone.utc),
        "end": datetime.combine(last + timedelta(days=1), time.min, timezone.utc),
    }


def percent(part, total):
    """An empty period has no percentage; zero would suggest a measured result."""
    return round(part * 100 / total, 1) if total else None


def recent_start(first, last):
    """Use 30 calendar days ending at the latest stored date, not today's date."""
    if first is None or last is None:
        return None
    return max(first, last - timedelta(days=29))


def explain_outcomes(counts):
    """Separate overlapping success/failure flags into four groups that add up."""
    total, success, failure, both = (counts[key] for key in ("total", "succeeded", "failed", "both"))
    # Remove the overlap from each single-outcome group and count it once in Both.
    groups = [
        {"name": "Success, no failure recorded", "count": success - both, "tone": "green"},
        {"name": "Both success and failure", "count": both, "tone": "blue"},
        {"name": "Failure, no success recorded", "count": failure - both, "tone": "amber"},
        {"name": "Neither event recorded", "count": total - success - failure + both, "tone": "gray"},
    ]
    return {**counts, "success_share": percent(success, total), "groups": groups}
