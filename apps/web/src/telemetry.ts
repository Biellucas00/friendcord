import { API_URL } from "./api";

let lastFingerprint = "";
let lastSentAt = 0;

function safeText(value: unknown) {
  return String(value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : value).replace(/(authorization|cookie|password|senha|token|secret|credential)[^\s,;]*/gi, "$1=[redacted]").slice(0, 3500);
}

export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  const message = safeText(error);
  const fingerprint = `${message.slice(0, 250)}:${context.area ?? "client"}`;
  const now = Date.now();
  if (fingerprint === lastFingerprint && now - lastSentAt < 60_000) return;
  lastFingerprint = fingerprint;
  lastSentAt = now;
  const safeContext = Object.fromEntries(Object.entries(context).filter(([key]) => !/(password|senha|token|secret|credential)/i.test(key)).map(([key, value]) => [key, safeText(value)]));
  void fetch(`${API_URL}/api/telemetry/client`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, context: safeContext, url: location.pathname, userAgent: navigator.userAgent }), keepalive: true }).catch(() => undefined);
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", (event) => reportClientError(event.error ?? event.message, { area: "window.error", file: event.filename, line: event.lineno }));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, { area: "unhandledrejection" }));
}
