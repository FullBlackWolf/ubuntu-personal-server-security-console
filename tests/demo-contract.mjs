import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const dataset = JSON.parse(fs.readFileSync("docs/demo-data.json", "utf8"));
const storage = new Map([["security-console-public-demo", "authenticated"]]);
globalThis.window = {
  location: { pathname: "/ubuntu-personal-server-security-console/app/security_dashboard/security-dashboard.html", replace() {}, assign() {} },
  sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  setTimeout,
  alert() {},
};
globalThis.fetch = async () => ({ ok: true, json: async () => dataset });
vm.runInThisContext(fs.readFileSync("docs/cockpit-demo.js", "utf8"), { filename: "cockpit-demo.js" });

const pg = JSON.parse(await window.cockpit.spawn(["/usr/local/libexec/postgresql-security-report"]));
assert.equal(pg.error_series.length, 168);
assert.ok(Array.isArray(pg.fatal_logs));
assert.ok(pg.auth_failures["24h"] >= pg.auth_failures["1h"]);

const center = JSON.parse(await window.cockpit.spawn(["/usr/local/libexec/security-operations-report", "center"]));
assert.ok(center.events.length > 0);
assert.ok(center.imported_events.length > 0);
assert.equal(center.health.auditd.status, "active");
assert.equal(center.postgresql.auth_failures["1h"], pg.auth_failures["1h"]);

for (const mode of ["high", "suspicious"]) {
  const report = JSON.parse(await window.cockpit.spawn(["/usr/local/libexec/security-operations-report", mode]));
  assert.equal(report.mode, mode);
  assert.ok(report.events.length > 0);
  assert.ok(report.periods["30d"] >= report.periods["24h"]);
}

const state = JSON.parse(await window.cockpit.spawn(["/usr/local/sbin/security-operations-control", "state"]));
assert.equal(state.config.retention_days, 30);
assert.ok(state.archives.every(item => item.valid));

const importProcess = window.cockpit.spawn(["/usr/local/sbin/security-operations-control", "import-log", "synthetic.log"]);
const importedText = "2026-08-16 demo synthetic log\n";
importProcess.input(importedText);
const imported = JSON.parse(await importProcess);
assert.equal(imported.bytes, importedText.length);
assert.equal(imported.sha256.length, 64);

const keys = JSON.parse(await window.cockpit.spawn(["/usr/local/sbin/security-key-control", "list"]));
assert.ok(keys.keys.length >= 3);
assert.equal(keys.knock.active, true);

const heavy = await window.cockpit.spawn(["/usr/local/sbin/security-heavy-control", "status"]);
assert.match(heavy, /^aide\|off\|stopped/m);

assert.equal((await window.cockpit.user()).name, "visitor");
console.log("Cockpit demo adapter contracts: OK");
