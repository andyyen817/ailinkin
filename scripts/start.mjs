import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { requireRuntime } from './runtime-guard.mjs';

requireRuntime('web');

const port = process.env.PORT ?? "3030";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}
const child = spawn(process.execPath, [resolve(".next/standalone/server.js")], {
  stdio: "inherit", env: { ...process.env, PORT: port, HOSTNAME: process.env.BIND_HOST ?? "0.0.0.0" },
});
child.on("exit", code => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
