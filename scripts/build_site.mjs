// SPDX-License-Identifier: Apache-2.0
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "site");
const output = path.join(root, "site-dist");
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const repositoryUrl = repository ? `https://github.com/${repository}` : "#source";
const releaseUrl = repository ? `${repositoryUrl}/releases/latest` : "#download";
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await mkdir(path.join(output, "assets", "characters"), { recursive: true });

const assets = [
  ["app-icon.ico", "assets/favicon.ico"],
  ["app-icon.png", "assets/app-icon.png"],
  ["docs/images/charadock-hero.webp", "assets/charadock-hero.webp"],
  ["docs/images/charadock-work-mode.png", "assets/charadock-work-mode.png"],
  ["docs/images/characters/amber-complete-v2.png", "assets/characters/amber.png"],
  ["docs/images/characters/bronze-complete-v2.png", "assets/characters/bronze.png"],
  ["docs/images/characters/towa-complete-v1.png", "assets/characters/towa.png"],
  ["docs/images/characters/sage-complete-v1.png", "assets/characters/sage.png"],
  ["docs/images/characters/nike-complete-v1.png", "assets/characters/nike.png"],
];

for (const [from, to] of assets) {
  await cp(path.join(root, from), path.join(output, to));
}

for (const page of ["index.html", "ja.html"]) {
  const pagePath = path.join(output, page);
  const html = (await readFile(pagePath, "utf8"))
    .replaceAll("__REPOSITORY_URL__", repositoryUrl)
    .replaceAll("__RELEASE_URL__", releaseUrl)
    .replaceAll("__VERSION__", String(pkg.version));
  await writeFile(pagePath, html, "utf8");
}
await writeFile(path.join(output, ".nojekyll"), "", "utf8");

console.log(`site: built ${path.relative(root, output)} for ${repository || "local preview"}`);
