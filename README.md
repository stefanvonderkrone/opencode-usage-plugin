# opencode-usage-plugin

An [OpenCode](https://opencode.ai) v2 CLI plugin. It shows a usage line below the home footer and the session prompt.
The line shows usage-limit percentages for your OpenAI, Anthropic, and Cursor
accounts:

```
openai 5h 12% wk 34%  ·  anthropic 5h 8% wk 41%  ·  cursor mo 63%
```

- `5h`, `wk`, `mo` are the rolling 5-hour, weekly, and monthly windows. The plugin shows
  the windows each provider reports, so subscription and enterprise plans both work.
- Percentages turn yellow at 70% and red at 90%.
- A provider that fails to load shows `name !`. Providers without stored credentials are
  hidden.

## How it works

The plugin reads active OAuth credentials through the connected V2 server's credential API.
It polls each provider's usage API once per minute:

| Provider  | Endpoint                                        |
| --------- | ----------------------------------------------- |
| Anthropic | `api.anthropic.com/api/oauth/usage`             |
| OpenAI    | `chatgpt.com/backend-api/wham/usage`            |
| Cursor    | `cursor.com/api/usage-summary`                  |

These endpoints are not documented publicly and can change without notice. The plugin
never refreshes or writes tokens.

## Install

Register the plugin in the global `~/.config/opencode/cli.json` file.

### From GitHub

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["github:stefanvonderkrone/opencode-usage-plugin"]
}
```

### From a local checkout

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/path/to/opencode-usage-plugin"]
}
```

Restart OpenCode after the installation.

## Requirements

- You are logged in with OAuth (`opencode auth login`) for the providers you want to see.
  API-key credentials carry no usage-limit information and are skipped.
- OpenCode v2.1.4 or later with the V2 CLI plugin API.

## Development

```sh
bun install
bun run check   # typecheck
bun run build   # compile src/tui.tsx -> dist/tui.js (committed)
bun run usage   # print the usage line once, without the TUI
```

`dist/tui.js` is committed because opencode installs GitHub plugins with scripts
disabled; there is no build step at install time. Rebuild and commit `dist` after
changing `src`.

The `usage` command reads current credentials through `opencode auth export`.
The root `tui.js` file loads the compiled plugin for local-directory installations.
Package installations use the `./tui` export.
