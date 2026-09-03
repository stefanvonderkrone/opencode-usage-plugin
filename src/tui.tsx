/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import { collectUsage, type ProviderUsage } from "./usage"

const POLL_INTERVAL = 60_000

const tui: TuiPlugin = async (api) => {
  const [usage, setUsage] = createSignal<ProviderUsage[]>([])
  const last = new Map<string, ProviderUsage>()

  const poll = async () => {
    const results = await collectUsage(api.lifecycle.signal)
    for (const provider of results) {
      const previous = last.get(provider.name)
      // Stale-while-error: keep the last good value when a poll fails.
      if (provider.error && previous && previous.windows.length > 0) continue
      last.set(provider.name, provider)
    }
    setUsage([...last.values()])
  }

  void poll()
  const timer = setInterval(() => void poll(), POLL_INTERVAL)
  api.lifecycle.onDispose(() => clearInterval(timer))

  api.slots.register({
    order: 100,
    slots: {
      app_bottom(ctx) {
        const theme = () => ctx.theme.current
        const color = (pct: number) => {
          if (pct >= 90) return theme().error
          if (pct >= 70) return theme().warning
          return theme().text
        }
        return (
          <Show when={usage().length > 0}>
            <box width="100%" flexShrink={0} paddingLeft={2} paddingRight={2}>
              <text fg={theme().textMuted}>
                <For each={usage()}>
                  {(provider, index) => (
                    <>
                      {index() > 0 ? "  ·  " : ""}
                      {provider.name}{" "}
                      <Show when={provider.windows.length > 0} fallback={<span style={{ fg: theme().warning }}>!</span>}>
                        <For each={provider.windows}>
                          {(window, windowIndex) => (
                            <>
                              {windowIndex() > 0 ? " " : ""}
                              {window.label} <span style={{ fg: color(window.pct) }}>{window.pct}%</span>
                            </>
                          )}
                        </For>
                      </Show>
                    </>
                  )}
                </For>
              </text>
            </box>
          </Show>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-usage-plugin",
  tui,
}

export default plugin
