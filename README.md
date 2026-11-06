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
        "baseURL": "http://127.0.0.1:3425/v1",
        "keyFile": "~/.secrets/magpie-key", // file holding a Magpie gateway key
        // optional: "id" (default "magpie"), "name" (default "Magpie"),
        // "refreshMinutes" (default 60),
        // "modelFilter": ["claude", "!claude-haiku"], // keep ids with "claude", drop "claude-haiku"
      },
    },
  ],
}
```

`modelFilter` narrows which models get registered. An entry is a case-insensitive substring of the raw
`vendor/model` id, so `"opencode-go/"` keeps a whole vendor. Entries include by default; one starting
with `!` excludes. Includes narrow the list first and exclusions always win, whatever the array order:
`["claude", "!claude-haiku"]` is "claude, but not haiku". Unset, `""`, `"!"` and non-string entries
filter nothing. The cache keeps the full upstream list, so changing the filter takes effect without a
refetch. A filter that keeps no models still registers the provider, with no models and an error in
the log.

`opencode plugin check` / `plugin update` cannot update a git entry: OpenCode re-specs it as
`github:owner/repo@<version>`, so npm reads the part after `@` as the repository path and asks for
`ssh://git@github.com/null/<version>.git`, which reports "repository not found" — surfacing as
`NpmInstallFailedError (cause: Error: An unknown git error occurred)`.

A ref in the spec (`github:owner/repo#<tag>`) is installed once into its own cache directory, so pin
the version there and change it by hand; an unpinned entry keeps the first copy it downloaded from the
default branch. Where the fetch has to be dependable, use a published npm version or a local checkout
instead.

OpenCode picks up a changed entry by itself (or run `opencode service restart`). Models appear as
`<id>/<provider>/<model>`, e.g. `magpie-test/claude/claude-sonnet-5-5#high`.

### Without a config entry

A plugin discovered through `.opencode/plugins/` gets no options, so `setup` falls back to
environment variables: `MAGPIE_BASE_URL` (default `http://127.0.0.1:3425/v1`) and `MAGPIE_KEY_FILE`
(default: the literal key `magpie`). Other options keep their defaults (`id` "magpie",
`refreshMinutes` 60, `modelFilter` unset — no filtering; it has no environment equivalent).

Requires OpenCode 2.x whose bundled `@opencode/plugin` is ≥ 2.1.2: the host resolves that import for
plugins at runtime, so this package installs with no dependencies of its own (`@opencode/plugin` is a
devDependency for types and tests only). Tested with OpenCode 2.2.5.

## Develop

To run a local checkout instead, use the folder's absolute path as `package`. OpenCode loads the
folder's root `index.ts`.

A local checkout and an installed copy both register a provider, and `opencode plugin list` shows the
plugin id twice. To look at one source only, give the CLI a private instance with its own config dir
and no shared service:

```jsonc
// %TEMP%\magpie-dev\opencode.json  (or ~/.cache/magpie-dev on unix)
{
  "plugins": [
    {
      "package": "F:/code/opencode-magpie-models",
      "options": { "id": "magpie", "name": "Magpie", "baseURL": "http://127.0.0.1:3425/v1" },
    },
  ],
}
```

```sh
export OPENCODE_CONFIG_DIR=/tmp/magpie-dev   # replaces ~/.config/opencode entirely
cd /tmp && opencode models --standalone | grep '^magpie/'
```

`--standalone` matters: without it the CLI answers from the already-running service, which keeps the
plugins from whichever config it booted with, so a stale copy looks like your edit did nothing. The
provider id can be the production one here because the installed entry is not loaded at all.

```sh
npm install
bun test
```

## License

MIT
