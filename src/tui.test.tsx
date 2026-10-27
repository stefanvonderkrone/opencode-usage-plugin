/** @jsxImportSource @opentui/solid */
import { expect, spyOn, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import type { JSX } from "solid-js"
import plugin from "./tui"

test("usage owns one bottom row outside the prompt footer", async () => {
  const slots: { append?: string; after?: string; render: () => JSX.Element }[] = []
  const color = RGBA.fromInts(200, 200, 200)
  const context = {
    client: { credential: { list: async () => [{
      active: true, integrationID: "anthropic", value: { type: "oauth", access: "test" },
    }] } },
    theme: { text: { base: color, muted: color, feedback: { error: { base: color }, warning: { base: color } } } },
    ui: {
      slot: (input: typeof slots[number]) => { slots.push(input); return () => {} },
      toast: { show: () => {} },
    },
  } as unknown as Context
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ five_hour: { utilization: 12 } }))
  const stop = await plugin.setup(context)
  let app: Awaited<ReturnType<typeof testRender>> | undefined
  try {
    await Bun.sleep(0)
    expect(slots.map(({ append, after }) => append ?? after)).toEqual(["app"])
    app = await testRender(() => (
      <box height={8} flexDirection="column">
        <box flexGrow={1}><text>Session</text></box>
        <text>Prompt footer</text>
        {slots[0]!.render()}
      </box>
    ), { width: 80, height: 8 })
    await app.renderOnce()
    const lines = app.captureCharFrame().split("\n")
    expect(lines[6]).toContain("Prompt footer")
    expect(lines[7]).toContain("anthropic 5h 12%")
  } finally {
    if (typeof stop === "function") stop()
    app?.renderer.destroy()
    fetchMock.mockRestore()
  }
})
