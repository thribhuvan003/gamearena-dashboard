import { useEffect, useState } from "react";

export async function getReport(name, params = {}, signal) {
  let response;
  try {
    response = await fetch(`/api/${name}/?${new URLSearchParams(params)}`, {
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Cannot reach the local server. Is start.cmd running?");
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("The server sent an unreadable reply. Restart start.cmd.");
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
