import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

type Level = "info" | "warn" | "error";
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

function cleanString(value: string) {
  let sanitized = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer [REDACTED]")
    .replace(
      /(^|[?&\s])((?:token|secret|password|key)=)[^&\s]+/giu,
      "$1$2[REDACTED]",
    );
  const configuredSecrets = Object.entries(process.env)
    .filter(([key, item]) =>
      /(token|secret|password|key)/iu.test(key) && Boolean(item && item.length >= 8),
    )
    .map(([, item]) => item!);
  for (const secret of configuredSecrets)
    sanitized = sanitized.split(secret).join("[REDACTED]");
  return sanitized.slice(0, 2_000);
}

function clean(value: unknown): unknown {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(token|secret|password|content|transcript|key)/i.test(key))
      .map(([key, item]) => [key, clean(item)]),
  );
}

export function log(level: Level, event: string, data: Record<string, unknown> = {}) {
  const sanitized = clean(data) as Record<string, unknown>;
  const output = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...sanitized });
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

export function increment(name: string, amount = 1) {
  counters.set(name, (counters.get(name) || 0) + amount);
}

export function gauge(name: string, value: number) {
  gauges.set(name, value);
}

export function metricsText() {
  const lines: string[] = [];
  for (const [name, value] of counters)
    lines.push(`# TYPE astra_${name} counter`, `astra_${name} ${value}`);
  for (const [name, value] of gauges)
    lines.push(`# TYPE astra_${name} gauge`, `astra_${name} ${value}`);
  return `${lines.join("\n")}\n`;
}

export function requestTelemetry(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header("x-request-id")?.slice(0, 80) || randomUUID();
  const started = performance.now();
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    increment("http_requests_total");
    if (res.statusCode >= 500) increment("http_errors_total");
    log("info", "http_request", {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
    });
  });
  next();
}
