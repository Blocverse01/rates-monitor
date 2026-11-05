import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Socket } from "socket.io";

export const OPERATOR_COOKIE = "rates_operator";

export interface OperatorSocketAuth {
  readonly username?: string;
  readonly password?: string;
  readonly token?: string;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

export function credentialsConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    env.OPERATOR_AUTH_USER?.trim() && env.OPERATOR_AUTH_PASSWORD?.trim()
  );
}

export function verifyOperatorCredentials(
  user: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expectedUser = env.OPERATOR_AUTH_USER ?? "";
  const expectedPassword = env.OPERATOR_AUTH_PASSWORD ?? "";
  if (!expectedUser || !expectedPassword) {
    return false;
  }
  return safeEqual(user, expectedUser) && safeEqual(password, expectedPassword);
}

export function parseBasicAuth(
  header: string | undefined
): { user: string; password: string } | null {
  if (!header) {
    return null;
  }
  const match = header.match(/^Basic\s+(\S+)$/i);
  if (!match?.[1]) {
    return null;
  }
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) {
      return null;
    }
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function parseCookies(
  cookieHeader: string | undefined
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) {
      continue;
    }
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function credentialsFromToken(
  token: string
): { user: string; password: string } | null {
  const header = token.toLowerCase().startsWith("basic ")
    ? token
    : `Basic ${token}`;
  return parseBasicAuth(header);
}

export function isOperatorAuthorized(input: {
  authorization?: string | undefined;
  cookie?: string | undefined;
  auth?: OperatorSocketAuth | undefined;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input.env ?? process.env;
  if (!credentialsConfigured(env)) {
    return false;
  }

  const basic = parseBasicAuth(input.authorization);
  if (basic && verifyOperatorCredentials(basic.user, basic.password, env)) {
    return true;
  }

  if (input.auth?.username && input.auth.password) {
    if (
      verifyOperatorCredentials(input.auth.username, input.auth.password, env)
    ) {
      return true;
    }
  }

  if (input.auth?.token) {
    const fromToken = credentialsFromToken(input.auth.token);
    if (
      fromToken &&
      verifyOperatorCredentials(fromToken.user, fromToken.password, env)
    ) {
      return true;
    }
  }

  const cookieToken = parseCookies(input.cookie)[OPERATOR_COOKIE];
  if (cookieToken) {
    const fromCookie = credentialsFromToken(cookieToken);
    if (
      fromCookie &&
      verifyOperatorCredentials(fromCookie.user, fromCookie.password, env)
    ) {
      return true;
    }
  }

  return false;
}

function encodeBasicToken(user: string, password: string): string {
  return Buffer.from(`${user}:${password}`, "utf8").toString("base64");
}

function operatorCookieValue(input: {
  authorization?: string | undefined;
  cookie?: string | undefined;
  auth?: OperatorSocketAuth | undefined;
}): string | null {
  const basic = parseBasicAuth(input.authorization);
  if (basic) {
    return encodeBasicToken(basic.user, basic.password);
  }
  if (input.auth?.username && input.auth.password) {
    return encodeBasicToken(input.auth.username, input.auth.password);
  }
  if (input.auth?.token) {
    const fromToken = credentialsFromToken(input.auth.token);
    if (fromToken) {
      return encodeBasicToken(fromToken.user, fromToken.password);
    }
  }
  return parseCookies(input.cookie)[OPERATOR_COOKIE] ?? null;
}

export function setOperatorAuthCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${OPERATOR_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax${secure}`
  );
}

export function operatorAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authorization = headerValue(req.headers.authorization);
  const cookie = headerValue(req.headers.cookie);
  if (isOperatorAuthorized({ authorization, cookie })) {
    const token = operatorCookieValue({ authorization, cookie });
    if (token) {
      setOperatorAuthCookie(res, token);
    }
    next();
    return;
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="rates-monitor"');
  res.status(401).json({
    success: false,
    error: "Unauthorized",
  });
}

export function publicPath(path: string): boolean {
  return path === "/health";
}

export function operatorAuthUnlessPublic(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (publicPath(req.path)) {
    next();
    return;
  }
  operatorAuthMiddleware(req, res, next);
}

export function socketOperatorAuth(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const authorization = headerValue(socket.handshake.headers.authorization);
  const cookie = headerValue(socket.handshake.headers.cookie);
  const auth = socket.handshake.auth as OperatorSocketAuth;
  if (isOperatorAuthorized({ authorization, cookie, auth })) {
    next();
    return;
  }
  next(new Error("Unauthorized"));
}
