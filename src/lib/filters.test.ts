import { describe as suite, expect, it } from "vitest";
import { describe, isEmpty, matches, parse, serialize, toggle, type FilterItem } from "./filters";

const KEYS = ["language", "domain", "kind"];

suite("parse", () => {
  it("reads groups and query", () => {
    expect(parse("?q=dock&domain=ml,data&kind=tool", KEYS)).toEqual({
      q: "dock",
      groups: { domain: ["ml", "data"], kind: ["tool"] },
    });
  });
  it("drops unknown groups, empties and duplicates", () => {
    expect(parse("?nope=x&domain=ml,,ml&kind=", KEYS)).toEqual({ q: "", groups: { domain: ["ml"] } });
  });
  it("decodes values", () => {
    expect(parse("?q=ci%2Fcd%20basics", KEYS).q).toBe("ci/cd basics");
  });
});

suite("serialize", () => {
  it("round-trips in key order", () => {
    const s = serialize({ q: "a b", groups: { kind: ["tool"], domain: ["ml", "data"] } }, KEYS);
    expect(s).toBe("?q=a%20b&domain=ml,data&kind=tool");
    expect(parse(s, KEYS)).toEqual({ q: "a b", groups: { domain: ["ml", "data"], kind: ["tool"] } });
  });
  it("is empty with nothing selected", () => {
    expect(serialize({ q: "", groups: {} }, KEYS)).toBe("");
  });
});

suite("toggle", () => {
  it("adds and removes, deleting empty groups", () => {
    const a = toggle({ q: "", groups: {} }, "domain", "ml");
    expect(a.groups).toEqual({ domain: ["ml"] });
    expect(toggle(a, "domain", "ml").groups).toEqual({});
    expect(isEmpty(toggle(a, "domain", "ml"))).toBe(true);
  });
});

const docker: FilterItem = { id: "docker", text: "Docker containers", values: { domain: ["devops", "backend"], kind: ["tool", "platform"], language: [] } };
const sqla: FilterItem = { id: "sqlalchemy", text: "SQLAlchemy ORM", values: { domain: ["backend", "data"], kind: ["library"], language: ["python"] } };

suite("matches", () => {
  it("is OR within a group", () => {
    const s = parse("?domain=devops,data", KEYS);
    expect(matches(docker, s)).toBe(true);
    expect(matches(sqla, s)).toBe(true);
  });
  it("is AND across groups", () => {
    const s = parse("?domain=backend&kind=library", KEYS);
    expect(matches(docker, s)).toBe(false);
    expect(matches(sqla, s)).toBe(true);
  });
  it("matches text case-insensitively", () => {
    expect(matches(docker, parse("?q=DOCK", KEYS))).toBe(true);
    expect(matches(sqla, parse("?q=dock", KEYS))).toBe(false);
  });
  it("uses full-text hits instead of text when given", () => {
    const s = parse("?q=anything", KEYS);
    expect(matches(sqla, s, new Set(["sqlalchemy"]))).toBe(true);
    expect(matches(docker, s, new Set(["sqlalchemy"]))).toBe(false);
  });
  it("treats an empty group value list as unfiltered but a missing item value as no match", () => {
    expect(matches(docker, parse("?language=python", KEYS))).toBe(false);
    expect(matches(docker, { q: "", groups: { language: [] } })).toBe(true);
  });
});

suite("describe", () => {
  const groupLabels = { domain: "Domain", kind: "Kind" };
  const valueLabels = { domain: { ml: "ML", data: "Data" }, kind: { platform: "Platform" } };
  it("names every active filter", () => {
    expect(describe(parse("?domain=ml,data&kind=platform", KEYS), groupLabels, valueLabels, KEYS)).toBe("Domain: ML or Data and Kind: Platform");
    expect(describe(parse("?q=x&kind=platform", KEYS), groupLabels, valueLabels, KEYS)).toBe('search "x" and Kind: Platform');
    expect(describe(parse("?q=x", KEYS), groupLabels, valueLabels, KEYS)).toBe('search "x"');
  });
});
