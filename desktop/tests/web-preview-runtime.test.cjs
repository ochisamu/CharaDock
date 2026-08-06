// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  WebPreviewRuntime,
  commandForWebProject,
  findWebProject,
} = require("../lib/web-preview-runtime.cjs");

function temporaryProject(packageJson, files = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-web-preview-"));
  fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  for (const file of files) fs.writeFileSync(path.join(directory, file), "");
  return directory;
}

test("Next.js and Vite projects expose only explicit runnable package scripts", () => {
  const directory = temporaryProject({
    name: "demo-next",
    packageManager: "pnpm@10.0.0",
    scripts: { dev: "next dev", build: "next build", start: "next start" },
    dependencies: { next: "latest" },
  });
  fs.mkdirSync(path.join(directory, "node_modules"));
  try {
    const project = findWebProject(directory, directory);
    assert.equal(project.framework, "nextjs");
    assert.equal(project.packageManager, "pnpm");
    assert.deepEqual(project.scripts.map((script) => script.name), ["dev", "start"]);
    assert.equal(project.dependenciesReady, true);
    assert.deepEqual(commandForWebProject(project, "dev", 43123, "win32"), {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm run dev -- --hostname 127.0.0.1 --port 43123"],
      label: "pnpm run dev -- --hostname 127.0.0.1 --port 43123",
    });
    assert.throws(() => commandForWebProject(project, "build", 43123), /not available/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("web project discovery climbs from a generated source artifact but never leaves its workspace", () => {
  const directory = temporaryProject({ scripts: { dev: "vite" }, devDependencies: { vite: "latest" } }, ["package-lock.json"]);
  fs.mkdirSync(path.join(directory, "src"));
  fs.writeFileSync(path.join(directory, "src", "main.js"), "export {};\n");
  try {
    const project = findWebProject(directory, path.join(directory, "src", "main.js"));
    assert.equal(project.framework, "vite");
    assert.equal(project.packageManager, "npm");
    assert.equal(project.relativeDirectory, ".");
    assert.equal(findWebProject(path.join(directory, "src"), directory), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("preview runtime reports readiness, streams bounded logs, and stops its child", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { setImmediate(() => child.emit("exit", 0, null)); return true; };
  let spawnCall;
  const states = [];
  const project = {
    directory: process.cwd(), name: "demo", framework: "vite", packageManager: "npm",
    scripts: [{ name: "dev", value: "vite" }], preferredScript: "dev",
  };
  const runtime = new WebPreviewRuntime({
    spawnProcess: (executable, args, options) => { spawnCall = { executable, args, options }; return child; },
    fetchImpl: async () => ({ status: 200 }),
    onState: (state) => states.push(state),
  });
  const running = await runtime.start({ project, projectId: "web-123", script: "dev", port: 43124 });
  assert.equal(running.status, "running");
  assert.equal(running.url, "http://127.0.0.1:43124/");
  assert.equal(spawnCall.options.shell, false);
  child.stdout.write("\u001b[32mready\u001b[0m\n");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.publicState().logs.at(-1), "ready");
  const stopped = await runtime.stop();
  assert.equal(stopped.status, "idle");
  assert.ok(states.some((state) => state.status === "starting"));
  assert.ok(states.some((state) => state.status === "running"));
});

test("preview runtime launches and stops a real package-script development server", { timeout: 15_000 }, async () => {
  const directory = temporaryProject({
    name: "live-preview-fixture",
    scripts: { dev: "node server.cjs" },
    devDependencies: { vite: "0.0.0-test-fixture" },
  });
  fs.writeFileSync(path.join(directory, "server.cjs"), `
const http = require("node:http");
const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("live preview ready");
});
server.listen(port, "127.0.0.1", () => console.log("fixture ready"));
`.trimStart());
  const project = findWebProject(directory, directory);
  const runtime = new WebPreviewRuntime();
  try {
    const running = await runtime.start({ project, projectId: "web-integration", script: "dev" });
    assert.equal(running.status, "running");
    assert.match(await (await fetch(running.url)).text(), /live preview ready/);
    assert.ok(runtime.publicState().logs.some((line) => /fixture ready/.test(line)));
  } finally {
    await runtime.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(runtime.publicState().status, "idle");
});
