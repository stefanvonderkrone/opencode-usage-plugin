// @bun
// src/tui.tsx
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createSignal, For, Show } from "solid-js";

// src/usage.ts
async function readAuth() {
  const child = Bun.spawn(["opencode", "auth", "export"], { stdout: "pipe", stderr: "inherit" });
  const data = await new Response(child.stdout).json();
  if (await child.exited !== 0 || !Array.isArray(data))
    throw new Error("Cannot read OpenCode credentials");
  return Object.fromEntries(data.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !("active" in entry) || entry.active !== true || !("integrationID" in entry) || typeof entry.integrationID !== "string" || !("value" in entry))
      return [];
    const value = entry.value;
    if (!value || typeof value !== "object" || !("type" in value) || value.type !== "oauth" || !("access" in value) || typeof value.access !== "string")
      return [];
    const metadata = "metadata" in value ? value.metadata : undefined;
    const accountId = metadata && typeof metadata === "object" && "accountID" in metadata ? metadata.accountID : undefined;
    return [[entry.integrationID, {
      type: "oauth",
      access: value.access,
      expires: "expires" in value && typeof value.expires === "number" ? value.expires : undefined,
      accountId: typeof accountId === "string" ? accountId : undefined
    }]];
  }));
}
function oauthEntry(auth, provider) {
  const entry = auth[provider];
  if (!entry || entry.type !== "oauth" || !entry.access)
    return;
  return entry;
}
function expired(entry) {
  return typeof entry.expires === "number" && entry.expires > 0 && entry.expires < Date.now();
}
function pct(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return;
  return Math.min(100, Math.max(0, Math.round(value)));
}
async function fetchJson(url, headers, signal) {
  const response = await fetch(url, { headers, signal });
  if (!response.ok)
    throw new Error(`http ${response.status}`);
  return response.json();
}
async function fetchAnthropic(auth, signal) {
  const entry = oauthEntry(auth, "anthropic");
  if (!entry)
    return;
  if (expired(entry))
    return { name: "anthropic", windows: [], error: "auth" };
  const data = await fetchJson("https://api.anthropic.com/api/oauth/usage", {
    Authorization: `Bearer ${entry.access}`,
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "claude-code/2.1.72",
    Accept: "application/json"
  }, signal);
  const windows = [];
  const fiveHour = pct(data.five_hour?.utilization);
  if (fiveHour !== undefined)
    windows.push({ label: "5h", pct: fiveHour });
  const sevenDay = pct(data.seven_day?.utilization);
  if (sevenDay !== undefined)
    windows.push({ label: "wk", pct: sevenDay });
  const extra = data.extra_usage;
  const monthly = pct(extra?.utilization);
  if (extra?.is_enabled && monthly !== undefined)
    windows.push({ label: "mo", pct: monthly });
  return { name: "anthropic", windows };
}
function openaiLabel(windowSeconds) {
  if (typeof windowSeconds !== "number")
    return "5h";
  if (windowSeconds <= 6 * 3600)
    return "5h";
  if (windowSeconds <= 8 * 86400)
    return "wk";
  return "mo";
}
async function fetchOpenai(auth, signal) {
  const entry = oauthEntry(auth, "openai");
  if (!entry)
    return;
  if (expired(entry))
    return { name: "openai", windows: [], error: "auth" };
  const headers = {
    Authorization: `Bearer ${entry.access}`,
    Accept: "application/json"
  };
  if (entry.accountId)
    headers["ChatGPT-Account-Id"] = entry.accountId;
  const data = await fetchJson("https://chatgpt.com/backend-api/wham/usage", headers, signal);
  const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].flatMap((window) => {
    const used = pct(window?.used_percent);
    if (used === undefined)
      return [];
    return [{ label: openaiLabel(window.limit_window_seconds), pct: used }];
  });
  const spend = pct(data.spend_control?.individual_limit?.used_percent);
  if (spend !== undefined)
    windows.push({ label: "mo", pct: spend });
  return { name: "openai", windows };
}
function cursorUserId(access) {
  const payload = access.split(".")[1];
  if (!payload)
    return;
  try {
    const sub = JSON.parse(Buffer.from(payload, "base64url").toString()).sub;
    if (typeof sub !== "string" || !sub)
      return;
    const parts = sub.split("|");
    return parts[parts.length - 1];
  } catch {
    return;
  }
}
async function fetchCursor(auth, signal) {
  const entry = oauthEntry(auth, "cursor");
  if (!entry)
    return;
  if (expired(entry))
    return { name: "cursor", windows: [], error: "auth" };
  const userId = cursorUserId(entry.access);
  if (!userId)
    return { name: "cursor", windows: [], error: "token" };
  const data = await fetchJson("https://cursor.com/api/usage-summary", { Cookie: `WorkosCursorSessionToken=${userId}%3A%3A${entry.access}`, Accept: "application/json" }, signal);
  const plan = data.individualUsage?.plan ?? data.individualUsage?.overall;
  const used = pct(plan?.totalPercentUsed) ?? (typeof plan?.used === "number" && typeof plan?.limit === "number" && plan.limit > 0 ? pct(plan.used / plan.limit * 100) : undefined);
  const windows = used !== undefined ? [{ label: "mo", pct: used }] : [];
  return { name: "cursor", windows };
}
var FETCHERS = [fetchOpenai, fetchAnthropic, fetchCursor];
async function collectUsage(signal, credentials) {
  const auth = credentials ?? await readAuth();
  const names = ["openai", "anthropic", "cursor"];
  const results = await Promise.allSettled(FETCHERS.map((fetcher) => fetcher(auth, signal)));
  return results.flatMap((result, index) => {
    if (result.status === "fulfilled")
      return result.value ? [result.value] : [];
    return [{ name: names[index], windows: [], error: String(result.reason?.message ?? result.reason) }];
  });
}
if (false) {}

// src/tui.tsx
var POLL_INTERVAL = 60000;
var tui_default = Plugin.define({
  id: "opencode-usage-plugin",
  setup(context) {
    const controller = new AbortController;
    const [usage, setUsage] = createSignal([]);
    const last = new Map;
    const poll = async () => {
      const credentials = await context.client.credential.list({
        signal: controller.signal
      });
      const auth = Object.fromEntries(credentials.flatMap((credential) => {
        if (!credential.active || credential.value.type !== "oauth")
          return [];
        const value = credential.value;
        const accountId = value.metadata?.accountID;
        return [[credential.integrationID, {
          type: value.type,
          access: value.access,
          expires: value.expires,
          accountId: typeof accountId === "string" ? accountId : undefined
        }]];
      }));
      const results = await collectUsage(controller.signal, auth);
      if (controller.signal.aborted)
        return;
      for (const provider of results) {
        const previous = last.get(provider.name);
        if (provider.error && previous && previous.windows.length > 0)
          continue;
        last.set(provider.name, provider);
      }
      setUsage([...last.values()]);
    };
    const refresh = () => poll().catch((error) => {
      if (controller.signal.aborted)
        return;
      context.ui.toast.show({
        message: `Usage: ${String(error)}`,
        variant: "warning"
      });
    });
    refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL);
    const Usage = () => {
      const color = (pct2) => {
        if (pct2 >= 90)
          return context.theme.text.feedback.error.base;
        if (pct2 >= 70)
          return context.theme.text.feedback.warning.base;
        return context.theme.text.base;
      };
      return _$createComponent(Show, {
        get when() {
          return usage().length > 0;
        },
        get children() {
          var _el$ = _$createElement("box"), _el$2 = _$createElement("text");
          _$insertNode(_el$, _el$2);
          _$setProp(_el$, "width", "100%");
          _$setProp(_el$, "flexShrink", 0);
          _$setProp(_el$, "paddingLeft", 2);
          _$setProp(_el$, "paddingRight", 2);
          _$insert(_el$2, _$createComponent(For, {
            get each() {
              return usage();
            },
            children: (provider, index) => [_$memo(() => index() > 0 ? "  \xB7  " : ""), _$memo(() => provider.name), " ", _$createComponent(Show, {
              get when() {
                return provider.windows.length > 0;
              },
              get fallback() {
                return (() => {
                  var _el$3 = _$createElement("span");
                  _$insertNode(_el$3, _$createTextNode(`!`));
                  _$effect((_$p) => _$setProp(_el$3, "style", {
                    fg: context.theme.text.feedback.warning.base
                  }, _$p));
                  return _el$3;
                })();
              },
              get children() {
                return _$createComponent(For, {
                  get each() {
                    return provider.windows;
                  },
                  children: (window, windowIndex) => [_$memo(() => windowIndex() > 0 ? " " : ""), _$memo(() => window.label), " ", (() => {
                    var _el$5 = _$createElement("span"), _el$6 = _$createTextNode(`%`);
                    _$insertNode(_el$5, _el$6);
                    _$insert(_el$5, () => window.pct, _el$6);
                    _$effect((_$p) => _$setProp(_el$5, "style", {
                      fg: color(window.pct)
                    }, _$p));
                    return _el$5;
                  })()]
                });
              }
            })]
          }));
          _$effect((_$p) => _$setProp(_el$2, "fg", context.theme.text.muted, _$p));
          return _el$;
        }
      });
    };
    const stopHome = context.ui.slot({
      after: "home.footer",
      render: Usage
    });
    const stopSession = context.ui.slot({
      after: "prompt.footer",
      render: (input) => _$createComponent(Show, {
        get when() {
          return input.sessionID;
        },
        get children() {
          return _$createComponent(Usage, {});
        }
      })
    });
    return () => {
      controller.abort();
      clearInterval(timer);
      stopHome();
      stopSession();
    };
  }
});
export {
  tui_default as default
};
