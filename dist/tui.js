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
import { createSignal, For, Show } from "solid-js";

// src/usage.ts
import os from "os";
import path from "path";
var AUTH_PATH = path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode", "auth.json");
async function readAuth() {
  return Bun.file(AUTH_PATH).json().catch(() => ({}));
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
async function collectUsage(signal) {
  const auth = await readAuth();
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
var tui = async (api) => {
  const [usage, setUsage] = createSignal([]);
  const last = new Map;
  const poll = async () => {
    const results = await collectUsage(api.lifecycle.signal);
    for (const provider of results) {
      const previous = last.get(provider.name);
      if (provider.error && previous && previous.windows.length > 0)
        continue;
      last.set(provider.name, provider);
    }
    setUsage([...last.values()]);
  };
  poll();
  const timer = setInterval(() => void poll(), POLL_INTERVAL);
  api.lifecycle.onDispose(() => clearInterval(timer));
  api.slots.register({
    order: 100,
    slots: {
      app_bottom(ctx) {
        const theme = () => ctx.theme.current;
        const color = (pct2) => {
          if (pct2 >= 90)
            return theme().error;
          if (pct2 >= 70)
            return theme().warning;
          return theme().text;
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
                      fg: theme().warning
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
            _$effect((_$p) => _$setProp(_el$2, "fg", theme().textMuted, _$p));
            return _el$;
          }
        });
      }
    }
  });
};
var plugin = {
  id: "opencode-usage-plugin",
  tui
};
var tui_default = plugin;
export {
  tui_default as default
};
