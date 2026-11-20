import { describe, emptyState, isEmpty, matches, parse, serialize, toggle, type FilterItem, type FilterState } from "./filters";

/**
 * Binds the FilterBar markup inside `root`:
 *   [data-filter-ui]       form, hidden until JS runs (without JS every item shows)
 *   input[name=q]          text query
 *   fieldset[data-group]   chip group; button[data-value][aria-pressed] chips
 *   [data-filter-clear]    clears everything
 *   [data-filter-item]     data-id, data-text, data-values (JSON), optional [data-excerpt]
 *   [data-filter-count]    live region
 *   [data-filter-empty]    empty state with [data-filter-empty-text] and [data-filter-reset]
 *   script[data-filter-labels]  JSON { groups: {key: label}, values: {key: {value: label}} }
 */

export interface SearchResult {
  ids: Set<string>;
  excerpts: Map<string, string>;
}

export interface BindOptions {
  /** Full-text search. Return null to fall back to matching item text. */
  search?: (q: string) => Promise<SearchResult | null>;
}

interface Labels {
  groups: Record<string, string>;
  values: Record<string, Record<string, string>>;
}

export function bindFilters(root: HTMLElement, opts: BindOptions = {}): void {
  const ui = root.querySelector<HTMLFormElement>("[data-filter-ui]");
  if (!ui) return;
  const noun = root.dataset.noun ?? "items";
  const keys = (root.dataset.keys ?? "").split(",").filter(Boolean);
  const labels = JSON.parse(root.querySelector("script[data-filter-labels]")?.textContent ?? "{}") as Labels;
  const input = ui.querySelector<HTMLInputElement>('input[name="q"]');
  const chips = [...ui.querySelectorAll<HTMLButtonElement>("fieldset[data-group] button[data-value]")];
  const clear = ui.querySelector<HTMLButtonElement>("[data-filter-clear]");
  const count = root.querySelector<HTMLElement>("[data-filter-count]");
  const empty = root.querySelector<HTMLElement>("[data-filter-empty]");
  const emptyText = root.querySelector<HTMLElement>("[data-filter-empty-text]");
  const reset = root.querySelector<HTMLButtonElement>("[data-filter-reset]");
  const els = [...root.querySelectorAll<HTMLElement>("[data-filter-item]")];
  const items: Array<FilterItem & { el: HTMLElement; excerpt: HTMLElement | null }> = els.map((el) => ({
    el,
    id: el.dataset.id ?? "",
    text: el.dataset.text ?? el.textContent ?? "",
    values: JSON.parse(el.dataset.values ?? "{}") as Record<string, string[]>,
    excerpt: el.querySelector<HTMLElement>("[data-excerpt]"),
  }));

  let state: FilterState = parse(location.search, keys);
  let run = 0;
  let timer = 0;

  async function apply(push: boolean) {
    const token = ++run;
    let result: SearchResult | null = null;
    if (state.q && opts.search) {
      result = await opts.search(state.q).catch(() => null);
      if (token !== run) return;
    }
    let shown = 0;
    for (const item of items) {
      const ok = matches(item, state, result?.ids);
      item.el.hidden = !ok;
      if (ok) shown++;
      if (item.excerpt) {
        const html = result?.excerpts.get(item.id);
        item.excerpt.innerHTML = html ?? "";
        item.excerpt.hidden = !html;
      }
    }
    for (const chip of chips) {
      const group = chip.closest<HTMLElement>("fieldset[data-group]")?.dataset.group ?? "";
      chip.setAttribute("aria-pressed", String(state.groups[group]?.includes(chip.dataset.value ?? "") ?? false));
    }
    if (input && document.activeElement !== input) input.value = state.q;
    if (clear) clear.hidden = isEmpty(state);
    if (count) count.textContent = isEmpty(state) ? `${items.length} ${noun}` : `Showing ${shown} of ${items.length} ${noun}`;
    if (empty) empty.hidden = shown > 0;
    if (emptyText && shown === 0) emptyText.textContent = `No ${noun} match ${describe(state, labels.groups ?? {}, labels.values ?? {}, keys)}.`;
    if (push) history.replaceState(history.state, "", `${location.pathname}${serialize(state, keys)}${location.hash}`);
  }

  function resetAll() {
    state = emptyState();
    if (input) input.value = "";
    void apply(true);
  }

  ui.hidden = false;
  ui.addEventListener("submit", (e) => e.preventDefault());
  input?.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      state = { ...state, q: input.value.trim() };
      void apply(true);
    }, 180);
  });
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const group = chip.closest<HTMLElement>("fieldset[data-group]")?.dataset.group;
      if (!group || !chip.dataset.value) return;
      state = toggle(state, group, chip.dataset.value);
      void apply(true);
    });
  }
  clear?.addEventListener("click", resetAll);
  reset?.addEventListener("click", () => {
    resetAll();
    input?.focus();
  });
  window.addEventListener("popstate", () => {
    state = parse(location.search, keys);
    void apply(false);
  });
  if (input) input.value = state.q;
  void apply(false);
}
