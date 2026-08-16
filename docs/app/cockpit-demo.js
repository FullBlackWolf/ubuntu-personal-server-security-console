(function () {
  "use strict";

  const SESSION_KEY = "security-console-public-demo";
  const path = window.location.pathname;
  const appIndex = path.indexOf("/app/");
  const siteRoot = appIndex >= 0 ? path.slice(0, appIndex + 1) : "./";
  if (window.sessionStorage.getItem(SESSION_KEY) !== "authenticated") {
    window.location.replace(siteRoot);
    return;
  }

  const dataPromise = fetch(siteRoot + "demo-data.json", { cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error(`demo data HTTP ${response.status}`);
    return response.json();
  }).then(data => {
    if (data?.metadata?.synthetic !== true) throw new Error("preview data is not marked synthetic");
    return data;
  });

  const memory = {
    reviews: readStore("reviews", {}),
    filters: readStore("filters", []),
    config: readStore("config", {
      retention_days: 30,
      thresholds: { auth_failures_10m: 10, firewall_blocks_10m: 100, postgres_auth_failures_1h: 5, new_remote_source: true, off_hours_root: true, security_config_change: true },
      off_hours: { start: 20, end: 7 },
      whitelist: { actors: [], sources: [], categories: [] },
      browser_notifications: false,
      notifications: { webhook_enabled: false, webhook_url: "", email_enabled: false, email_to: "" },
    }),
    archives: readStore("archives", [
      { name: "security-daily-demo.json", created_at: new Date(Date.now() - 86_400_000).toISOString(), bytes: 1382400, valid: true },
      { name: "security-weekly-demo-summary.md", created_at: new Date(Date.now() - 6 * 86_400_000).toISOString(), bytes: 8842, valid: true },
    ]),
    heavy: readStore("heavy", {}),
    keys: readStore("keys", [
      { user: "demo-admin", fingerprint: "SHA256:DEMO7uJk3ExampleFingerprint001", type: "ssh-ed25519", type_label: "ED25519", comment: "Demo workstation", enabled: true, allow_from: "192.0.2.0/24", expires: "2027-08-16", knock_required: true, command_conflict: false, agent_forwarding: false, port_forwarding: false, pty: true, user_rc: false, x11_forwarding: false, touch_required: false },
      { user: "demo-admin", fingerprint: "SHA256:DEMO9fId0ExampleFingerprint002", type: "sk-ssh-ed25519@openssh.com", type_label: "FIDO2 ED25519", comment: "Demo hardware key", enabled: true, allow_from: "", expires: "", knock_required: false, command_conflict: false, agent_forwarding: false, port_forwarding: false, pty: true, user_rc: false, x11_forwarding: false, touch_required: true },
      { user: "demo-deploy", fingerprint: "SHA256:DEMO2cIc7ExampleFingerprint003", type: "ssh-ed25519", type_label: "ED25519", comment: "Synthetic deployment key", enabled: false, allow_from: "198.51.100.0/24", expires: "2026-12-31", knock_required: true, command_conflict: false, agent_forwarding: false, port_forwarding: false, pty: false, user_rc: false, x11_forwarding: false, touch_required: false },
    ]),
  };

  function readStore(name, fallback) {
    try { return JSON.parse(window.sessionStorage.getItem(`security-demo-${name}`) || "null") ?? fallback; }
    catch (_) { return fallback; }
  }

  function writeStore(name, value) {
    window.sessionStorage.setItem(`security-demo-${name}`, JSON.stringify(value));
  }

  function timestamp(minutesAgo) {
    return new Date(Date.now() - minutesAgo * 60_000).toISOString();
  }

  function eventModel(raw) {
    const imported = raw.source === "imported";
    const risk = imported ? "imported" : (raw.severity === "high" || raw.source === "auditd" ? "high" : "suspicious");
    const moment = timestamp(raw.minutes_ago);
    const target = raw.source === "postgresql" ? "PostgreSQL authentication and query service" : raw.source === "ufw" ? "Inbound network policy" : `${raw.source} service`;
    return {
      id: raw.id,
      timestamp: moment,
      epoch_ms: new Date(moment).getTime(),
      risk,
      severity: raw.severity === "high" ? "high" : "medium",
      category: raw.category,
      title: raw.message.length > 92 ? raw.message.slice(0, 89) + "…" : raw.message,
      actor: raw.actor,
      source: raw.ip,
      target,
      detail: `[SYNTHETIC PUBLIC DEMO] ${raw.message}`,
      log_source: imported ? "imported" : raw.source === "auditd" ? "auditd" : "journald",
      log_ref: `demo:${raw.source}:${raw.id}`,
      imported_at: imported ? timestamp(Math.max(0, raw.minutes_ago - 5)) : undefined,
    };
  }

  function countPeriods(events) {
    const now = Date.now();
    const count = milliseconds => events.filter(item => now - item.epoch_ms <= milliseconds).length;
    return { "1h": count(3_600_000), "24h": count(86_400_000), "7d": count(7 * 86_400_000), "30d": count(30 * 86_400_000) };
  }

  function ranked(events, key, limit = 20) {
    const counts = new Map();
    events.forEach(item => counts.set(item[key] || "—", (counts.get(item[key] || "—") || 0) + 1));
    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
  }

  function daily(events) {
    const counts = new Map();
    events.forEach(item => {
      const date = item.timestamp.slice(0, 10);
      counts.set(date, (counts.get(date) || 0) + 1);
    });
    return Array.from(counts, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  }

  function reportFor(data, mode) {
    const all = data.events.map(eventModel);
    const events = mode === "high" ? all.filter(item => item.risk === "high") : all.filter(item => item.risk === "suspicious");
    const categories = ranked(events, "category");
    const dimensionKey = mode === "high" ? "actor" : "source";
    const auditCount = events.filter(item => item.log_source === "auditd").length;
    const journalCount = events.filter(item => item.log_source === "journald").length;
    return {
      mode,
      generated_at: new Date().toISOString(),
      retention_days: memory.config.retention_days,
      total: events.length,
      periods: countPeriods(events),
      severity: { high: events.filter(item => item.severity === "high").length, medium: events.filter(item => item.severity !== "high").length },
      daily: daily(events),
      categories,
      dimension_label: mode === "high" ? "Operator" : "Source address",
      dimension: ranked(events, dimensionKey),
      events,
      details_limited: false,
      insights: {
        unique_actors: new Set(events.map(item => item.actor)).size,
        unique_sources: new Set(events.map(item => item.source)).size,
        last_event_at: events[0]?.timestamp || null,
        log_sources: { auditd: auditCount, journald: journalCount },
      },
    };
  }

  function postgresReport(data, imported, sourceName) {
    const authEvents = data.events.filter(item => item.source === "postgresql" && item.message.includes("authentication failed"));
    const fatal = data.events.filter(item => item.source === "postgresql" && item.message.includes("FATAL:")).slice(0, 100);
    const series = data.postgresql.errors_per_minute.map((item, index, list) => {
      const perMinute = Number(item.errors_per_minute) || 0;
      return { hour: timestamp((list.length - 1 - index) * 60), count: Math.round(perMinute * 60), minutes: 60, per_minute: perMinute };
    });
    return {
      generated_at: new Date().toISOString(),
      range_end: new Date().toISOString(),
      imported: Boolean(imported),
      retention_days: memory.config.retention_days,
      auth_failures: {
        "1h": authEvents.filter(item => item.minutes_ago <= 60).length,
        "24h": authEvents.filter(item => item.minutes_ago <= 1440).length,
        "30d": authEvents.filter(item => item.minutes_ago <= 43_200).length,
      },
      error_series: series,
      fatal_logs: fatal.map(item => ({ timestamp: timestamp(item.minutes_ago), user: item.actor, database: "demo_database", ip: item.ip, message: item.message })),
      failed_login_users: data.postgresql.top_users.map(item => ({ name: item.actor, count: item.count })),
      failed_login_ips: data.postgresql.top_ips.map(item => ({ name: item.ip, count: item.count })),
      sources: [sourceName || "synthetic repository dataset"],
      data_limited: false,
    };
  }

  function centerReport(data) {
    const all = data.events.map(eventModel);
    const systemEvents = all.filter(item => item.risk !== "imported");
    const importedEvents = all.filter(item => item.risk === "imported");
    const pg = postgresReport(data, false);
    const actorGroups = new Map();
    systemEvents.forEach(item => {
      if (!actorGroups.has(item.actor)) actorGroups.set(item.actor, []);
      actorGroups.get(item.actor).push(item);
    });
    const correlations = Array.from(actorGroups).filter(([, items]) => items.length >= 4).slice(0, 8).map(([actor, items], index) => ({
      id: `demo-correlation-${index + 1}`,
      identity_type: "User",
      identity: actor,
      count: items.length,
      start_at: items[items.length - 1].timestamp,
      end_at: items[0].timestamp,
      categories: Array.from(new Set(items.map(item => item.category))).slice(0, 5),
      event_ids: items.slice(0, 12).map(item => item.id),
    }));
    const alerts = data.alerts.map((alert, index) => ({
      id: `demo-alert-${index + 1}`,
      rule: `synthetic-rule-${index + 1}`,
      severity: ["critical", "high"].includes(alert.severity) ? "high" : "medium",
      title: alert.title,
      description: alert.detail,
      count: 2 + index * 3,
      latest_at: systemEvents[index]?.timestamp || new Date().toISOString(),
      event_ids: systemEvents.slice(index, index + 3).map(item => item.id),
    }));
    return {
      mode: "center",
      generated_at: new Date().toISOString(),
      retention_days: memory.config.retention_days,
      total: systemEvents.length,
      periods: countPeriods(systemEvents),
      severity: { high: systemEvents.filter(item => item.severity === "high").length, medium: systemEvents.filter(item => item.severity !== "high").length },
      daily: daily(systemEvents),
      categories: ranked(systemEvents, "category"),
      dimension_label: "Source address",
      dimension: ranked(systemEvents, "source"),
      events: systemEvents,
      imported_events: importedEvents,
      details_limited: false,
      insights: { unique_actors: new Set(systemEvents.map(item => item.actor)).size, unique_sources: new Set(systemEvents.map(item => item.source)).size, last_event_at: systemEvents[0]?.timestamp || null, log_sources: { auditd: systemEvents.filter(item => item.log_source === "auditd").length, journald: systemEvents.filter(item => item.log_source === "journald").length } },
      alerts,
      correlations,
      health: {
        auditd: { status: "active", enabled: 1, lost: 0, backlog: 3, backlog_limit: 8192, latest: timestamp(2) },
        journald: { status: "active", disk_usage: "428.0M", latest: timestamp(1) },
        storage: { total: 536_870_912_000, used: 128_849_018_880, free: 408_021_893_120, percent_used: 24 },
        clock: { ntp_synchronized: true },
        archives: { count: memory.archives.length, valid: memory.archives.filter(item => item.valid).length, invalid: memory.archives.filter(item => !item.valid).length, latest: memory.archives[0]?.created_at || null },
        imports: { count: 4, valid: 4, invalid: 0, lines_limited: false },
      },
      postgresql: { auth_failures: pg.auth_failures, fatal_count: pg.fatal_logs.length, sources: pg.sources },
    };
  }

  function stateResponse() {
    return { version: 1, reviews: memory.reviews, config: memory.config, saved_filters: memory.filters, imports: [], notification_state: { delivered_alerts: [] }, archives: memory.archives };
  }

  function pseudoHash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619) >>> 0;
    return value.toString(16).padStart(8, "0").repeat(8);
  }

  function heavyStatus() {
    const tasks = ["aide", "lynis", "debsums", "clam-scan", "clamd"];
    return tasks.map(id => {
      const item = memory.heavy[id] || { automatic: false, running: false };
      return `${id}|${item.automatic ? "on" : "off"}|${item.running ? "running" : "stopped"}|Demo environment: no server resources were consumed`;
    }).join("\n") + "\n";
  }

  function keysResponse() {
    return {
      users: [{ name: "demo-admin", home: "/home/demo-admin" }, { name: "demo-deploy", home: "/home/demo-deploy" }],
      keys: memory.keys,
      knock: { installed: true, active: true, unit: "fwknop-server.service", access_configured: true, gate_installed: true },
    };
  }

  async function handle(args, input) {
    const data = await dataPromise;
    const command = args[0] || "";
    if (command === "/usr/bin/systemctl" && args[1] === "is-active") return "active\n";
    if (command === "/usr/bin/systemctl" && args[1] === "restart") return "Demo environment: the service restart request was recorded without contacting a real system.\n";
    if (command === "/usr/bin/journalctl") return data.events.slice(0, 24).map(item => `${timestamp(item.minutes_ago)} demo-server ${item.source}: ${item.message}`).join("\n") + "\n";
    if (command === "/usr/sbin/ufw") return "Status: active\nDefault: deny (incoming), allow (outgoing)\n22/tcp ALLOW IN 192.0.2.0/24\n9090/tcp ALLOW IN 198.51.100.0/24\n";
    if (command === "/usr/bin/fail2ban-client") return "Status for the jail: sshd\nCurrently failed: 2\nCurrently banned: 3\nBanned IP list: 192.0.2.44 198.51.100.72 203.0.113.19\n";
    if (command === "/usr/sbin/auditctl") return "-w /etc/ssh/sshd_config -p wa -k security-config\n-w /etc/sudoers -p wa -k privilege-policy\n";
    if (command === "/usr/local/libexec/postgresql-security-report") return JSON.stringify(postgresReport(data, args[1] === "--stdin", args[2]));
    if (command === "/usr/local/libexec/security-operations-report") return JSON.stringify(args[1] === "center" ? centerReport(data) : reportFor(data, args[1]));
    if (command === "/usr/local/sbin/security-operations-control") return handleOperations(args.slice(1), input, data);
    if (command === "/usr/local/sbin/security-heavy-control") return handleHeavy(args.slice(1));
    if (command === "/usr/local/sbin/security-key-control") return handleKeys(args[1], input);
    throw new Error(`The public preview does not support this command: ${args.join(" ")}`);
  }

  function handleOperations(args, input, data) {
    const action = args[0];
    const structuredActions = new Set(["review", "config", "save-filter", "delete-filter"]);
    const payload = input && structuredActions.has(action) ? JSON.parse(input) : {};
    if (action === "state") return JSON.stringify(stateResponse());
    if (action === "reviews") return JSON.stringify({ reviews: memory.reviews });
    if (action === "review") {
      const record = { event_id: payload.event_id, status: payload.status, note: payload.note || "", reviewer: "visitor (demo)", updated_at: new Date().toISOString(), event: payload.event };
      memory.reviews[payload.event_id] = record; writeStore("reviews", memory.reviews); return JSON.stringify(record);
    }
    if (action === "config") { memory.config = { ...memory.config, ...payload, notifications: payload.notifications || memory.config.notifications }; writeStore("config", memory.config); return JSON.stringify(memory.config); }
    if (action === "save-filter") { memory.filters = [{ name: payload.name, filters: payload.filters }, ...memory.filters.filter(item => item.name !== payload.name)].slice(0, 20); writeStore("filters", memory.filters); return JSON.stringify(memory.filters); }
    if (action === "delete-filter") { memory.filters = memory.filters.filter(item => item.name !== payload.name); writeStore("filters", memory.filters); return JSON.stringify(memory.filters); }
    if (action === "archive") {
      const stamp = new Date().toISOString();
      const archive = { name: `security-manual-demo-${Date.now()}.json`, created_at: stamp, bytes: 1_425_408, valid: true };
      memory.archives.unshift(archive); writeStore("archives", memory.archives);
      return JSON.stringify({ archive: `/var/lib/server-security-console/archives/${archive.name}`, checksum: pseudoHash(stamp), summary: "synthetic-summary.md", summary_checksum: pseudoHash("summary"), bytes: archive.bytes, kind: "manual" });
    }
    if (action === "verify") return JSON.stringify(memory.archives);
    if (action === "import-log") return JSON.stringify({ id: `IMPORT-DEMO-${Date.now()}`, duplicate: false, bytes: input.length, sha256: pseudoHash(input), name: args[1] || "selected.log" });
    if (action === "notify") return JSON.stringify({ new_alerts: data.alerts.length, webhook: "disabled", email: "disabled" });
    return JSON.stringify({ ok: true, demo: true });
  }

  function handleHeavy(args) {
    const action = args[0];
    if (action === "status") return heavyStatus();
    const task = args[1];
    const current = memory.heavy[task] || { automatic: false, running: false };
    if (action === "set-auto") current.automatic = args[2] === "on";
    if (action === "run") current.running = true;
    if (action === "stop") current.running = false;
    memory.heavy[task] = current; writeStore("heavy", memory.heavy);
    if (action === "logs") return `${new Date().toISOString()} demo-server ${task}: synthetic preview log; no scanner was executed.\n`;
    return "The simulated operation was saved in this browser session; no real scan was performed.\n";
  }

  function handleKeys(action, input) {
    if (action === "list") return JSON.stringify(keysResponse());
    if (action === "knock-logs") return `${new Date().toISOString()} demo-server fwknopd: valid synthetic SPA packet from 192.0.2.24\n${new Date().toISOString()} demo-server fwknopd: temporary TCP/22 rule added for 192.0.2.24\n`;
    if (action === "mutate") {
      const payload = input ? JSON.parse(input) : {};
      if (payload.action === "delete") memory.keys = memory.keys.filter(item => item.fingerprint !== payload.fingerprint);
      else if (payload.action === "update") memory.keys = memory.keys.map(item => item.fingerprint === payload.fingerprint ? { ...item, ...payload } : item);
      else if (payload.action === "add") memory.keys.push({ user: payload.user, fingerprint: `SHA256:DEMO${Date.now()}PreviewOnly`, type: "ssh-ed25519", type_label: "ED25519", comment: payload.comment || "Browser-session demo key", enabled: true, allow_from: "", expires: "", knock_required: Boolean(payload.knock_required), command_conflict: false, agent_forwarding: false, port_forwarding: false, pty: true, user_rc: false, x11_forwarding: false, touch_required: false });
      writeStore("keys", memory.keys);
      return JSON.stringify({ ok: true, demo: true });
    }
    return JSON.stringify({ ok: true, demo: true });
  }

  function spawn(args) {
    let input = "";
    let resolvePromise;
    let rejectPromise;
    const process = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    process.input = value => { input += String(value ?? ""); return process; };
    window.setTimeout(() => handle(Array.from(args || []), input).then(resolvePromise, rejectPromise), 0);
    return process;
  }

  function jump(target) {
    const routes = {
      "/security_dashboard/security-dashboard": "security_dashboard/security-dashboard.html",
      "/security_operations/security-center": "security_operations/security-center.html",
      "/security_operations/high-risk-operations": "security_operations/high-risk-operations.html",
      "/security_operations/suspicious-operations": "security_operations/suspicious-operations.html",
      "/security_heavy/security-heavy": "security_heavy/security-heavy.html",
      "/security_keys/security-keys": "security_keys/security-keys.html",
    };
    if (routes[target]) window.location.assign(siteRoot + "app/" + routes[target]);
    else window.alert("This action belongs to Cockpit host management. The public GitHub preview is not connected to a real server.");
  }

  window.cockpit = {
    spawn,
    jump,
    user: () => Promise.resolve({ name: "visitor", user: "visitor", full_name: "Public Demo Visitor" }),
    gettext: value => value,
    format: (text, ...values) => text.replace(/\$(\d+)/g, (_, index) => values[Number(index)] ?? ""),
  };
})();
