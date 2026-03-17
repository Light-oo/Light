import type { Request } from "express";

type LogLevel = "info" | "warn" | "error";

type LogPayload = Record<string, unknown> | undefined;

function emitLog(level: LogLevel, base: Record<string, unknown>, payload?: LogPayload) {
  const record = payload ? { ...base, ...payload } : base;
  const serialized = JSON.stringify(record);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

function writeLog(level: LogLevel, req: Request, event: string, payload?: LogPayload) {
  const base: Record<string, unknown> = {
    level,
    event,
    requestId: (req as Request & { id?: string }).id ?? null,
    method: req.method,
    path: req.path
  };
  emitLog(level, base, payload);
}

export function logInfo(req: Request, event: string, payload?: LogPayload) {
  writeLog("info", req, event, payload);
}

export function logWarn(req: Request, event: string, payload?: LogPayload) {
  writeLog("warn", req, event, payload);
}

export function logError(req: Request, event: string, payload?: LogPayload) {
  writeLog("error", req, event, payload);
}

export function logSystemInfo(event: string, payload?: LogPayload) {
  emitLog("info", { level: "info", event }, payload);
}

export function logSystemWarn(event: string, payload?: LogPayload) {
  emitLog("warn", { level: "warn", event }, payload);
}

export function logSystemError(event: string, payload?: LogPayload) {
  emitLog("error", { level: "error", event }, payload);
}
