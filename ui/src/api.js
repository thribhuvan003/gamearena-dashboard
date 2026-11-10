// Fetches API reports and turns failures into plain messages. useReport loads one report
// for a component and reloads it when its inputs change.
import { useEffect, useState } from "react";

export async function getReport(name, params = {}, signal) {
  let response;
  try {
    response = await fetch(`/api/${name}/?${new URLSearchParams(params)}`, {
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Can't reach the dashboard right now. Check your connection and refresh.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Something went wrong loading this. Refresh to try again.");
  }
  if (!response.ok)
    throw new Error(result.error || "Could not load. Refresh to retry.");
  return result;
}

// A new revision (the Refresh button) asks again with the same parameters.
export function useReport(name, params, revision = 0) {
  const [result, setResult] = useState({});
  const key = JSON.stringify([name, params, revision]);
  useEffect(() => {
    if (!name) return;
    const controller = new AbortController();
    const [, values] = JSON.parse(key);
    setResult({ key, loading: true });
    getReport(name, values, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, error: error.message });
      });
    return () => controller.abort();
  }, [key]);
  // A new date or card renders before its request starts; never show the previous rows.
  return !name ? {} : result.key === key ? result : { loading: true };
}
