# opencode-usage-plugin

An [OpenCode](https://opencode.ai) v2 CLI plugin. It shows a separate usage row at the bottom of the TUI.
The line shows usage-limit percentages for your OpenAI, Anthropic, and Cursor
accounts:

```
openai 5h 12% wk 34%  ·  anthropic 5h 8% wk 41%  ·  cursor mo 63%
```

- `5h`, `wk`, `mo` are the rolling 5-hour, weekly, and monthly windows. The plugin shows
  the windows each provider reports, so subscription and enterprise plans both work.
- Percentages turn yellow at 70% and red at 90%.
- The plugin keeps the last good percentages after a failed request and marks them `(stale)`.
- Without a good result, the row shows `rate limited`, `auth required`, or `usage unavailable`.
  Providers without stored OAuth credentials are hidden.

## How it works

The plugin reads active OAuth credentials through the connected V2 server's credential API.
It polls OpenAI and Cursor once per minute and Anthropic once per five minutes.
After errors, each provider retries with a delay from five minutes to one hour.
The plugin also respects longer `Retry-After` delays. Requests time out after ten seconds.

| Provider  | Endpoint                                        |
| --------- | ----------------------------------------------- |
| Anthropic | `api.anthropic.com/api/oauth/usage`             |
| OpenAI    | `chatgpt.com/backend-api/wham/usage`            |
| Cursor    | `cursor.com/api/usage-summary`                  |

These endpoints are not documented publicly and can change without notice. The plugin
never refreshes or writes tokens.

New OpenAI direct-use ChatGPT plan tokens cannot access the legacy usage endpoint.
For these tokens, the row shows `openai usage unavailable` without repeated requests.
Check [ChatGPT Settings > Usage](https://chatgpt.com/settings/usage) for usage instead.
OpenAI documents this limit in its [ChatGPT plan token guide](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

### OpenAI sign-in for usage percentages

Use OpenCode's built-in `Codex browser (legacy)` method to get a token that can read usage percentages:

```sh
opencode auth login openai --method chatgpt-browser
```

Select your ChatGPT account in the browser. This sign-in becomes the active OpenAI credential.
The `Sign in with ChatGPT` method uses a different token type that cannot read this usage endpoint.
You do not need the Codex CLI or the V1 `opencode-openai-codex-auth` plugin.

For a separate personal instance, set both data and state directories in its shell:

```sh
export XDG_DATA_HOME="$HOME/.local/opencode-personal"
export XDG_STATE_HOME="$HOME/.local/state/opencode-personal"
opencode auth login openai --method chatgpt-browser
```

Use these variables for every personal OpenCode command, including the TUI.
`XDG_DATA_HOME` selects its database. `XDG_STATE_HOME` selects its background service registration.
Setting only `XDG_DATA_HOME` can connect a client to the company instance's server.
Alternatively, use `--standalone` with the personal `XDG_DATA_HOME` for each command.

#### OpenAI models missing after a sign-in change

Compare the shared server's model list with a fresh standalone server:

```sh
opencode models | grep '^openai/'
opencode models --standalone | grep '^openai/'
```

If only the standalone server lists OpenAI models, the shared server has stale state.
Restart the affected background service when you can interrupt active work:

```sh
opencode service restart
opencode service status
```

For your personal instance, run these commands in the shell with both personal XDG variables set.
Do not sign in again just to fix a stale model list.

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

Use `/reload` in OpenCode after the installation.

## Requirements

- You are logged in with OAuth (`opencode auth login`) for the providers you want to see.
  API-key credentials carry no usage-limit information and are skipped.
- OpenCode v2.1.4 or later with the V2 CLI plugin API.

## Development

```sh
bun install
bun run check   # typecheck
bun run test    # provider and TUI regression tests
bun run build   # compile src/tui.tsx -> dist/tui.js (committed)
bun run usage   # print the usage line once, without the TUI
```

`dist/tui.js` is committed because opencode installs GitHub plugins with scripts
disabled; there is no build step at install time. Rebuild and commit `dist` after
changing `src`.

The `usage` command reads current credentials through `opencode auth export`.
The root `tui.js` file loads the compiled plugin for local-directory installations.
Package installations use the `./tui` export.
