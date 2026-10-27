/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import { createUsageCollector, usageStatus, type ProviderUsage } from "./usage"

const POLL_INTERVAL = 60_000

export default Plugin.define({
  id: "opencode-usage-plugin",
  setup(context) {
    const controller = new AbortController()
    const [usage, setUsage] = createSignal<ProviderUsage[]>([])
    const collectUsage = createUsageCollector()

    const poll = async () => {
      const credentials = await context.client.credential.list({
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      })
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
      setUsage(results)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        await poll()
      } catch {
        if (!controller.signal.aborted) {
          context.ui.toast.show({ message: "Usage: cannot read credentials", variant: "warning" })
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), POLL_INTERVAL)
      }
    }
    void refresh()

    const Usage = () => {
      const color = (pct: number) => {
        if (pct >= 90) return context.theme.text.feedback.error.base
        if (pct >= 70) return context.theme.text.feedback.warning.base
        return context.theme.text.base
      }
      return (
        <Show when={usage().length > 0}>
          <box width="100%" height={1} flexShrink={0} paddingLeft={2} paddingRight={2}>
            <text fg={context.theme.text.muted} wrapMode="none" truncate>
              <For each={usage()}>
                {(provider, index) => (
                  <>
                    {index() > 0 ? "  ·  " : ""}
                    {provider.name}{" "}
                    <Show
                      when={provider.windows.length > 0}
                      fallback={<span style={{ fg: context.theme.text.feedback.warning.base }}>{usageStatus(provider)}</span>}
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
                    {provider.stale ? " (stale)" : ""}
                  </>
                )}
              </For>
            </text>
          </box>
        </Show>
      )
    }
    const stopUsage = context.ui.slot({ append: "app", render: Usage })
    return () => {
      controller.abort()
      clearTimeout(timer)
      stopUsage()
    }
  },
})
