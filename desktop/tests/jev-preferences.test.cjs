// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Preferences } = require("../lib/preferences.cjs");

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`encrypted:${text}`),
  decryptString: (buffer) => buffer.toString().replace(/^encrypted:/, ""),
};
function fixture(t, storage = secureStorage) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jev-prefs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "preferences.json");
  return { file, prefs: new Preferences(file, storage) };
}

test("Jev defaults off with remembered feature defaults, and requires boolean settings", (t) => {
  const { file, prefs } = fixture(t);
  assert.equal(prefs.publicState().jevEnabled, false);
  assert.equal(prefs.publicState().jevMediaEnabled, true);
  assert.equal(prefs.publicState().jevExpressionEnabled, true);
  assert.equal(prefs.publicState().jevApiKeyConfigured, false);
  prefs.patch({ jevEnabled: "true", jevMediaEnabled: null, jevExpressionEnabled: 0 });
  assert.equal(prefs.data.jevEnabled, false);
  assert.equal(prefs.data.jevMediaEnabled, true);
  prefs.patch({ jevEnabled: true, jevMediaEnabled: false, jevExpressionEnabled: false });
  prefs.patch({ jevEnabled: false });
  const loaded = new Preferences(file);
  assert.equal(loaded.data.jevEnabled, false);
  assert.equal(loaded.data.jevMediaEnabled, false);
  assert.equal(loaded.data.jevExpressionEnabled, false);
  fs.writeFileSync(file, JSON.stringify({ jevEnabled: "false", jevMediaEnabled: 1, jevExpressionEnabled: null }));
  const invalid = new Preferences(file);
  assert.equal(invalid.data.jevEnabled, false);
  assert.equal(invalid.data.jevMediaEnabled, true);
  assert.equal(invalid.data.jevExpressionEnabled, true);
});

test("Jev key encrypts, reloads, replaces and clears without public secret exposure", (t) => {
  const { file, prefs } = fixture(t);
  prefs.setApiKey("openai-secret");
  const state = prefs.setJevApiKey("  jev-secret  ");
  const ciphertext = prefs.data.encryptedJevApiKey;
  assert.equal(state.jevApiKeyConfigured, true);
  assert.equal(state.jevApiKeyPersistence, "encrypted");
  assert.equal(state.jevEnabled, false);
  assert.equal(JSON.stringify(state).includes("jev-secret"), false);
  assert.equal(JSON.stringify(state).includes(ciphertext), false);
  assert.equal("encryptedJevApiKey" in state, false);
  assert.equal("jevApiKey" in state, false);
  assert.equal(fs.readFileSync(file, "utf8").includes("jev-secret"), false);
  assert.equal(new Preferences(file, secureStorage).getJevApiKey(), "jev-secret");
  prefs.setJevApiKey("replacement");
  assert.equal(new Preferences(file, secureStorage).getJevApiKey(), "replacement");
  prefs.setJevApiKey("");
  assert.equal(prefs.getJevApiKey(), "");
  assert.equal(prefs.publicState().jevApiKeyConfigured, false);
  assert.equal("encryptedJevApiKey" in JSON.parse(fs.readFileSync(file, "utf8")), false);
  assert.equal(new Preferences(file, secureStorage).getJevApiKey(), "");
  assert.equal(prefs.getApiKey(), "openai-secret");
});

for (const [name, storage] of Object.entries({
  unavailable: null,
  basicText: { ...secureStorage, getSelectedStorageBackend: () => "basic_text" },
  availabilityThrows: { ...secureStorage, isEncryptionAvailable: () => { throw Error("unavailable"); } },
  encryptThrows: { ...secureStorage, encryptString: () => { throw Error("secret in error"); } },
})) {
  test(`Jev key remains session-only when ${name}`, (t) => {
    const { file, prefs } = fixture(t, storage);
    prefs.setJevApiKey("session-secret");
    prefs.patch({ language: "en" });
    assert.equal(prefs.getJevApiKey(), "session-secret");
    assert.equal(prefs.publicState().jevApiKeyPersistence, "session");
    assert.equal(prefs.publicState().jevApiKeyConfigured, true);
    assert.equal(fs.readFileSync(file, "utf8").includes("session-secret"), false);
    assert.equal("encryptedJevApiKey" in prefs.data, false);
    assert.equal(new Preferences(file, storage).getJevApiKey(), "");
    prefs.setJevApiKey("");
    assert.equal(prefs.getJevApiKey(), "");
  });
}

test("Jev rejects plaintext injection and handles decryption failure without exposing errors", (t) => {
  const { file, prefs } = fixture(t);
  prefs.patch({ jevApiKey: "injected", encryptedJevApiKey: "injected" });
  assert.equal(prefs.getJevApiKey(), "");
  assert.equal(fs.readFileSync(file, "utf8").includes("injected"), false);
  fs.writeFileSync(file, JSON.stringify({ jevApiKey: "injected", encryptedJevApiKey: "corrupt" }));
  const loaded = new Preferences(file, { ...secureStorage, decryptString: () => { throw Error("secret in error"); } });
  assert.equal(loaded.getJevApiKey(), "");
  assert.equal(loaded.publicState().jevApiKeyConfigured, false);
  assert.equal(JSON.stringify(loaded.publicState()).includes("corrupt"), false);
  loaded.save();
  assert.equal(fs.readFileSync(file, "utf8").includes("injected"), false);
});

test("switching to session storage removes the previous persisted Jev key", (t) => {
  const { file, prefs } = fixture(t);
  prefs.setJevApiKey("old-key");
  prefs.safeStorage = null;
  prefs.setJevApiKey("new-key");
  assert.equal(prefs.getJevApiKey(), "new-key");
  assert.equal(new Preferences(file, secureStorage).getJevApiKey(), "");
});


test("decision provider defaults to JEV and persists switching without copying keys", t => {
  const { file, prefs } = fixture(t);
  assert.equal(prefs.data.decisionProvider,'jev');
  prefs.setApiKey('openai-secret'); prefs.setJevApiKey('jev-secret');
  const openai = prefs.data.encryptedApiKey, jev = prefs.data.encryptedJevApiKey;
  prefs.patch({decisionProvider:'decisions'});
  const loaded = new Preferences(file,secureStorage);
  assert.equal(loaded.publicState().decisionProvider,'decisions');
  assert.equal(loaded.data.encryptedApiKey,openai);
  assert.equal(loaded.data.encryptedJevApiKey,jev);
  for (const invalid of ['other','',null,{},true]) {
    loaded.patch({decisionProvider:invalid});
    assert.equal(loaded.data.decisionProvider,'decisions');
  }
  loaded.patch({decisionProvider:'jev'});
  assert.equal(new Preferences(file,secureStorage).data.decisionProvider,'jev');
  fs.writeFileSync(file,JSON.stringify({decisionProvider:'other'}));
  assert.equal(new Preferences(file).data.decisionProvider,'jev');
});
