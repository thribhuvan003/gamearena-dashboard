def selected_days(rows, window):
    """Statistics are selected by their UTC batch-start date."""
    first = window["start"].date()
    after_last = window["end"].date()
    return (row for row in rows if first <= row["day"] < after_last)


def combine_measurements(rows, window):
    """Add day totals before dividing, so every numeric sample has equal weight."""
    result = {}
    for row in selected_days(rows, window):
        name = row["metric"]
        item = result.setdefault(name, {
            "metric": name, "entries": 0, "valid": 0, "missing": 0, "invalid": 0,
            "total": 0, "minimum": None, "maximum": None,
        })
        for key in ("entries", "valid", "missing", "invalid"):
            item[key] += row[key]
        if row["valid"]:
            item["total"] += row["total"]
            # Missing days must not introduce a false minimum of zero.
            if item["minimum"] is None or row["minimum"] < item["minimum"]:
                item["minimum"] = row["minimum"]
            if item["maximum"] is None or row["maximum"] > item["maximum"]:
                item["maximum"] = row["maximum"]
    # Divide after adding every day together. A field with no valid readings has no mean.
    for item in result.values():
        total = item.pop("total")
        item["mean"] = total / item["valid"] if item["valid"] else None
    return sorted(result.values(), key=lambda item: item["metric"])


def combine_inventory(rows, window):
    """Count the batches containing each field in the selected dates."""
    result = {}
    for row in selected_days(rows, window):
        item = result.setdefault(row["metric"], {
            "metric": row["metric"], "present_rows": 0, "array_rows": 0,
        })
        item["present_rows"] += row["present_rows"]
        item["array_rows"] += row["array_rows"]
    return sorted(result.values(), key=lambda item: item["metric"])


def monthly_measurements(rows, window):
    """Compare calendar months using the same daily totals, with no extra sample scan."""
    # Use the batch month and keep only the part inside the selected dates.
    months = {}
    for row in selected_days(rows, window):
        month = row["day"].strftime("%Y-%m")
        months.setdefault(month, []).append(row)
    result = []
    for month in sorted(months):
        metrics = combine_measurements(months[month], window)
        result.append({"month": month, "metrics": metrics})
    return result
