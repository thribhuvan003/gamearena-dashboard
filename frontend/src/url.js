// The page's choices live in the address bar, so Back works and a copied link opens the same view.
export function readUrl() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

// Sets or clears the given keys. The first write of a visit replaces the entry instead of adding one.
export function writeUrl(changes, replace = false) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString() ? "?" + params : "";
  if (query === window.location.search) return;
  const address = window.location.pathname + query;
  if (replace) window.history.replaceState(null, "", address);
  else window.history.pushState(null, "", address);
}
