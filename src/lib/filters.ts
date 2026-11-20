/**
 * Filter state shared by /stack and /knowledge. Pure functions only (unit-tested);
 * the DOM binding lives in filter-ui.ts.
 *
 * URL format: ?q=text&domain=ml,data&kind=framework
 * Matching: OR within a group, AND across groups, AND with the text query.
 */

export interface FilterState {
  q: string;
  groups: Record<string, string[]>;
}

export interface FilterItem {
  id: string;
  /** Text matched by the query when no full-text search result is supplied. */
  text: string;
  values: Record<string, readonly string[]>;
}

export function emptyState(): FilterState {
  return { q: "", groups: {} };
}

/** Reads state from a query string. Unknown groups and duplicate values are dropped. */
export function parse(search: string, keys: readonly string[]): FilterState {
  const params = new URLSearchParams(search);
  const groups: Record<string, string[]> = {};
  for (const key of keys) {
    const raw = params.get(key);
    if (!raw) continue;
    const values = [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
    if (values.length) groups[key] = values;
  }
  return { q: (params.get("q") ?? "").trim(), groups };
}

/** Serialises state to a query string ("" when nothing is selected). Group order follows `keys`. */
export function serialize(state: FilterState, keys: readonly string[]): string {
  const parts: string[] = [];
  if (state.q) parts.push(`q=${encodeURIComponent(state.q)}`);
  for (const key of keys) {
    const values = state.groups[key];
    if (values?.length) parts.push(`${key}=${values.map(encodeURIComponent).join(",")}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function isEmpty(state: FilterState): boolean {
  return !state.q && Object.values(state.groups).every((v) => v.length === 0);
}

export function toggle(state: FilterState, key: string, value: string): FilterState {
  const current = state.groups[key] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const groups = { ...state.groups };
  if (next.length) groups[key] = next;
  else delete groups[key];
  return { ...state, groups };
}

/**
 * Does an item pass the filters? `textHits` is the set of ids returned by a full-text
 * search for `state.q`; when omitted, the query is matched against `item.text`.
 */
export function matches(item: FilterItem, state: FilterState, textHits?: ReadonlySet<string> | null): boolean {
  if (state.q) {
    if (textHits) {
      if (!textHits.has(item.id)) return false;
    } else if (!item.text.toLowerCase().includes(state.q.toLowerCase())) {
      return false;
    }
  }
  for (const [key, selected] of Object.entries(state.groups)) {
    if (!selected.length) continue;
    const have = item.values[key] ?? [];
    if (!selected.some((v) => have.includes(v))) return false;
  }
  return true;
}

/**
 * Human description of the active filters, for the empty state:
 * 'search "foo", Domain: ML or Data and Kind: Platform'.
 */
export function describe(
  state: FilterState,
  groupLabels: Record<string, string>,
  valueLabels: Record<string, Record<string, string>>,
  keys: readonly string[],
): string {
  const parts: string[] = [];
  if (state.q) parts.push(`search "${state.q}"`);
  for (const key of keys) {
    const values = state.groups[key];
    if (!values?.length) continue;
    const labels = values.map((v) => valueLabels[key]?.[v] ?? v);
    parts.push(`${groupLabels[key] ?? key}: ${labels.join(" or ")}`);
  }
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
