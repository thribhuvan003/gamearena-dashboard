// Fetches API reports and turns failures into plain messages. useReport loads one report
// for a component and reloads it when its inputs change.
import { useQuery } from "@tanstack/react-query";

// Asks the API for one report by name. A cancelled request is passed on unchanged so the
// caller can ignore it; every other failure becomes a sentence a person can act on.
export async function getReport(name, params = {}, signal) {
  let response;
  // No answer at all: the server is down or the network is.
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
  // The API always answers in JSON; anything else (say, a proxy's error page) is unreadable.
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Something went wrong loading this. Refresh to try again.");
  }
  // On a failed request the API explains itself in `error`; show its words when it does.
  // The status goes along so a 400 or 404, which asking again won't fix, is not retried.
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "Could not load. Refresh to retry."),
      { status: response.status },
    );
  return result;
}

// A new revision (the Refresh button) asks again with the same parameters.
export function useReport(name, params, revision = 0) {
  // TanStack Query compares keys by their content, so a params object rebuilt on every render
  // is the same request, and parts of the page asking for the same report share one fetch.
  // A key it has already answered shows straight away from its cache. An answer always lands
  // under its own key, so a slow one for old inputs can never overwrite the current ones, and
  // a request nobody is waiting for any more is cancelled through the signal.
  const query = useQuery({
    queryKey: [name, params, revision],
    // Undefined values are left out of the request, as they are left out of the key.
    queryFn: ({ signal }) =>
      getReport(name, JSON.parse(JSON.stringify(params)), signal),
    enabled: Boolean(name),
  });
  // A new date or card shows only its own answer, never the previous rows; until that answer
  // is in, it is loading.
  if (!name) return {};
  if (query.isPending) return { loading: true };
  if (query.isError) return { error: query.error.message };
  return { data: query.data };
}
