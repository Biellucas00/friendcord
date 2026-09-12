const secretKeyPattern = /(authorization|cookie|password|senha|token|secret|credential|webhook)/i;
const secretTextPattern = /(authorization|cookie|password|senha|token|secret|credential|webhook)/gi;

function sanitize(value: unknown): string {
  const text = value instanceof Error ? value.name + ": " + value.message + "\n" + (value.stack ?? "") : String(value);
  return text.replace(secretTextPattern, "[redacted]").slice(0, 3500);
}

export async function reportError(source: string, error: unknown, context?: Record<string, unknown>) {
  const webhook = process.env.DISCORD_DEBUG_WEBHOOK;
  if (!webhook) return;
  const safeContext = Object.fromEntries(Object.entries(context ?? {}).filter(([key]) => !secretKeyPattern.test(key)).map(([key, value]) => [key, sanitize(value)]));
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "FriendCord Debug", embeds: [{ title: "Erro em " + source, description: "```\n" + sanitize(error) + "\n```", color: 15548997, fields: Object.entries(safeContext).slice(0, 8).map(([name, value]) => ({ name, value: String(value).slice(0, 1000), inline: true })), timestamp: new Date().toISOString() }] }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (reportingError) { console.error("Falha ao enviar telemetria", reportingError); }
}
