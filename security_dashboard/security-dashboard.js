(function () {
  "use strict";

  const services = [
    { unit: "ufw.service", label: "UFW Firewall", description: "Inbound traffic is denied by default; external RDP is explicitly blocked.", restart: false },
    { unit: "fail2ban.service", label: "Fail2ban", description: "Monitors failed SSH logins and automatically bans attack sources.", restart: true },
    { unit: "auditd.service", label: "auditd Auditing", description: "Records critical security events and sensitive configuration changes.", restart: false },
    { unit: "apparmor.service", label: "AppArmor", description: "Restricts the system resources available to protected programs.", restart: false },
    { unit: "unattended-upgrades.service", label: "Automatic Security Updates", description: "Installs Ubuntu security updates automatically without rebooting.", restart: false },
    { unit: "guest-command-approval.service", label: "Guest Command Approval", description: "Handles guestuser restricted-command requests, logs, and allowlists.", restart: true },
    { unit: "fwknop-server.service", label: "SPA Authorization", description: "Temporarily opens SSH after authenticated SPA authorization and supports per-key session gating.", restart: true },
    { unit: "ssh.socket", label: "OpenSSH", description: "Allows key authentication only; root login is disabled.", restart: false },
    { unit: "xrdp.service", label: "xrdp", description: "RDP is available only through an SSH tunnel; the firewall blocks its external port.", restart: true },
    { unit: "cockpit.socket", label: "Cockpit Console", description: "Local server administration and security control center.", restart: false }
  ];

  const serviceByUnit = new Map(services.map(item => [item.unit, item]));
  const grid = document.getElementById("service-grid");
  const output = document.getElementById("output");
  const updated = document.getElementById("updated");
  const postgresState = { report: null, liveReport: null, selectedFile: null };
  const postgresElements = {
    updated: document.getElementById("postgres-updated"),
    period: document.getElementById("postgres-period"),
    chart: document.getElementById("postgres-error-chart"),
    chartSummary: document.getElementById("postgres-chart-summary"),
    fatalCount: document.getElementById("postgres-fatal-count"),
    fatalRows: document.getElementById("postgres-fatal-rows"),
    userRows: document.getElementById("postgres-user-rows"),
    ipRows: document.getElementById("postgres-ip-rows"),
    fileInput: document.getElementById("postgres-log-file"),
    fileName: document.getElementById("postgres-file-name"),
    fileStatus: document.getElementById("postgres-file-status"),
    readButton: document.getElementById("postgres-read-log"),
    liveButton: document.getElementById("postgres-live-log"),
    saveButton: document.getElementById("postgres-save-log")
  };
  const maxUploadBytes = 64 * 1024 * 1024;
  const archiveState = { selectedFile: null, lines: [], text: "" };
  const archiveElements = {
    fileInput: document.getElementById("archive-log-file"),
    fileName: document.getElementById("archive-file-name"),
    status: document.getElementById("archive-log-status"),
    readButton: document.getElementById("archive-read-log"),
    mergeButton: document.getElementById("archive-merge-log"),
    clearButton: document.getElementById("archive-clear-log"),
    encoding: document.getElementById("archive-encoding"),
    search: document.getElementById("archive-search"),
    position: document.getElementById("archive-position"),
    resultCount: document.getElementById("archive-result-count"),
    output: document.getElementById("archive-log-output")
  };
  const archiveDisplayLineLimit = 20000;
  const archiveDisplayCharacterLimit = 4 * 1024 * 1024;
  let archiveSearchTimer;

  function run(args, privileged, input) {
    const process = cockpit.spawn(args, {
      superuser: privileged ? "require" : undefined,
      err: "message"
    });
    if (input !== undefined) process.input(input);
    return process;
  }

  function statusLabel(status) {
    return ({ active: "Running", inactive: "Stopped", failed: "Failed", loading: "Checking" })[status] || status;
  }

  function formatCount(value) {
    return new Intl.NumberFormat("en-US").format(Number(value) || 0);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || "—") : date.toLocaleString("en-US", { hour12: false });
  }

  function svgElement(name, attributes) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, value);
    return node;
  }

  function niceMaximum(value) {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const normalized = value / power;
    const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return rounded * power;
  }

  function formatRate(value) {
    return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  function renderPostgresChart() {
    const report = postgresState.report;
    if (!report) return;
    const days = Number(postgresElements.period.value) || 7;
    const series = report.error_series.slice(-days * 24);
    postgresElements.chart.replaceChildren();
    if (!series.length) {
      const empty = document.createElement("div");
      empty.className = "empty-chart";
      empty.textContent = "No data is available for this time range";
      postgresElements.chart.append(empty);
      return;
    }

    const width = 960;
    const height = 242;
    const left = 50;
    const right = 12;
    const top = 13;
    const bottom = 34;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = series.map(item => Number(item.per_minute) || 0);
    const total = series.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const maximum = niceMaximum(Math.max(...values));
    const xAt = index => left + (series.length === 1 ? 0 : (index / (series.length - 1)) * plotWidth);
    const yAt = value => top + plotHeight - (value / maximum) * plotHeight;
    const points = values.map((value, index) => `${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`);

    const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    const definitions = svgElement("defs");
    const gradient = svgElement("linearGradient", { id: "postgres-area-gradient", x1: "0", y1: "0", x2: "0", y2: "1" });
    gradient.append(svgElement("stop", { offset: "0%", "stop-color": "#42d69e", "stop-opacity": "0.28" }), svgElement("stop", { offset: "100%", "stop-color": "#42d69e", "stop-opacity": "0" }));
    definitions.append(gradient);
    svg.append(definitions);

    for (let tick = 0; tick <= 4; tick += 1) {
      const y = top + (tick / 4) * plotHeight;
      svg.append(svgElement("line", { x1: left, y1: y, x2: width - right, y2: y, class: "grid-line" }));
      const label = svgElement("text", { x: left - 7, y: y + 4, "text-anchor": "end", class: "axis-label" });
      label.textContent = formatRate(maximum * (1 - tick / 4));
      svg.append(label);
    }

    const tickCount = Math.min(6, series.length);
    const usedTicks = new Set();
    for (let tick = 0; tick < tickCount; tick += 1) {
      const index = Math.round((tick / Math.max(1, tickCount - 1)) * (series.length - 1));
      if (usedTicks.has(index)) continue;
      usedTicks.add(index);
      const date = new Date(series[index].hour);
      const label = svgElement("text", { x: xAt(index), y: height - 9, "text-anchor": tick === 0 ? "start" : tick === tickCount - 1 ? "end" : "middle", class: "axis-label" });
      label.textContent = days <= 3
        ? date.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", hour12: false })
        : date.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", hour12: false });
      svg.append(label);
    }

    const areaPoints = [`${left},${top + plotHeight}`, ...points, `${width - right},${top + plotHeight}`].join(" ");
    svg.append(svgElement("polygon", { points: areaPoints, class: "area" }));
    svg.append(svgElement("polyline", { points: points.join(" "), class: "trend" }));
    const focusLine = svgElement("line", { y1: top, y2: top + plotHeight, class: "focus-line" });
    const focusDot = svgElement("circle", { r: 4, class: "focus-dot" });
    const hitbox = svgElement("rect", { x: left, y: top, width: plotWidth, height: plotHeight, class: "chart-hitbox" });
    svg.append(focusLine, focusDot, hitbox);

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    hitbox.addEventListener("mousemove", event => {
      const bounds = svg.getBoundingClientRect();
      const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
      const index = Math.max(0, Math.min(series.length - 1, Math.round(((svgX - left) / plotWidth) * (series.length - 1))));
      const item = series[index];
      const x = xAt(index);
      const y = yAt(values[index]);
      focusLine.setAttribute("x1", x);
      focusLine.setAttribute("x2", x);
      focusDot.setAttribute("cx", x);
      focusDot.setAttribute("cy", y);
      focusLine.style.display = "block";
      focusDot.style.display = "block";
      tooltip.hidden = false;
      tooltip.textContent = `${formatDateTime(item.hour)} · ${formatRate(item.per_minute)} / min (${formatCount(item.count)} records)`;
      tooltip.style.left = `${Math.min(window.innerWidth - tooltip.offsetWidth - 8, event.clientX + 12)}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - 38)}px`;
    });
    hitbox.addEventListener("mouseleave", () => {
      focusLine.style.display = "none";
      focusDot.style.display = "none";
      tooltip.hidden = true;
    });
    postgresElements.chart.append(svg, tooltip);
    postgresElements.chart.setAttribute("aria-label", `PostgreSQL errors-per-minute trend for the past ${days} days, ${total} total errors`);
    postgresElements.chartSummary.textContent = `${formatCount(total)} errors · peak ${formatRate(Math.max(...values))} / min`;
  }

  function appendTableCell(row, value, className) {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (className) cell.className = className;
    row.append(cell);
  }

  function renderEmptyRow(body, columns, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns;
    cell.className = "empty-cell";
    cell.textContent = message;
    row.append(cell);
    body.replaceChildren(row);
  }

  function renderFatalLogs(logs) {
    postgresElements.fatalRows.replaceChildren();
    if (!logs.length) return renderEmptyRow(postgresElements.fatalRows, 5, "No PostgreSQL FATAL logs were found during the past 30 days");
    for (const item of logs) {
      const row = document.createElement("tr");
      appendTableCell(row, formatDateTime(item.timestamp));
      appendTableCell(row, item.user || "—");
      appendTableCell(row, item.database || "—");
      appendTableCell(row, item.ip || "—");
      appendTableCell(row, item.message || "—", "log-message");
      postgresElements.fatalRows.append(row);
    }
  }

  function renderRanking(body, items, emptyMessage) {
    body.replaceChildren();
    if (!items.length) return renderEmptyRow(body, 3, emptyMessage);
    items.forEach((item, index) => {
      const row = document.createElement("tr");
      appendTableCell(row, String(index + 1));
      appendTableCell(row, item.name);
      appendTableCell(row, formatCount(item.count));
      body.append(row);
    });
  }

  function renderPostgresReport(report) {
    postgresState.report = report;
    postgresElements.liveButton.hidden = !report.imported;
    const auth1h = Number(report.auth_failures["1h"]) || 0;
    const auth24h = Number(report.auth_failures["24h"]) || 0;
    document.getElementById("postgres-auth-1h").textContent = formatCount(auth1h);
    document.getElementById("postgres-auth-24h").textContent = formatCount(auth24h);
    const maximum = Math.max(auth1h, auth24h, 1);
    document.getElementById("postgres-auth-1h-bar").style.width = `${(auth1h / maximum) * 100}%`;
    document.getElementById("postgres-auth-24h-bar").style.width = `${(auth24h / maximum) * 100}%`;
    const rangePrefix = report.imported ? `30 days through ${formatDateTime(report.range_end)}` : "Past 30 days";
    document.getElementById("postgres-auth-note").textContent = `${rangePrefix}: ${formatCount(report.auth_failures["30d"])} failures; only FATAL-level authentication rejections are counted.`;
    postgresElements.fatalCount.textContent = `${rangePrefix}: ${formatCount(report.fatal_logs.length)} records, up to 100 shown`;
    renderFatalLogs(report.fatal_logs);
    renderRanking(postgresElements.userRows, report.failed_login_users, "No identifiable failed-login users");
    renderRanking(postgresElements.ipRows, report.failed_login_ips, "No identifiable failed-login source IPs");
    renderPostgresChart();
    const sourceNote = report.sources.length ? (report.imported ? `Archived log ${report.sources[0]}` : `${report.sources.length} data sources`) : "No PostgreSQL log source found";
    const limited = report.data_limited ? "; data reached the read limit" : "";
    postgresElements.updated.textContent = report.imported
      ? `${sourceNote} · logs through ${formatDateTime(report.range_end)}${limited}`
      : `Generated ${formatDateTime(report.generated_at)} · ${sourceNote}${limited}`;
  }

  function validPostgresReport(report) {
    return Boolean(report && typeof report === "object" && report.auth_failures &&
      Array.isArray(report.error_series) && Array.isArray(report.fatal_logs) &&
      Array.isArray(report.failed_login_users) && Array.isArray(report.failed_login_ips) &&
      Array.isArray(report.sources));
  }

  async function fetchLivePostgresReport() {
    const text = await run(["/usr/local/libexec/postgresql-security-report"], true);
    const report = JSON.parse(text);
    if (!validPostgresReport(report)) throw new Error("The reporting program returned invalid data");
    postgresState.liveReport = report;
    return report;
  }

  async function refreshPostgres() {
    postgresElements.updated.textContent = "Reading PostgreSQL logs from the past 30 days…";
    try {
      renderPostgresReport(await fetchLivePostgresReport());
    } catch (error) {
      postgresState.report = null;
      postgresElements.updated.textContent = `Unable to load PostgreSQL statistics: ${error.message || error}`;
      document.getElementById("postgres-auth-1h").textContent = "—";
      document.getElementById("postgres-auth-24h").textContent = "—";
      document.getElementById("postgres-auth-1h-bar").style.width = "0";
      document.getElementById("postgres-auth-24h-bar").style.width = "0";
      document.getElementById("postgres-auth-note").textContent = "Unable to read PostgreSQL authentication-failure statistics.";
      postgresElements.chartSummary.textContent = "Statistics failed to load";
      postgresElements.fatalCount.textContent = "Unable to read recent logs";
      postgresElements.chart.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "empty-chart";
      empty.textContent = "Unable to read PostgreSQL log statistics";
      postgresElements.chart.append(empty);
      renderEmptyRow(postgresElements.fatalRows, 5, "Statistics failed to load");
      renderEmptyRow(postgresElements.userRows, 3, "Statistics failed to load");
      renderEmptyRow(postgresElements.ipRows, 3, "Statistics failed to load");
    }
  }

  async function readFileBytes(file) {
    if (file.size > maxUploadBytes) throw new Error("The file exceeds the 64 MiB read limit");
    if (!file.name.toLowerCase().endsWith(".gz") && file.type !== "application/gzip") {
      return new Uint8Array(await file.arrayBuffer());
    }
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read gzip files; decompress the file first");
    const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxUploadBytes) {
        await reader.cancel();
        throw new Error("The decompressed log exceeds the 64 MiB read limit");
      }
      chunks.push(value);
    }
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  }

  async function readFileText(file, encoding = "utf-8") {
    return new TextDecoder(encoding, { fatal: false }).decode(await readFileBytes(file));
  }

  async function readSelectedPostgresLog() {
    const file = postgresState.selectedFile;
    if (!file) return;
    postgresElements.readButton.disabled = true;
    postgresElements.fileStatus.textContent = `Reading ${file.name}…`;
    try {
      const text = await readFileText(file);
      if (new Blob([text]).size > maxUploadBytes) throw new Error("The log exceeds the 64 MiB read limit");
      let report = null;
      if (file.name.toLowerCase().endsWith(".json")) {
        try {
          const saved = JSON.parse(text);
          if (saved.schema === "postgresql-security-snapshot-v1" && validPostgresReport(saved.report)) {
            report = { ...saved.report, imported: true, sources: [file.name] };
          }
        } catch (_) {
          // A PostgreSQL JSON log contains one object per line, so it is parsed by the server below.
        }
      }
      if (!report) {
        const result = await run(["/usr/local/libexec/postgresql-security-report", "--stdin", file.name], true, text);
        report = JSON.parse(result);
      }
      if (!validPostgresReport(report)) throw new Error("Unable to generate a valid PostgreSQL report from the file");
      renderPostgresReport(report);
      postgresElements.fileStatus.textContent = `Read ${file.name}; the charts now show archived logs. Select Return to Live Logs to switch back.`;
    } catch (error) {
      postgresElements.fileStatus.textContent = `Read failed: ${error.message || error}`;
    } finally {
      postgresElements.readButton.disabled = false;
    }
  }

  function snapshotFilename() {
    const now = new Date();
    const part = value => String(value).padStart(2, "0");
    return `postgresql-security-${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}.json`;
  }

  async function writeSnapshotFile(name, contents) {
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: "PostgreSQL security-log snapshot", accept: { "application/json": [".json"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
      }
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function saveCurrentPostgresLog() {
    postgresElements.saveButton.disabled = true;
    postgresElements.fileStatus.textContent = "Reading the latest logs and preparing the download…";
    try {
      const liveReport = await fetchLivePostgresReport();
      if (!postgresState.report?.imported) renderPostgresReport(liveReport);
      const savedAt = new Date().toISOString();
      const contents = JSON.stringify({ schema: "postgresql-security-snapshot-v1", saved_at: savedAt, report: liveReport }, null, 2) + "\n";
      const name = snapshotFilename();
      await writeSnapshotFile(name, contents);
      postgresElements.fileStatus.textContent = `Saved the latest log snapshot: ${name}`;
    } catch (error) {
      postgresElements.fileStatus.textContent = error?.name === "AbortError" ? "Save canceled" : `Save failed: ${error.message || error}`;
    } finally {
      postgresElements.saveButton.disabled = false;
    }
  }

  async function showLivePostgresLog() {
    postgresElements.fileStatus.textContent = "Returning to live logs…";
    try {
      const report = postgresState.liveReport || await fetchLivePostgresReport();
      renderPostgresReport(report);
      postgresElements.fileStatus.textContent = "Switched back to live PostgreSQL logs.";
    } catch (error) {
      postgresElements.fileStatus.textContent = `Unable to switch: ${error.message || error}`;
    }
  }

  function archiveMatchingLines(term, position) {
    const lines = archiveState.lines;
    if (!term) {
      const start = position === "tail" ? Math.max(0, lines.length - archiveDisplayLineLimit) : 0;
      return { shown: lines.slice(start, start + archiveDisplayLineLimit), total: lines.length, start };
    }
    const lowered = term.toLocaleLowerCase("en-US");
    let total = 0;
    for (const line of lines) {
      if (line.toLocaleLowerCase("en-US").includes(lowered)) total += 1;
    }
    const shown = [];
    if (position === "head") {
      for (let index = 0; index < lines.length && shown.length < archiveDisplayLineLimit; index += 1) {
        if (lines[index].toLocaleLowerCase("en-US").includes(lowered)) shown.push(lines[index]);
      }
    } else {
      for (let index = lines.length - 1; index >= 0 && shown.length < archiveDisplayLineLimit; index -= 1) {
        if (lines[index].toLocaleLowerCase("en-US").includes(lowered)) shown.push(lines[index]);
      }
      shown.reverse();
    }
    return { shown, total, start: null };
  }

  function renderArchiveLog() {
    if (!archiveState.lines.length) return;
    const term = archiveElements.search.value.trim();
    const position = archiveElements.position.value;
    const result = archiveMatchingLines(term, position);
    let display = result.shown.join("\n");
    let characterLimited = false;
    if (display.length > archiveDisplayCharacterLimit) {
      characterLimited = true;
      display = position === "tail"
        ? "…Content is too long; showing the end…\n" + display.slice(-archiveDisplayCharacterLimit)
        : display.slice(0, archiveDisplayCharacterLimit) + "\n…Content is too long; showing the beginning…";
    }
    archiveElements.output.textContent = display || "No matching log lines.";
    if (term) {
      archiveElements.resultCount.textContent = `${formatCount(result.total)} matching lines; showing ${formatCount(result.shown.length)}${characterLimited ? "; content reached the 4 MiB display limit" : ""}`;
    } else {
      const first = result.shown.length ? result.start + 1 : 0;
      const last = result.start + result.shown.length;
      archiveElements.resultCount.textContent = `${formatCount(result.total)} total lines; showing ${formatCount(first)}–${formatCount(last)}${characterLimited ? "; content reached the 4 MiB display limit" : ""}`;
    }
    if (position === "tail") archiveElements.output.scrollTop = archiveElements.output.scrollHeight;
    else archiveElements.output.scrollTop = 0;
  }

  async function readArchiveLog() {
    const file = archiveState.selectedFile;
    if (!file) return;
    archiveElements.readButton.disabled = true;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "Merge into Current Logs";
    archiveElements.status.textContent = `Reading ${file.name}…`;
    try {
      const text = await readFileText(file, archiveElements.encoding.value);
      archiveState.text = text;
      archiveState.lines = text.split(/\r\n|\n|\r/);
      archiveElements.search.disabled = false;
      archiveElements.position.disabled = false;
      archiveElements.clearButton.disabled = false;
      archiveElements.mergeButton.disabled = false;
      archiveElements.status.textContent = `Read ${file.name} · ${formatCount(file.size)} bytes · ${formatCount(archiveState.lines.length)} lines${text.includes("\x00") ? " · binary content detected; display may be incomplete" : ""}`;
      renderArchiveLog();
    } catch (error) {
      archiveElements.status.textContent = `Read failed: ${error.message || error}`;
      archiveElements.output.textContent = "Unable to read the selected log.";
    } finally {
      archiveElements.readButton.disabled = false;
    }
  }

  async function mergeArchiveLog() {
    const file = archiveState.selectedFile;
    if (!file || !archiveState.text) return;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "Merging…";
    archiveElements.status.textContent = `Writing ${file.name} to the managed audit log…`;
    try {
      const result = JSON.parse(await run(["/usr/local/sbin/security-operations-control", "import-log", file.name], true, archiveState.text));
      archiveElements.status.textContent = result.duplicate
        ? `This file is already audited: ${result.id} · SHA-256 ${result.sha256}`
        : `Merged and added to auditing: ${result.id} · ${formatCount(result.bytes)} bytes · SHA-256 ${result.sha256}`;
      archiveElements.mergeButton.textContent = result.duplicate ? "Already Audited" : "Merged into Current Logs";
    } catch (error) {
      archiveElements.status.textContent = `Merge failed: ${error.message || error}`;
      archiveElements.mergeButton.textContent = "Merge into Current Logs";
      archiveElements.mergeButton.disabled = false;
    }
  }

  function clearArchiveLog() {
    archiveState.selectedFile = null;
    archiveState.lines = [];
    archiveState.text = "";
    archiveElements.fileInput.value = "";
    archiveElements.fileName.textContent = "No file selected";
    archiveElements.fileName.title = "";
    archiveElements.status.textContent = "No log selected";
    archiveElements.search.value = "";
    archiveElements.search.disabled = true;
    archiveElements.position.disabled = true;
    archiveElements.readButton.disabled = true;
    archiveElements.clearButton.disabled = true;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "Merge into Current Logs";
    archiveElements.resultCount.textContent = "Reads up to 64 MiB and displays up to 20,000 lines";
    archiveElements.output.textContent = "Choose a log file, then select Read Log.";
  }

  async function refreshAll() {
    const button = document.getElementById("refresh");
    button.disabled = true;
    button.textContent = "Refreshing…";
    try {
      await Promise.allSettled([refresh(), refreshPostgres()]);
    } finally {
      button.disabled = false;
      button.textContent = "Refresh Status";
    }
  }

  function renderCard(item, status) {
    const card = document.createElement("article");
    card.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";
    const title = document.createElement("h3");
    title.textContent = item.label;
    const badge = document.createElement("span");
    badge.className = "badge " + (status === "active" ? "active" : status === "failed" ? "failed" : status === "loading" ? "loading" : "inactive");
    badge.textContent = statusLabel(status);
    top.append(title, badge);

    const description = document.createElement("p");
    description.textContent = item.description;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const logs = document.createElement("button");
    logs.type = "button";
    logs.dataset.action = "logs";
    logs.dataset.unit = item.unit;
    logs.textContent = "Recent Logs";
    actions.append(logs);

    if (item.restart) {
      const restart = document.createElement("button");
      restart.type = "button";
      restart.dataset.action = "restart";
      restart.dataset.unit = item.unit;
      restart.textContent = "Restart Service";
      actions.append(restart);
    }

    card.append(top, description, actions);
    return card;
  }

  function show(text) {
    output.textContent = text || "Action completed.";
    output.scrollTop = output.scrollHeight;
  }

  async function refresh() {
    grid.replaceChildren(...services.map(item => renderCard(item, "loading")));
    const results = await Promise.all(services.map(async item => {
      try {
        return (await run(["/usr/bin/systemctl", "is-active", item.unit], false)).trim() || "inactive";
      } catch (error) {
        return String(error.message || "inactive").trim() === "failed" ? "failed" : "inactive";
      }
    }));
    grid.replaceChildren(...services.map((item, index) => renderCard(item, results[index])));
    updated.textContent = "Updated " + new Date().toLocaleTimeString("en-US");
  }

  async function privilegedAction(button, args, successMessage) {
    button.disabled = true;
    show("Running…");
    try {
      const text = await run(args, true);
      show((text && text.trim()) || successMessage);
      await refresh();
    } catch (error) {
      show("Action failed: " + (error.message || error));
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "refresh") return refreshAll();
    if (button.id === "postgres-read-log") return readSelectedPostgresLog();
    if (button.id === "postgres-live-log") return showLivePostgresLog();
    if (button.id === "postgres-save-log") return saveCurrentPostgresLog();
    if (button.id === "archive-read-log") return readArchiveLog();
    if (button.id === "archive-merge-log") return mergeArchiveLog();
    if (button.id === "archive-clear-log") return clearArchiveLog();
    if (button.id === "clear-output") return show("Waiting for an action…");
    if (button.dataset.jump) return cockpit.jump(button.dataset.jump);

    const action = button.dataset.action;
    const unit = button.dataset.unit;
    if (action === "logs" && serviceByUnit.has(unit)) {
      await privilegedAction(button, ["/usr/bin/journalctl", "-u", unit, "-n", "40", "--no-pager", "-o", "short-iso"], "No recent logs.");
    } else if (action === "restart" && serviceByUnit.get(unit)?.restart) {
      if (window.confirm("Restart “" + serviceByUnit.get(unit).label + "”?"))
        await privilegedAction(button, ["/usr/bin/systemctl", "restart", unit], "Service restarted.");
    } else if (action === "ufw") {
      await privilegedAction(button, ["/usr/sbin/ufw", "status", "verbose"], "Firewall status loaded.");
    } else if (action === "fail2ban") {
      await privilegedAction(button, ["/usr/bin/fail2ban-client", "status", "sshd"], "Fail2ban status loaded.");
    } else if (action === "audit") {
      await privilegedAction(button, ["/usr/sbin/auditctl", "-l"], "Audit rules loaded.");
    }
  });

  postgresElements.fileInput.addEventListener("change", () => {
    const file = postgresElements.fileInput.files?.[0] || null;
    postgresState.selectedFile = file;
    postgresElements.readButton.disabled = !file;
    postgresElements.fileName.textContent = file ? file.name : "No file selected";
    postgresElements.fileName.title = file?.name || "";
    postgresElements.fileStatus.textContent = file ? `Selected ${file.name} (${formatCount(file.size)} bytes)` : "";
  });
  archiveElements.fileInput.addEventListener("change", () => {
    const file = archiveElements.fileInput.files?.[0] || null;
    archiveState.selectedFile = file;
    archiveState.text = "";
    archiveState.lines = [];
    archiveElements.readButton.disabled = !file;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "Merge into Current Logs";
    archiveElements.fileName.textContent = file ? file.name : "No file selected";
    archiveElements.fileName.title = file?.name || "";
    archiveElements.status.textContent = file ? `Selected ${file.name} (${formatCount(file.size)} bytes)` : "No log selected";
  });
  archiveElements.search.addEventListener("input", () => {
    window.clearTimeout(archiveSearchTimer);
    archiveSearchTimer = window.setTimeout(renderArchiveLog, 160);
  });
  archiveElements.position.addEventListener("change", renderArchiveLog);
  postgresElements.period.addEventListener("change", renderPostgresChart);
  refreshAll();
  window.setInterval(refresh, 30000);
})();
