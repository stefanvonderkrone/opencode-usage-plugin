# opencode-usage-plugin

An [opencode](https://opencode.ai) TUI plugin. It shows a usage line at the bottom of the
TUI with the current usage-limit percentages for your OpenAI, Anthropic, and Cursor
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

The plugin reads the OAuth tokens opencode already stores in
`~/.local/share/opencode/auth.json` and polls each provider's usage API once per minute:

| Provider  | Endpoint                                        |
| --------- | ----------------------------------------------- |
| Anthropic | `api.anthropic.com/api/oauth/usage`             |
| OpenAI    | `chatgpt.com/backend-api/wham/usage`            |
| Cursor    | `cursor.com/api/usage-summary`                  |

These endpoints are not documented publicly and can change without notice. The plugin
only reads the token file. It never refreshes or writes tokens.

## Install

opencode TUI plugins are registered in `tui.json`, either globally in
`~/.config/opencode/tui.json` or per project in `.opencode/tui.json`.

### From GitHub

```json
{
  "plugin": ["github:stefankronecke/opencode-usage-plugin"]
}
```

### From a local checkout

```json
{
  "plugin": ["/path/to/opencode-usage-plugin"]
}
```

Restart opencode after changing `tui.json`.

## Requirements

- You are logged in with OAuth (`opencode auth login`) for the providers you want to see.
  API-key credentials carry no usage-limit information and are skipped.
- opencode with TUI plugin support (`exports["./tui"]` loading).

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
