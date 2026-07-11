import { spawn } from "node:child_process";

const nextCli = "node_modules/next/dist/bin/next";
const playwrightCli = "node_modules/playwright/cli.js";
const childEnvironment = { ...process.env };
delete childEnvironment.NO_COLOR;

let nextServer = null;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    nextServer?.kill(signal);
  });
}

try {
  let baseURL = process.env.E2E_BASE_URL || "";
  if (!process.env.E2E_SKIP_WEB_SERVER) {
    await runChild(process.execPath, [nextCli, "build", "--webpack"], {
      ...childEnvironment,
      AUSSIE_BUILD_RELEASE: "e2e-local",
    });
    const started = await startNextServer();
    nextServer = started.child;
    baseURL = started.baseURL;
  }

  const exitCode = await runChild(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
    ...childEnvironment,
    ...(baseURL ? { E2E_BASE_URL: baseURL } : {}),
    E2E_SKIP_WEB_SERVER: "1",
  }, { rejectOnFailure: false });
  process.exitCode = interrupted ? 130 : exitCode;
} finally {
  await stopChild(nextServer);
}

function runChild(command, args, env, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const exitCode = code ?? (signal ? 128 : 1);
      if (exitCode !== 0 && options.rejectOnFailure !== false) {
        reject(new Error(`${args.join(" ")} exited with code ${exitCode}`));
        return;
      }
      resolve(exitCode);
    });
  });
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd: process.cwd(),
      env: { ...childEnvironment, AUSSIE_BUILD_RELEASE: "e2e-local" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let baseURL = "";
    let settled = false;
    const timeout = setTimeout(() => fail(new Error("The local Next.js server did not become ready")), 30_000);
    const handleEarlyExit = (code, signal) => {
      fail(new Error(`The local Next.js server exited before Playwright (${code ?? signal ?? "unknown"})`));
    };

    child.stdout.on("data", (chunk) => readOutput(chunk, process.stdout));
    child.stderr.on("data", (chunk) => readOutput(chunk, process.stderr));
    child.once("error", fail);
    child.once("exit", handleEarlyExit);

    function readOutput(chunk, destination) {
      destination.write(chunk);
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) baseURL = `http://127.0.0.1:${match[1]}`;
      if (baseURL && /Ready in/.test(output)) {
        settled = true;
        clearTimeout(timeout);
        child.off("exit", handleEarlyExit);
        resolve({ child, baseURL });
      }
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      reject(error);
    }
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}
