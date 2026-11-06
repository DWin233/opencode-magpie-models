import { expect, test } from "bun:test"
import { parseList, toModels } from "./index"

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
  expect(m.cost).toEqual([{ input: 2, output: 0, cache: { read: 0.0000002 * 1e6, write: 0 } }])
})

test("leaves cost off a model without pricing", () => {
  const [m] = toModels("magpie-test", [{ id: "free" }])
  expect("cost" in m).toBe(false)
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
