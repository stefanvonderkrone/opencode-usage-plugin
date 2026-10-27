/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import { collectUsage, type ProviderUsage } from "./usage"

const POLL_INTERVAL = 60_000

export default Plugin.define({
  id: "opencode-usage-plugin",
  setup(context) {
    const controller = new AbortController()
    const [usage, setUsage] = createSignal<ProviderUsage[]>([])
    const last = new Map<string, ProviderUsage>()

    const poll = async () => {
      const credentials = await context.client.credential.list({ signal: controller.signal })
      const auth = Object.fromEntries(credentials.flatMap((credential) => {
        if (!credential.active || credential.value.type !== "oauth") return []
        const value = credential.value
        const accountId = value.metadata?.accountID
        return [[credential.integrationID, {
          type: value.type,
          access: value.access,
          expires: value.expires,
          accountId: typeof accountId === "string" ? accountId : undefined,
        }]]
      }))
      const results = await collectUsage(controller.signal, auth)
      if (controller.signal.aborted) return
      for (const provider of results) {
        const previous = last.get(provider.name)
        // Keep the last good value when a poll fails.
        if (provider.error && previous && previous.windows.length > 0) continue
        last.set(provider.name, provider)
      }
      setUsage([...last.values()])
    }

    const refresh = () => poll().catch((error: unknown) => {
      if (controller.signal.aborted) return
      context.ui.toast.show({ message: `Usage: ${String(error)}`, variant: "warning" })
    })
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL)

    const Usage = () => {
      const color = (pct: number) => {
        if (pct >= 90) return context.theme.text.feedback.error.base
        if (pct >= 70) return context.theme.text.feedback.warning.base
        return context.theme.text.base
      }
      return (
        <Show when={usage().length > 0}>
          <box width="100%" flexShrink={0} paddingLeft={2} paddingRight={2}>
            <text fg={context.theme.text.muted}>
              <For each={usage()}>
                {(provider, index) => (
                  <>
                    {index() > 0 ? "  ·  " : ""}
                    {provider.name}{" "}
                    <Show
                      when={provider.windows.length > 0}
                      fallback={<span style={{ fg: context.theme.text.feedback.warning.base }}>!</span>}
                    >
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
    }
    const stopHome = context.ui.slot({ after: "home.footer", render: Usage })
    const stopSession = context.ui.slot({
      after: "prompt.footer",
      render: (input) => <Show when={input.sessionID}><Usage /></Show>,
    })
    return () => {
      controller.abort()
      clearInterval(timer)
      stopHome()
      stopSession()
    }
  },
})
