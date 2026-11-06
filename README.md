# opencode-magpie-models

[OpenCode](https://opencode.ai) V2 plugin for a [Magpie](https://usemagpie.ai) gateway: registers a
provider whose models come from Magpie's `/v1/models`, so no model list has to be written into
`opencode.jsonc` or kept up to date by hand.

Each model gets Magpie's label, context and output limits, input types (text, image, pdf, …) and
reasoning levels (low … max, as OpenCode variants, plus a `priority` service-tier `-fast` variant
for each level). Prices from Magpie (`pricing`, USD per token) are mapped to OpenCode's per-million
`cost`, and `tool_call` to `capabilities.tools`. The list is read when OpenCode starts and again
every hour. If Magpie can't be reached, the last list saved in
`$XDG_CACHE_HOME/opencode-magpie-models/<id>.json` is used.

**This package is distributed via GitHub only** — it is not published to npm.

## Install

Add it to `opencode.json(c)` by its Git URL (and remove any hand-written provider with the same id):

```jsonc
{
  "plugins": [
    {
      "package": "github:DWin233/opencode-magpie-models",
      "options": {
        "baseURL": "http://127.0.0.1:8790/v1",
        "keyFile": "~/.secrets/magpie-key", // file holding a Magpie gateway key
        // optional: "id" (default "magpie-test" while in testing, "magpie" at release),
        // "name" (default "Magpie")
      },
    },
  ],
}
```

Pin a tag or commit hash (`github:DWin233/opencode-magpie-models#v0.2.0` or `#<full-sha>`): OpenCode
keeps the first copy it downloads for an unpinned name, so a new release reaches it only when the
pinned ref changes. Update by bumping the pinned ref.

OpenCode picks up the change by itself (or run `opencode service restart`). Models appear as
`<id>/<provider>/<model>`, e.g. `magpie-test/claude/claude-sonnet-5-5#high`.

### Without a config entry

A plugin discovered through `.opencode/plugins/` gets no options, so `setup` falls back to
environment variables: `MAGPIE_BASE_URL` (default `http://127.0.0.1:8790/v1`) and `MAGPIE_KEY_FILE`
(default: the literal key `magpie`). The provider id then defaults to `magpie-test`.

Tested with OpenCode 2.2.5.

## Develop

To run a local checkout instead, use the folder's absolute path as `package`. OpenCode loads the
folder's root `index.ts`.

```sh
npm install
bun test
```

## License

MIT
