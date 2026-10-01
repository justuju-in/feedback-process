import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, access, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { seedLocalTemplates } from "../backend/scripts/localTestTemplates.mjs";
import { localTestAccounts } from "../backend/scripts/localTestAccounts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireBackend = createRequire(path.join(root, "backend/package.json"));
const mysql = requireBackend("mysql2/promise");
const bcrypt = requireBackend("bcryptjs");
const database = "feedback_process_local_test";
const mysqlPort = 3317;
const backendPort = 5117;
const frontendPort = 3117;
const state = path.join(process.platform === "linux" ? "/tmp" : os.tmpdir(), `feedback-process-local-test-${process.getuid?.() ?? "user"}`);
const datadir = path.join(state, "mysql");
const socketPath = path.join(state, "mysql.sock");
const children = [];
let stopping = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
  children.push(child);
  child.on("error", (error) => { console.error(`${command}: ${error.message}`); void stop(1); });
  return child;
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.toReversed()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(8000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  process.exitCode = code;
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
async function checkFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is in use. Stop the previous local test session and retry.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function waitForDatabase(child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopping || child.exitCode !== null) throw new Error(`MySQL did not start. Check ${path.join(state, "mysql.log")}`);
    try { return await mysql.createConnection({ socketPath, user: "root", multipleStatements: true }); }
    catch { await sleep(300); }
  }
  throw new Error(`MySQL startup timed out. Check ${path.join(state, "mysql.log")}`);
}

try {
  for (const port of [mysqlPort, backendPort, frontendPort]) await checkFreePort(port);
  await mkdir(datadir, { recursive: true, mode: 0o700 });
  await chmod(state, 0o700);
  try { await access(path.join(datadir, "mysql")); }
  catch {
    console.log("Preparing an isolated local test database…");
    const init = start("mysqld", ["--no-defaults", "--initialize-insecure", `--datadir=${datadir}`, "--tmpdir=/tmp", `--log-error=${path.join(state, "mysql-init.log")}`]);
    const code = await new Promise((resolve, reject) => { init.once("exit", resolve); init.once("error", reject); });
    if (code !== 0) throw new Error(`MySQL initialization failed. Check ${path.join(state, "mysql-init.log")}`);
  }
  if (stopping) throw new Error("Startup cancelled");
  const db = start("mysqld", ["--no-defaults", `--datadir=${datadir}`, "--tmpdir=/tmp", `--socket=${socketPath}`, `--port=${mysqlPort}`, "--bind-address=127.0.0.1", "--mysqlx=OFF", `--pid-file=${path.join(state, "mysql.pid")}`, `--log-error=${path.join(state, "mysql.log")}`]);
  const connection = await waitForDatabase(db);
  try {
    const schema = (await readFile(path.join(root, "backend/scripts/schema.sql"), "utf8")).replaceAll("feedback_process", database);
    await connection.query(schema);
    await connection.changeUser({ database });
    for (const account of localTestAccounts) {
      await connection.execute("INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE name=VALUES(name), password_hash=VALUES(password_hash), role=VALUES(role), is_active=TRUE", [account.name, account.email, await bcrypt.hash(account.password, 10), account.role]);
    }
    await seedLocalTemplates(connection);
  } finally { await connection.end(); }
  let localFormbricks = {};
  try {
    localFormbricks = JSON.parse(await readFile(path.join(root, ".local/formbricks/connection.json"), "utf8"));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const env = {
    ...process.env, NODE_ENV: "development", DOTENV_CONFIG_PATH: "/dev/null",
    DB_HOST: "127.0.0.1", DB_PORT: String(mysqlPort), DB_NAME: database, DB_USER: "root", DB_PASSWORD: "",
    JWT_SECRET: randomBytes(32).toString("hex"), BIND_HOST: "127.0.0.1", PORT: String(backendPort),
    FRONTEND_ORIGIN: `http://localhost:${frontendPort}`,
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", EMAIL_FROM: "", MATTERMOST_WEBHOOK_URL: "", SC_MATTERMOST_WEBHOOK_URL: "",
    FORMBRICKS_WORKSPACE_ID: process.env.FORMBRICKS_WORKSPACE_ID || localFormbricks.workspaceId || "",
    FORMBRICKS_URL: process.env.FORMBRICKS_URL || localFormbricks.origin || "https://app.formbricks.com", FORMBRICKS_API_KEY: process.env.FORMBRICKS_API_KEY || localFormbricks.apiKey || "",
  };
  let embedProxy;
  if (env.FORMBRICKS_URL === "http://localhost:3217") {
    await checkFreePort(3218);
    embedProxy = start(process.execPath, [path.join(root, "scripts/formbricks-embed-proxy.mjs")]);
  }
  const backend = start(process.execPath, ["src/server.js"], { cwd: path.join(root, "backend"), env });
  // A separate build directory keeps this preview from overwriting an existing Next build.
  const frontend = start(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(frontendPort)], { env: { ...env, API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`, NEXT_PUBLIC_API_URL: "/api", LOCAL_TEST_FRONTEND: "true" } });
  for (const child of [db, backend, frontend, embedProxy].filter(Boolean)) child.on("exit", (code) => { if (!stopping) { console.error("A local test service stopped."); void stop(code || 1); } });
  console.log(`\nLocal test app: http://localhost:${frontendPort}/login\nUse your normal email/password login. Local accounts: Rani Singh, Pooja (test), Shanti (test).\nNo production database or outbound email is used. Ctrl+C stops all test services.\nFormbricks requires a real workspace key to test external surveys.\n`);
} catch (error) {
  console.error(error.message);
  await stop(1);
}
