import { afterEach, expect, spyOn, test } from "bun:test"
import * as usage from "./usage"

afterEach(() => {
  fetchMock?.mockRestore()
  clock?.mockRestore()
})

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined
let clock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined
const auth = { anthropic: { type: "oauth", access: "test-token" } }
const good = { five_hour: { utilization: 12 }, seven_day: { utilization: 34 } }

test("direct-use OpenAI tokens do not call an endpoint that rejects them", async () => {
  const claims = Buffer.from(JSON.stringify({ scope: "openid chatgpt.tokens.use.direct" })).toString("base64url")
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }))
  const result = await usage.collectUsage(undefined, { openai: { type: "oauth", access: `header.${claims}.signature` } })
  expect(usage.formatUsage(result)).toBe("openai usage unavailable")
  expect(fetchMock).not.toHaveBeenCalled()
})

test("legacy OpenAI credentials still return percentages", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000 } },
  }))
  const result = await usage.collectUsage(undefined, {
    openai: { type: "oauth", access: "legacy-token", accountId: "account" },
  })
  expect(usage.formatUsage(result)).toBe("openai 5h 42%")
  expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "ChatGPT-Account-Id": "account" })
  expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
})

test("rate limits retain percentages and delay only the affected provider", async () => {
  let now = 1_000_000
  clock = spyOn(Date, "now").mockImplementation(() => now)
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(good))
  const poll = usage.createUsageCollector()
  expect(usage.formatUsage(await poll(undefined, auth))).toBe("anthropic 5h 12% wk 34%")
  now += 300_000
  fetchMock.mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "600" } }))
  expect(usage.formatUsage(await poll(undefined, auth))).toBe("anthropic 5h 12% wk 34% (stale)")
  now += 300_000
  await poll(undefined, auth)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  now += 300_000
  fetchMock.mockResolvedValue(Response.json(good))
  expect(usage.formatUsage(await poll(undefined, auth))).toBe("anthropic 5h 12% wk 34%")
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test("empty responses cannot replace good percentages", async () => {
  let now = 1_000_000
  clock = spyOn(Date, "now").mockImplementation(() => now)
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(good))
  const poll = usage.createUsageCollector()
  await poll(undefined, auth)
  now += 300_000
  fetchMock.mockResolvedValue(Response.json({}))
  expect(usage.formatUsage(await poll(undefined, auth))).toBe("anthropic 5h 12% wk 34% (stale)")
})

test("repeated rate limits increase the retry delay even with Retry-After zero", async () => {
  let now = 1_000_000
  clock = spyOn(Date, "now").mockImplementation(() => now)
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
  const poll = usage.createUsageCollector()
  expect(usage.formatUsage(await poll(undefined, auth))).toBe("anthropic rate limited")
  now += 300_000
  await poll(undefined, auth)
  now += 300_000
  await poll(undefined, auth)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  now += 300_000
  await poll(undefined, auth)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test("credential switches clear cached usage and retry delays", async () => {
  clock = spyOn(Date, "now").mockReturnValue(1_000_000)
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(good))
  const poll = usage.createUsageCollector()
  await poll(undefined, auth)
  fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
  const result = await poll(undefined, { anthropic: { type: "oauth", access: "different-account" } })
  expect(usage.formatUsage(result)).toBe("anthropic auth required")
  expect(await poll(undefined, {})).toEqual([])
})

test("provider backoff does not block another provider", async () => {
  let now = 1_000_000
  clock = spyOn(Date, "now").mockImplementation(() => now)
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (url: Parameters<typeof fetch>[0]) =>
    String(url).includes("anthropic") ? new Response(null, { status: 429 }) : Response.json({
      rate_limit: { primary_window: { used_percent: 42 } },
    }), { preconnect: fetch.preconnect }))
  const poll = usage.createUsageCollector()
  const credentials = { ...auth, openai: { type: "oauth", access: "legacy" } }
  await poll(undefined, credentials)
  now += 60_000
  expect(usage.formatUsage(await poll(undefined, credentials))).toBe("openai 5h 42%  ·  anthropic rate limited")
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
