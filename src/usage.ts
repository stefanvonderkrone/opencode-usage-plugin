export type UsageWindow = {
  label: "5h" | "wk" | "mo"
  pct: number
}

export type ProviderUsage = {
  name: string
  windows: UsageWindow[]
  error?: string
}

type OauthEntry = {
  type: string
  access?: string
  expires?: number
  accountId?: string
}

async function readAuth(): Promise<Record<string, OauthEntry>> {
  const child = Bun.spawn(["opencode", "auth", "export"], { stdout: "pipe", stderr: "inherit" })
  const data: unknown = await new Response(child.stdout).json()
  if (await child.exited !== 0 || !Array.isArray(data)) throw new Error("Cannot read OpenCode credentials")
  return Object.fromEntries(data.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("active" in entry) || entry.active !== true ||
        !("integrationID" in entry) || typeof entry.integrationID !== "string" || !("value" in entry)) return []
    const value = entry.value
    if (!value || typeof value !== "object" || !("type" in value) || value.type !== "oauth" ||
        !("access" in value) || typeof value.access !== "string") return []
    const metadata = "metadata" in value ? value.metadata : undefined
    const accountId = metadata && typeof metadata === "object" && "accountID" in metadata ? metadata.accountID : undefined
    return [[entry.integrationID, {
      type: "oauth",
      access: value.access,
      expires: "expires" in value && typeof value.expires === "number" ? value.expires : undefined,
      accountId: typeof accountId === "string" ? accountId : undefined,
    }]]
  }))
}

function oauthEntry(auth: Record<string, OauthEntry>, provider: string) {
  const entry = auth[provider]
  if (!entry || entry.type !== "oauth" || !entry.access) return undefined
  return entry
}

function expired(entry: OauthEntry) {
  return typeof entry.expires === "number" && entry.expires > 0 && entry.expires < Date.now()
}

function pct(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(100, Math.max(0, Math.round(value)))
}

async function fetchJson(url: string, headers: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(url, { headers, signal })
  if (!response.ok) throw new Error(`http ${response.status}`)
  return response.json() as Promise<Record<string, any>>
}

async function fetchAnthropic(auth: Record<string, OauthEntry>, signal?: AbortSignal) {
  const entry = oauthEntry(auth, "anthropic")
  if (!entry) return undefined
  if (expired(entry)) return { name: "anthropic", windows: [], error: "auth" } satisfies ProviderUsage
  const data = await fetchJson(
    "https://api.anthropic.com/api/oauth/usage",
    {
      Authorization: `Bearer ${entry.access}`,
      "anthropic-beta": "oauth-2025-04-20",
      // Bare user agents hit a much stricter rate-limit bucket on this endpoint.
      "User-Agent": "claude-code/2.1.72",
      Accept: "application/json",
    },
    signal,
  )
  const windows: UsageWindow[] = []
  const fiveHour = pct(data.five_hour?.utilization)
  if (fiveHour !== undefined) windows.push({ label: "5h", pct: fiveHour })
  const sevenDay = pct(data.seven_day?.utilization)
  if (sevenDay !== undefined) windows.push({ label: "wk", pct: sevenDay })
  const extra = data.extra_usage
  const monthly = pct(extra?.utilization)
  if (extra?.is_enabled && monthly !== undefined) windows.push({ label: "mo", pct: monthly })
  return { name: "anthropic", windows } satisfies ProviderUsage
}

function openaiLabel(windowSeconds: unknown): UsageWindow["label"] {
  if (typeof windowSeconds !== "number") return "5h"
  if (windowSeconds <= 6 * 3600) return "5h"
  if (windowSeconds <= 8 * 86400) return "wk"
  return "mo"
}

async function fetchOpenai(auth: Record<string, OauthEntry>, signal?: AbortSignal) {
  const entry = oauthEntry(auth, "openai")
  if (!entry) return undefined
  if (expired(entry)) return { name: "openai", windows: [], error: "auth" } satisfies ProviderUsage
  const headers: Record<string, string> = {
    Authorization: `Bearer ${entry.access}`,
    Accept: "application/json",
  }
  if (entry.accountId) headers["ChatGPT-Account-Id"] = entry.accountId
  const data = await fetchJson("https://chatgpt.com/backend-api/wham/usage", headers, signal)
  const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].flatMap((window) => {
    const used = pct(window?.used_percent)
    if (used === undefined) return []
    return [{ label: openaiLabel(window.limit_window_seconds), pct: used } satisfies UsageWindow]
  })
  // Business/enterprise workspaces report a monthly spend limit instead of
  // rolling rate-limit windows.
  const spend = pct(data.spend_control?.individual_limit?.used_percent)
  if (spend !== undefined) windows.push({ label: "mo", pct: spend })
  return { name: "openai", windows } satisfies ProviderUsage
}

// The cursor.com web endpoints authenticate with a session cookie of the form
// `<workos user id>::<jwt>`; the user id is the JWT `sub` claim without its
// `provider|` prefix.
function cursorUserId(access: string) {
  const payload = access.split(".")[1]
  if (!payload) return undefined
  try {
    const sub = JSON.parse(Buffer.from(payload, "base64url").toString()).sub
    if (typeof sub !== "string" || !sub) return undefined
    const parts = sub.split("|")
    return parts[parts.length - 1]
  } catch {
    return undefined
  }
}

async function fetchCursor(auth: Record<string, OauthEntry>, signal?: AbortSignal) {
  const entry = oauthEntry(auth, "cursor")
  if (!entry) return undefined
  if (expired(entry)) return { name: "cursor", windows: [], error: "auth" } satisfies ProviderUsage
  const userId = cursorUserId(entry.access!)
  if (!userId) return { name: "cursor", windows: [], error: "token" } satisfies ProviderUsage
  const data = await fetchJson(
    "https://cursor.com/api/usage-summary",
    { Cookie: `WorkosCursorSessionToken=${userId}%3A%3A${entry.access}`, Accept: "application/json" },
    signal,
  )
  // Pro plans report `plan` with percentages; enterprise accounts report
  // `overall` with raw used/limit counters.
  const plan = data.individualUsage?.plan ?? data.individualUsage?.overall
  const used =
    pct(plan?.totalPercentUsed) ??
    (typeof plan?.used === "number" && typeof plan?.limit === "number" && plan.limit > 0
      ? pct((plan.used / plan.limit) * 100)
      : undefined)
  const windows: UsageWindow[] = used !== undefined ? [{ label: "mo", pct: used }] : []
  return { name: "cursor", windows } satisfies ProviderUsage
}

const FETCHERS = [fetchOpenai, fetchAnthropic, fetchCursor]

/** Fetch usage for all configured providers. Never throws; failures become `error` entries. */
export async function collectUsage(signal?: AbortSignal, credentials?: Record<string, OauthEntry>): Promise<ProviderUsage[]> {
  const auth = credentials ?? await readAuth()
  const names = ["openai", "anthropic", "cursor"]
  const results = await Promise.allSettled(FETCHERS.map((fetcher) => fetcher(auth, signal)))
  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value ? [result.value] : []
    return [{ name: names[index], windows: [], error: String(result.reason?.message ?? result.reason) }]
  })
}

export function formatUsage(usage: ProviderUsage[]) {
  return usage
    .map((provider) => {
      if (provider.windows.length === 0) return `${provider.name} !`
      return `${provider.name} ${provider.windows.map((window) => `${window.label} ${window.pct}%`).join(" ")}`
    })
    .join("  ·  ")
}

if (import.meta.main) {
  const usage = await collectUsage()
  for (const provider of usage) {
    if (provider.error) console.error(`${provider.name}: ${provider.error}`)
  }
  console.log(formatUsage(usage))
}
