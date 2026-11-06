import { expect, test } from "bun:test"
import { parseList, filterModels, toModels } from "./index"

test("maps per-token pricing to dollars per million tokens", () => {
  const [m] = toModels("magpie-test", [{
    id: "priced",
    pricing: {
      prompt: "0.000003",
      completion: "0.000015",
      input_cache_read: "0.0000003",
      input_cache_write: "0.00000375",
    },
  }])
  // The wire protocol (GET /api/model) encodes cost as an array of tier entries:
  // one entry with no tier is the default tier. Plain objects only pass config decoding.
  expect(m.cost).toEqual([{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }])
})

test("fills absent prices with 0, cache is always complete", () => {
  const [m] = toModels("magpie-test", [{ id: "partial", pricing: { prompt: "0.000002" } }])
  expect(m.cost).toEqual([{ input: 2, output: 0, cache: { read: 0, write: 0 } }])
})

test("keeps both cache keys when only one cache price exists", () => {
  const [m] = toModels("magpie-test", [{ id: "read-only", pricing: { prompt: "0.000002", input_cache_read: "0.0000002" } }])
  expect(m.cost).toEqual([{ input: 2, output: 0, cache: { read: 0.2, write: 0 } }])
})

test("gives a model without pricing an empty cost array", () => {
  const [m] = toModels("magpie-test", [{ id: "free" }])
  expect(m.cost).toEqual([])
})

test("maps tool_call to capabilities.tools", () => {
  const [yes, no, missing] = toModels("magpie-test", [
    { id: "yes", tool_call: true },
    { id: "no", tool_call: false },
    { id: "missing" },
  ])
  expect(yes.capabilities.tools).toBe(true)
  expect(no.capabilities.tools).toBe(false)
  expect(missing.capabilities.tools).toBe(false)
})

test("appends a priority service-tier fast variant after each reasoning variant", () => {
  const [m] = toModels("magpie-test", [{
    id: "reasoner",
    reasoning: true,
    reasoning_levels: ["LOW", "max", "low"],
  }])
  expect(m.variants.map((v) => v.id)).toEqual(["low", "low-fast", "max", "max-fast"] as any)
  expect(m.variants[1].settings).toEqual({
    reasoningEffort: "low",
    service_tier: "priority",
    extraBody: { service_tier: "priority" },
  } as any)
})

test("runtime imports stay inside the whitelist (node builtins + the plugin SDK)", async () => {
  // Guards the dependency footprint: any new bare import here means a new dependency
  // subtree installed for every user of the plugin.
  const src = await Bun.file(new URL("./index.ts", import.meta.url)).text()
  const bare = [...src.matchAll(/from\s+"([^".][^"]*)"/g)].map((m) => m[1])
  expect(bare.filter((s) => !s.startsWith("node:"))).toEqual(["@opencode/plugin"])
})

test("keeps the original metadata mapping", () => {
  const [m] = toModels("magpie-test", [{
    id: "claude/claude-sonnet-5-5",
    magpie_label: "Claude Sonnet 5.5 · Claude Code",
    context_length: 1_000_000,
    max_output_tokens: 128_000,
    modalities: { input: ["text", "image"], output: ["text"] },
  }])
  expect(m.name).toBe("Claude Sonnet 5.5 · Claude Code")
  expect(m.limit).toEqual({ context: 1_000_000, output: 128_000 })
  expect(m.capabilities.input).toEqual(["text", "image"])
})

test("name falls back from magpie_label to display_name to id", () => {
  const [labelled, displayed, bare] = toModels("magpie-test", [
    { id: "a", magpie_label: "Label", display_name: "Display" },
    { id: "b", display_name: "Display" },
    { id: "c" },
  ])
  expect(labelled.name).toBe("Label")
  expect(displayed.name).toBe("Display")
  expect(bare.name).toBe("c")
})

test("limit falls back to the model defaults for missing or invalid values", () => {
  const [valid, invalid] = toModels("magpie-test", [
    { id: "valid", context_length: 1_000, max_output_tokens: 500 },
    { id: "invalid", context_length: -1, max_output_tokens: 0 },
  ])
  expect(valid.limit).toEqual({ context: 1_000, output: 500 })
  expect(invalid.limit).toEqual({ context: 200_000, output: 32_000 })
})

test("rejects a response without a data array and drops entries without an id", () => {
  expect(() => parseList({ error: "nope" })).toThrow()
  expect(parseList({ data: [{ id: "a" }, { id: 3 }, null] }).map((m) => m.id)).toEqual(["a"])
})

test("modelFilter keeps only ids containing an include pattern, ignoring case", () => {
  const raws = [
    { id: "opencode-go/kimi-k3" },
    { id: "opencode-go/glm-5.3" },
    { id: "qoder-cn/kmodel_latest" },
  ]
  expect(filterModels(raws, "KIMI").map((m) => m.id)).toEqual(["opencode-go/kimi-k3"])
  // A single string is a one-pattern filter; a vendor prefix keeps the whole vendor.
  expect(filterModels(raws, "opencode-go/").map((m) => m.id)).toEqual(["opencode-go/kimi-k3", "opencode-go/glm-5.3"])
  expect(filterModels(raws, "Kmodel").map((m) => m.id)).toEqual(["qoder-cn/kmodel_latest"])
})

test("modelFilter includes are OR-ed", () => {
  const raws = [{ id: "a/kimi-k3" }, { id: "a/glm-5.3" }, { id: "a/qwen3.8-max" }]
  expect(filterModels(raws, ["kimi", "glm"]).map((m) => m.id)).toEqual(["a/kimi-k3", "a/glm-5.3"])
})

test("a leading ! excludes; excludes alone start from the full list", () => {
  const raws = [{ id: "zen/beam-free" }, { id: "zen/glm-5.3-flash-free" }, { id: "go/glm-5.3" }]
  expect(filterModels(raws, ["!free"]).map((m) => m.id)).toEqual(["go/glm-5.3"])
})

test("includes narrow first, then excludes win regardless of array order", () => {
  const raws = [{ id: "go/claude-sonnet-5-5" }, { id: "go/claude-haiku-5-5" }, { id: "go/kimi-k3" }]
  const expected = ["go/claude-sonnet-5-5"]
  expect(filterModels(raws, ["claude", "!haiku"]).map((m) => m.id)).toEqual(expected)
  expect(filterModels(raws, ["!haiku", "claude"]).map((m) => m.id)).toEqual(expected)
})

test("empty and non-string filter entries are no-ops; patterns are trimmed", () => {
  const raws = [{ id: "a/kimi-k3" }, { id: "a/glm-5.3" }]
  for (const filter of [undefined, null, "", "!", "   ", [], ["", "!"], [3, {}, null], 42]) {
    expect(filterModels(raws, filter)).toHaveLength(2)
  }
  expect(filterModels(raws, "  kimi  ").map((m) => m.id)).toEqual(["a/kimi-k3"])
})

test("modelFilter that excludes everything yields an empty list", () => {
  expect(filterModels([{ id: "a/kimi-k3" }], ["!kimi"])).toEqual([])
  expect(filterModels([{ id: "a/kimi-k3" }], "nope")).toEqual([])
})
