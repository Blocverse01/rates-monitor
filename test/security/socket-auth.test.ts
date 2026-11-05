import "./setup-env.ts";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server as HTTPServer } from "node:http";
import { createServer } from "../../src/api/server.ts";
import { io as ioc, type Socket } from "socket.io-client";

const OPERATOR_USER = "operator";
const OPERATOR_PASSWORD = "test-operator-password";

function connectOnce(url: string, options: Parameters<typeof ioc>[1]) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = ioc(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 2000,
      ...options,
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("socket connect timeout"));
    }, 3000);

    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

describe("Socket.IO operator auth", () => {
  let url: string;
  let httpServer: HTTPServer;
  let io: { close: () => void };

  before(async () => {
    process.env.OPERATOR_AUTH_USER = OPERATOR_USER;
    process.env.OPERATOR_AUTH_PASSWORD = OPERATOR_PASSWORD;
    const server = createServer();
    httpServer = server.httpServer;
    io = server.io;

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }
    url = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    io.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  it("rejects a Socket.IO connect without a token", async () => {
    await assert.rejects(
      () => connectOnce(url, {}),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /Unauthorized|websocket error|xhr poll error/i);
        return true;
      }
    );
  });

  it("accepts a Socket.IO connect with operator credentials", async () => {
    const token = Buffer.from(
      `${OPERATOR_USER}:${OPERATOR_PASSWORD}`,
      "utf8"
    ).toString("base64");
    const socket = await connectOnce(url, {
      extraHeaders: {
        Authorization: `Basic ${token}`,
      },
      auth: {
        username: OPERATOR_USER,
        password: OPERATOR_PASSWORD,
      },
    });
    assert.equal(socket.connected, true);
    socket.close();
  });
});
