import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Model, Plugin, Provider } from "@opencode/plugin"

// One entry of Magpie's /v1/models (only the fields used here).
type Raw = {
  id: string
  magpie_label?: string
  display_name?: string
  context_length?: number
  max_output_tokens?: number
  modalities?: { input?: string[]; output?: string[] }
  reasoning?: boolean
  reasoning_levels?: string[]
  // Per-token USD prices, as decimal strings. Free models omit the whole object.
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string }
  tool_call?: boolean
}

// Partial in the same way the upstream pricing is: a missing sub-field is left out entirely.
type ModelCost = { input: number; output: number; cache: { read: number; write: number } }

const positive = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0
const strings = (a: unknown): a is string[] => Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === "string")

// Magpie quotes USD per token; OpenCode's cost is USD per million tokens. The product
// is rounded to 10 decimals to shed the binary tail (1e-7 * 1e6 = 0.09999999999999999,
// the reference snapshots write 0.1).
const perMillion = (v: unknown): number | undefined => {
  if (typeof v !== "string") return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? Number((n * 1e6).toFixed(10)) : undefined
}

const costOf = (pricing: Raw["pricing"]): ModelCost | undefined => {
  if (!pricing) return undefined
  // The wire protocol validates a cost entry strictly: input, output and cache (with
  // cache.read and cache.write) are all required keys. A price Magpie does not report
  // is 0 — the same convention the proxy software's snapshots use.
  return {
    input: perMillion(pricing.prompt) ?? 0,
    output: perMillion(pricing.completion) ?? 0,
    cache: {
      read: perMillion(pricing.input_cache_read) ?? 0,
      write: perMillion(pricing.input_cache_write) ?? 0,
    },
  }
}

export function toModels(providerID: string, raws: readonly Raw[]): Model.Info[] {
  const pid = Provider.ID.make(providerID)
  return raws.map((raw) => {
    // A model without upstream pricing must have no cost field at all, so drop the default empty cost.
    const { cost: _defaultCost, ...base } = Model.Info.default(pid, Model.ID.make(raw.id))
    // some vendors list them upper-case (Zed's Gemini: LOW); Magpie reads any case
    const levels = raw.reasoning && strings(raw.reasoning_levels) ? [...new Set(raw.reasoning_levels.map((l) => l.toLowerCase()))] : []
    // A fast variant for every effort. service_tier is our own convention, not an upstream /v1/models field:
    // Magpie's priority service tier is requested through the OpenAI-compatible body.
    const variants = levels.flatMap((e) => [
      { id: Model.VariantID.make(e), settings: { reasoningEffort: e } },
      {
        id: Model.VariantID.make(`${e}-fast`),
        settings: { reasoningEffort: e, service_tier: "priority", extraBody: { service_tier: "priority" } },
      },
    ])
    const cost = costOf(raw.pricing)
    return {
      ...base,
      name: raw.magpie_label ?? raw.display_name ?? raw.id,      capabilities: {
        ...base.capabilities,
        // Magpie rejects images for a model it marks blind, and OpenCode only sends what is declared
        input: strings(raw.modalities?.input) ? raw.modalities.input : ["text"],
        output: strings(raw.modalities?.output) ? raw.modalities.output : ["text"],
        tools: raw.tool_call === true,
      },
      variants,
      // The wire protocol (GET /api/model) carries cost as an array of tier entries —
      // one entry with no tier is the base price — and the key itself is required on
      // every model, so unpriced models get an empty array. Plain objects only pass
      // config decoding.
      cost: cost ? [cost] : [],
      limit: {
        context: positive(raw.context_length) ? raw.context_length : base.limit.context,
        output: positive(raw.max_output_tokens) ? raw.max_output_tokens : base.limit.output,
      },
    }
  })
}

export function parseList(body: unknown): Raw[] {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new Error("no data array in the models response")
  return data.filter((m): m is Raw => typeof m?.id === "string" && m.id !== "")
}

const home = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p)

export default Plugin.define({
  id: "opencode-magpie-models",
  async setup(ctx) {
    // Options arrive through a config entry ({ package, options } in opencode.json);
    // a directory-discovered plugin gets none and falls back to env, then the
    // upstream defaults.
    const o = (ctx.options ?? {}) as { baseURL?: unknown; keyFile?: unknown; id?: unknown; name?: unknown; refreshMinutes?: unknown }
    const baseURL = (typeof o.baseURL === "string" ? o.baseURL : process.env.MAGPIE_BASE_URL ?? "http://127.0.0.1:8790/v1").replace(/\/+$/, "")
    const keyFile = typeof o.keyFile === "string" ? o.keyFile : process.env.MAGPIE_KEY_FILE || undefined
    const key = keyFile ? (await readFile(home(keyFile), "utf8")).trim() : "magpie"
    const id = typeof o.id === "string" ? o.id : "magpie"
    const name = typeof o.name === "string" ? o.name : "Magpie"
    const cacheFile = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode-magpie-models", `${id}.json`)

    const fetchList = async () => {
      const res = await fetch(`${baseURL}/models`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`GET ${baseURL}/models: HTTP ${res.status}`)
      const list = parseList(await res.json())
      await mkdir(dirname(cacheFile), { recursive: true })
      await writeFile(cacheFile, JSON.stringify(list), { mode: 0o600 })
      return list
    }

    let list: Raw[]
    try {
      list = await fetchList()
    } catch (e) {
      console.error(`opencode-magpie-models: ${e}; using the last saved list`)
      list = await readFile(cacheFile, "utf8").then(JSON.parse, () => [])
    }

    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make(id)),
          name,
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL, apiKey: key },
        },
        models: toModels(id, list),
      })
    })

    // The background service lives for days: pick up models Magpie adds meanwhile.
    const minutes = typeof o.refreshMinutes === "number" && o.refreshMinutes > 0 ? o.refreshMinutes : 60
    const timer = setInterval(async () => {
      try {
        const next = await fetchList()
        if (JSON.stringify(next) === JSON.stringify(list)) return
        list = next
        await ctx.provider.reload()
      } catch (e) {
        console.error(`opencode-magpie-models: refresh failed: ${e}`)
      }
    }, minutes * 60_000)
    return () => clearInterval(timer)
  },
})
