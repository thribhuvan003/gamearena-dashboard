// The browser asks for named reports. It never receives a database connection or sends SQL.
export async function getReport(name, params = {}, signal) {
  let response;
  try {
    response = await fetch(`/api/${name}/?${new URLSearchParams(params)}`, {
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Cannot reach the local server. Keep the VS Code CMD terminal running, then retry.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "The server did not return a readable report. Restart the dashboard and retry.",
    );
  }
  if (!response.ok)
    throw new Error(
      result.error ||
        "This report could not be loaded. Select Refresh data to retry.",
    );
  return result;
}
