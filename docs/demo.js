"use strict";

const DEMO_USER = "visitor";
const DEMO_PASSWORD = "preview-only";
const SESSION_KEY = "security-console-public-demo";
const SVG_NS = "http://www.w3.org/2000/svg";
let demoData = null;
let filteredEvents = [];
let chartHours = 72;

const byId = (id) => document.getElementById(id);

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function number(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function dateTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(date) + " UTC";
}

function showLogin() {
  byId("demo-app").hidden = true;
  byId("login-screen").hidden = false;
  byId("password").value = "";
}

async function openDemo() {
  byId("login-screen").hidden = true;
  byId("demo-app").hidden = false;
  if (demoData) return;
  try {
    const response = await fetch("demo-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.metadata || data.metadata.synthetic !== true) throw new Error("Dataset is not marked synthetic");
    demoData = data;
    renderAll();
    byId("loading").hidden = true;
    switchPage("overview");
  } catch (error) {
    byId("loading").hidden = true;
    byId("load-error").hidden = false;
  }
}

function switchPage(page) {
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    const active = panel.dataset.pagePanel === page;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll("#main-nav [data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  document.querySelector(".sidebar").classList.remove("open");
  document.title = `${document.querySelector(`[data-page-panel="${page}"] h2`)?.textContent || "Security Console"} — Public Demo`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function summaryCard(label, value, detail, accent = "#2563eb") {
  const card = node("article", "summary-card");
  card.style.setProperty("--accent", accent);
  card.append(node("small", "", label), node("strong", "", value), node("span", "", detail));
  return card;
}

function renderSummary() {
  const summary = demoData.summary;
  const cards = byId("summary-cards");
  cards.replaceChildren(
    summaryCard("Active alerts", number(summary.active_alerts), `${summary.critical_alerts} critical`, "#dc2626"),
    summaryCard("Events · 24h", number(summary.events_24h), `${summary.pending_reviews} pending reviews`, "#2563eb"),
    summaryCard("PG failures · 1h", number(summary.postgres_auth_failures_1h), "authentication failures", "#d97706"),
    summaryCard("PG failures · 24h", number(summary.postgres_auth_failures_24h), "authentication failures", "#d97706"),
    summaryCard("Archive integrity", summary.archive_integrity, "SHA-256 sidecars", "#16a34a"),
  );
  byId("dataset-time").textContent = `Synthetic snapshot · ${dateTime(demoData.metadata.generated_at)} · ${summary.retention_days}-day retention`;
}

function makeChart(target, series, height = 190) {
  target.replaceChildren();
  if (!series.length) return;
  const width = 780;
  const left = 36;
  const top = 10;
  const bottom = 28;
  const plotWidth = width - left - 10;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(...series.map((item) => item.errors_per_minute), 1);
  const points = series.map((item, index) => {
    const x = left + (index / Math.max(series.length - 1, 1)) * plotWidth;
    const y = top + plotHeight - (item.errors_per_minute / maximum) * plotHeight;
    return { x, y, item };
  });
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Synthetic PostgreSQL errors per minute by hour");
  const defs = document.createElementNS(SVG_NS, "defs");
  const gradient = document.createElementNS(SVG_NS, "linearGradient");
  gradient.id = "chart-gradient";
  gradient.setAttribute("x1", "0"); gradient.setAttribute("y1", "0"); gradient.setAttribute("x2", "0"); gradient.setAttribute("y2", "1");
  const stopA = document.createElementNS(SVG_NS, "stop"); stopA.setAttribute("offset", "0"); stopA.setAttribute("stop-color", "#3b82f6");
  const stopB = document.createElementNS(SVG_NS, "stop"); stopB.setAttribute("offset", "1"); stopB.setAttribute("stop-color", "#fff");
  gradient.append(stopA, stopB); defs.append(gradient); svg.append(defs);
  [0, .25, .5, .75, 1].forEach((portion) => {
    const y = top + plotHeight * portion;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", left); line.setAttribute("x2", width - 10); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "chart-grid");
    svg.append(line);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", "1"); label.setAttribute("y", y + 3); label.setAttribute("class", "chart-label");
    label.textContent = (maximum * (1 - portion)).toFixed(1);
    svg.append(label);
  });
  const polygon = document.createElementNS(SVG_NS, "polygon");
  polygon.setAttribute("points", `${left},${top + plotHeight} ${points.map((point) => `${point.x},${point.y}`).join(" ")} ${left + plotWidth},${top + plotHeight}`);
  polygon.setAttribute("class", "chart-area");
  svg.append(polygon);
  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
  polyline.setAttribute("class", "chart-line");
  svg.append(polyline);
  const labelCount = Math.min(6, series.length);
  for (let index = 0; index < labelCount; index += 1) {
    const sourceIndex = Math.round(index * (series.length - 1) / Math.max(labelCount - 1, 1));
    const point = points[sourceIndex];
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", point.x); label.setAttribute("y", height - 6); label.setAttribute("text-anchor", index === 0 ? "start" : index === labelCount - 1 ? "end" : "middle"); label.setAttribute("class", "chart-label");
    label.textContent = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", timeZone: "UTC" }).format(new Date(point.item.timestamp));
    svg.append(label);
  }
  target.append(svg);
}

function renderHealth() {
  const list = byId("health-list");
  list.replaceChildren(...demoData.health.map((item) => {
    const row = node("div", "health-row");
    const copy = node("div"); copy.append(node("strong", "", item.name), node("small", "", item.detail));
    row.append(node("span"), copy);
    return row;
  }));
}

function renderAlerts() {
  const list = byId("alert-list");
  list.replaceChildren(...demoData.alerts.map((item) => {
    const row = node("div", "alert-row");
    const copy = node("div"); copy.append(node("strong", "", item.title), node("small", "", item.detail));
    row.append(node("span", `severity-dot severity-${item.severity}`), copy);
    return row;
  }));
}

function renderSources() {
  const counts = {};
  demoData.events.forEach((event) => { counts[event.source] = (counts[event.source] || 0) + 1; });
  const maximum = Math.max(...Object.values(counts));
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([source, count]) => {
    const row = node("div", "source-bar");
    const track = node("div", "bar-track");
    const fill = node("span"); fill.style.width = `${Math.round(count / maximum * 100)}%`; track.append(fill);
    row.append(node("span", "", source), track, node("strong", "", String(count)));
    return row;
  });
  byId("source-bars").replaceChildren(...rows);
}

function populateEventSources() {
  const select = byId("event-source");
  [...new Set(demoData.events.map((event) => event.source))].sort().forEach((source) => {
    const option = node("option", "", source); option.value = source; select.append(option);
  });
}

function eventRow(event, risk = false) {
  const row = node("tr");
  row.append(node("td", "", dateTime(event.timestamp)));
  if (risk) {
    row.append(node("td", "", event.category), node("td", "", event.actor), node("td", "", `${event.source} · ${event.ip}`), node("td", "message-cell", event.message));
  } else {
    const severity = node("span", `severity-badge ${event.severity}`, event.severity);
    const severityCell = node("td"); severityCell.append(severity);
    row.append(severityCell, node("td", "", event.source), node("td", "", `${event.actor} · ${event.ip}`), node("td", "message-cell", event.message));
  }
  const review = node("span", `review-badge ${event.review}`, event.review.replace("_", " "));
  const reviewCell = node("td"); reviewCell.append(review); row.append(reviewCell);
  return row;
}

function filterEvents() {
  const term = byId("event-search").value.trim().toLowerCase();
  const source = byId("event-source").value;
  const severity = byId("event-severity").value;
  const review = byId("event-review").value;
  filteredEvents = demoData.events.filter((event) => {
    if (source !== "all" && event.source !== source) return false;
    if (severity !== "all" && event.severity !== severity) return false;
    if (review !== "all" && event.review !== review) return false;
    return !term || [event.actor, event.ip, event.source, event.category, event.message].some((value) => value.toLowerCase().includes(term));
  });
  byId("event-count").textContent = `${number(filteredEvents.length)} matching synthetic events · showing up to 200`;
  byId("event-rows").replaceChildren(...filteredEvents.slice(0, 200).map((event) => eventRow(event)));
}

function renderPostgres() {
  const summary = demoData.summary;
  byId("pg-cards").replaceChildren(
    summaryCard("Auth failures · 1h", number(summary.postgres_auth_failures_1h), "synthetic events", "#d97706"),
    summaryCard("Auth failures · 24h", number(summary.postgres_auth_failures_24h), "synthetic events", "#d97706"),
    summaryCard("Recent FATAL", number(demoData.postgresql.fatal_logs.length), "up to 100 logs", "#dc2626"),
    summaryCard("Retention", `${summary.retention_days} days`, "manually configurable", "#2563eb"),
  );
  renderPostgresChart();
  byId("fatal-list").replaceChildren(...demoData.postgresql.fatal_logs.map((event) => {
    const item = node("div", "compact-item"); item.append(node("strong", "", event.message), node("small", "", `${dateTime(event.timestamp)} · ${event.ip}`)); return item;
  }));
  renderRanks("user-ranks", demoData.postgresql.top_users, "actor");
  renderRanks("ip-ranks", demoData.postgresql.top_ips, "ip");
}

function renderPostgresChart() {
  makeChart(byId("postgres-chart"), demoData.postgresql.errors_per_minute.slice(-chartHours), 260);
}

function renderRanks(targetId, items, field) {
  byId(targetId).replaceChildren(...items.map((item, index) => {
    const row = node("div", "rank-row"); row.append(node("b", "", `#${index + 1}`), node("strong", "", item[field]), node("span", "", String(item.count))); return row;
  }));
}

function renderRisk() {
  const events = demoData.events.filter((event) => event.severity === "high");
  const pending = events.filter((event) => event.review === "pending").length;
  const actors = new Set(events.map((event) => event.actor)).size;
  const sources = new Set(events.map((event) => event.ip)).size;
  byId("risk-total").textContent = `${events.length} synthetic high-risk events`;
  byId("risk-cards").replaceChildren(
    summaryCard("High-risk total", number(events.length), "30-day demo window", "#dc2626"),
    summaryCard("Pending review", number(pending), "server-side in production", "#d97706"),
    summaryCard("Distinct actors", number(actors), "fictional identities", "#2563eb"),
    summaryCard("Distinct sources", number(sources), "documentation IPs", "#16a34a"),
  );
  byId("risk-rows").replaceChildren(...events.slice(0, 120).map((event) => eventRow(event, true)));
}

const componentDescriptions = {
  dashboard: "Host overview, maintenance controls, and universal historical log reader.",
  postgresql: "Authentication failures, error charts, FATAL messages, and ranked users/IPs.",
  operations: "Unified timeline, server-side reviews, correlations, rules, imports, and exports.",
  automation: "Retention enforcement, alert evaluation, and verified scheduled archives.",
  scanners: "On-demand AIDE, Lynis, debsums, and ClamAV tasks; disabled by default.",
  ssh_keys: "Per-key source, expiry, capability, and fwknop SPA enforcement controls.",
};

function renderComponents() {
  byId("component-grid").replaceChildren(...demoData.components.map((item, index) => {
    const card = node("article", "component-card");
    const header = node("header");
    header.append(node("span", "component-icon", String(index + 1).padStart(2, "0")), node("span", `component-state ${item.enabled ? "enabled" : ""}`, item.enabled ? "DEMO ENABLED" : "OPTIONAL"));
    const dependency = item.depends_on.length ? `Depends on: ${item.depends_on.join(", ")}` : "No component dependency";
    card.append(header, node("h3", "", item.name), node("p", "", componentDescriptions[item.id]), node("small", "", dependency));
    return card;
  }));
}

function exportFiltered() {
  const payload = { metadata: demoData.metadata, exported_at: new Date().toISOString(), filters: { source: byId("event-source").value, severity: byId("event-severity").value, review: byId("event-review").value, search: byId("event-search").value }, events: filteredEvents };
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "security-console-synthetic-events.json"; link.click(); URL.revokeObjectURL(link.href);
}

function renderAll() {
  renderSummary();
  makeChart(byId("overview-chart"), demoData.postgresql.errors_per_minute.slice(-72));
  renderHealth(); renderAlerts(); renderSources(); populateEventSources(); filterEvents(); renderPostgres(); renderRisk(); renderComponents();
}

byId("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const valid = byId("username").value === DEMO_USER && byId("password").value === DEMO_PASSWORD;
  byId("login-error").textContent = valid ? "" : "Use the public demo credentials shown above.";
  if (valid) { sessionStorage.setItem(SESSION_KEY, "authenticated"); openDemo(); }
});
byId("fill-demo").addEventListener("click", () => { byId("username").value = DEMO_USER; byId("password").value = DEMO_PASSWORD; byId("login-error").textContent = ""; });
byId("logout").addEventListener("click", () => { sessionStorage.removeItem(SESSION_KEY); showLogin(); });
byId("menu-toggle").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.page)));
document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.jump)));
["event-search", "event-source", "event-severity", "event-review"].forEach((id) => byId(id).addEventListener(id === "event-search" ? "input" : "change", filterEvents));
document.querySelectorAll("[data-hours]").forEach((button) => button.addEventListener("click", () => { chartHours = Number(button.dataset.hours); document.querySelectorAll("[data-hours]").forEach((item) => item.classList.toggle("active", item === button)); renderPostgresChart(); }));
byId("export-filtered").addEventListener("click", exportFiltered);

if (sessionStorage.getItem(SESSION_KEY) === "authenticated") openDemo(); else showLogin();
