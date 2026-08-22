// SPDX-License-Identifier: Apache-2.0

const RELEASES_API_URL = "https://api.github.com/repos/ochisamu/CharaDock/releases?per_page=30";
const RELEASES_PAGE_URL = "https://github.com/ochisamu/CharaDock/releases";
const MICROSOFT_STORE_PRODUCT_ID = "9NXD2K8FXV3V";
const MICROSOFT_STORE_PAGE_URL = `https://apps.microsoft.com/detail/${MICROSOFT_STORE_PRODUCT_ID.toLowerCase()}`;
const MICROSOFT_STORE_APP_URL = `ms-windows-store://pdp/?ProductId=${MICROSOFT_STORE_PRODUCT_ID}`;

function detectAppPackageKind({ isPackaged = false, windowsStore = false, portableExecutableFile = "" } = {}) {
  if (!isPackaged) return "development";
  if (windowsStore) return "store";
  return portableExecutableFile ? "portable" : "installer";
}

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    const leftNumber = /^\d+$/.test(left[index]) ? Number(left[index]) : null;
    const rightNumber = /^\d+$/.test(right[index]) ? Number(right[index]) : null;
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null && rightNumber === null) return -1;
    if (leftNumber === null && rightNumber !== null) return 1;
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function releasePageUrl(tagName = "") {
  const tag = String(tagName || "").trim();
  return tag && parseVersion(tag)
    ? `${RELEASES_PAGE_URL}/tag/${encodeURIComponent(tag)}`
    : RELEASES_PAGE_URL;
}

function updateDestination(packageKind, releaseUrl = RELEASES_PAGE_URL) {
  if (packageKind === "store") {
    return {
      kind: "store",
      url: MICROSOFT_STORE_APP_URL,
      fallbackUrl: MICROSOFT_STORE_PAGE_URL,
    };
  }
  const trustedReleaseUrl = String(releaseUrl || "");
  return {
    kind: "github",
    url: trustedReleaseUrl.startsWith(`${RELEASES_PAGE_URL}/tag/`) ? trustedReleaseUrl : RELEASES_PAGE_URL,
    fallbackUrl: "",
  };
}

function normalizeRelease(release) {
  const tagName = String(release?.tag_name || "").trim().slice(0, 80);
  if (!parseVersion(tagName) || release?.draft) return null;
  return {
    version: tagName.replace(/^v/, ""),
    tagName,
    name: String(release?.name || tagName).trim().slice(0, 160) || tagName,
    notes: String(release?.body || "").trim().slice(0, 4000),
    prerelease: Boolean(release?.prerelease),
    publishedAt: String(release?.published_at || "").slice(0, 40),
    releaseUrl: releasePageUrl(tagName),
  };
}

function selectLatestRelease(releases, channel = "stable") {
  const includePrereleases = channel === "beta";
  const available = (Array.isArray(releases) ? releases : [])
    .map(normalizeRelease)
    .filter(Boolean);
  const stable = available.filter((release) => !release.prerelease);
  const candidates = includePrereleases || !stable.length ? available : stable;
  return candidates.sort((left, right) => compareVersions(right.version, left.version) || 0)[0] || null;
}

async function checkForAppUpdate({ currentVersion, channel = "stable", fetchImpl = globalThis.fetch, signal } = {}) {
  if (!parseVersion(currentVersion)) throw new Error("The installed app version is invalid.");
  if (typeof fetchImpl !== "function") throw new Error("Update checks are unavailable in this runtime.");
  const response = await fetchImpl(RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `CharaDock/${currentVersion}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal,
  });
  if (!response?.ok) throw new Error(`GitHub Releases returned HTTP ${response?.status || "error"}.`);
  const latest = selectLatestRelease(await response.json(), channel);
  if (!latest) throw new Error("No compatible CharaDock release was found.");
  return {
    status: compareVersions(latest.version, currentVersion) > 0 ? "available" : "current",
    currentVersion: String(currentVersion),
    channel: channel === "beta" ? "beta" : "stable",
    checkedAt: new Date().toISOString(),
    ...latest,
  };
}

module.exports = {
  MICROSOFT_STORE_APP_URL,
  MICROSOFT_STORE_PAGE_URL,
  MICROSOFT_STORE_PRODUCT_ID,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  checkForAppUpdate,
  compareVersions,
  detectAppPackageKind,
  parseVersion,
  releasePageUrl,
  selectLatestRelease,
  updateDestination,
};
