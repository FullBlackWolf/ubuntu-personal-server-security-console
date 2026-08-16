(function () {
  "use strict";

  const services = [
    { unit: "ufw.service", label: "UFW 防火墙", description: "默认拒绝入站；外部 RDP 明确阻止。", restart: false },
    { unit: "fail2ban.service", label: "Fail2ban", description: "监控 SSH 登录失败并自动封禁攻击来源。", restart: true },
    { unit: "auditd.service", label: "auditd 审计", description: "记录关键安全事件和敏感配置变更。", restart: false },
    { unit: "apparmor.service", label: "AppArmor", description: "限制受保护程序可访问的系统资源。", restart: false },
    { unit: "unattended-upgrades.service", label: "自动安全更新", description: "自动安装 Ubuntu 安全更新，不自动重启。", restart: false },
    { unit: "guest-command-approval.service", label: "访客命令审批", description: "guestuser 的受限命令请求、日志与白名单服务。", restart: true },
    { unit: "fwknop-server.service", label: "SPA 敲门", description: "认证敲门后临时开放 SSH，并支持逐公钥会话门禁。", restart: true },
    { unit: "ssh.socket", label: "OpenSSH", description: "仅允许密钥认证；root 登录已禁止。", restart: false },
    { unit: "xrdp.service", label: "xrdp", description: "RDP 仅供 SSH 隧道访问，外部端口被防火墙阻止。", restart: true },
    { unit: "cockpit.socket", label: "Cockpit 控制台", description: "本机服务器管理与安全控制中心。", restart: false }
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
    return ({ active: "运行中", inactive: "未运行", failed: "失败", loading: "检查中" })[status] || status;
  }

  function formatCount(value) {
    return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || "—") : date.toLocaleString("zh-CN", { hour12: false });
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
    return Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
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
      empty.textContent = "此时间范围内没有可用数据";
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
        ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", hour12: false })
        : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", hour12: false });
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
      tooltip.textContent = `${formatDateTime(item.hour)} · ${formatRate(item.per_minute)} / min（${formatCount(item.count)} 条）`;
      tooltip.style.left = `${Math.min(window.innerWidth - tooltip.offsetWidth - 8, event.clientX + 12)}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - 38)}px`;
    });
    hitbox.addEventListener("mouseleave", () => {
      focusLine.style.display = "none";
      focusDot.style.display = "none";
      tooltip.hidden = true;
    });
    postgresElements.chart.append(svg, tooltip);
    postgresElements.chart.setAttribute("aria-label", `最近 ${days} 天 PostgreSQL 每分钟错误趋势，共 ${total} 条错误`);
    postgresElements.chartSummary.textContent = `${formatCount(total)} 条错误 · 峰值 ${formatRate(Math.max(...values))} / min`;
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
    if (!logs.length) return renderEmptyRow(postgresElements.fatalRows, 5, "最近 30 天没有 PostgreSQL FATAL 日志");
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
    const rangePrefix = report.imported ? `截至 ${formatDateTime(report.range_end)} 的 30 天` : "最近 30 天";
    document.getElementById("postgres-auth-note").textContent = `${rangePrefix}共 ${formatCount(report.auth_failures["30d"])} 次；仅统计 FATAL 级别的认证拒绝。`;
    postgresElements.fatalCount.textContent = `${rangePrefix} ${formatCount(report.fatal_logs.length)} 条，最多显示 100 条`;
    renderFatalLogs(report.fatal_logs);
    renderRanking(postgresElements.userRows, report.failed_login_users, "没有可识别的失败登录用户");
    renderRanking(postgresElements.ipRows, report.failed_login_ips, "没有可识别的失败登录来源 IP");
    renderPostgresChart();
    const sourceNote = report.sources.length ? (report.imported ? `旧日志 ${report.sources[0]}` : `数据源 ${report.sources.length} 个`) : "未发现 PostgreSQL 日志源";
    const limited = report.data_limited ? "；数据达到读取上限" : "";
    postgresElements.updated.textContent = report.imported
      ? `${sourceNote} · 日志截止 ${formatDateTime(report.range_end)}${limited}`
      : `统计生成于 ${formatDateTime(report.generated_at)} · ${sourceNote}${limited}`;
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
    if (!validPostgresReport(report)) throw new Error("报表程序返回了无效数据");
    postgresState.liveReport = report;
    return report;
  }

  async function refreshPostgres() {
    postgresElements.updated.textContent = "正在读取最近 30 天 PostgreSQL 日志…";
    try {
      renderPostgresReport(await fetchLivePostgresReport());
    } catch (error) {
      postgresState.report = null;
      postgresElements.updated.textContent = `PostgreSQL 统计加载失败：${error.message || error}`;
      document.getElementById("postgres-auth-1h").textContent = "—";
      document.getElementById("postgres-auth-24h").textContent = "—";
      document.getElementById("postgres-auth-1h-bar").style.width = "0";
      document.getElementById("postgres-auth-24h-bar").style.width = "0";
      document.getElementById("postgres-auth-note").textContent = "无法读取 PostgreSQL 认证失败统计。";
      postgresElements.chartSummary.textContent = "统计加载失败";
      postgresElements.fatalCount.textContent = "无法读取最近日志";
      postgresElements.chart.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "empty-chart";
      empty.textContent = "无法读取 PostgreSQL 日志统计";
      postgresElements.chart.append(empty);
      renderEmptyRow(postgresElements.fatalRows, 5, "统计加载失败");
      renderEmptyRow(postgresElements.userRows, 3, "统计加载失败");
      renderEmptyRow(postgresElements.ipRows, 3, "统计加载失败");
    }
  }

  async function readFileBytes(file) {
    if (file.size > maxUploadBytes) throw new Error("文件超过 64 MiB 读取上限");
    if (!file.name.toLowerCase().endsWith(".gz") && file.type !== "application/gzip") {
      return new Uint8Array(await file.arrayBuffer());
    }
    if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器不支持读取 gzip，请先解压文件");
    const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxUploadBytes) {
        await reader.cancel();
        throw new Error("解压后的日志超过 64 MiB 读取上限");
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
    postgresElements.fileStatus.textContent = `正在读取 ${file.name}…`;
    try {
      const text = await readFileText(file);
      if (new Blob([text]).size > maxUploadBytes) throw new Error("日志超过 64 MiB 读取上限");
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
      if (!validPostgresReport(report)) throw new Error("未能从文件生成有效的 PostgreSQL 报表");
      renderPostgresReport(report);
      postgresElements.fileStatus.textContent = `已读取 ${file.name}；当前图表显示旧日志，点击“返回当前日志”可切换。`;
    } catch (error) {
      postgresElements.fileStatus.textContent = `读取失败：${error.message || error}`;
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
          types: [{ description: "PostgreSQL 安全日志快照", accept: { "application/json": [".json"] } }]
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
    postgresElements.fileStatus.textContent = "正在读取最新日志并准备保存…";
    try {
      const liveReport = await fetchLivePostgresReport();
      if (!postgresState.report?.imported) renderPostgresReport(liveReport);
      const savedAt = new Date().toISOString();
      const contents = JSON.stringify({ schema: "postgresql-security-snapshot-v1", saved_at: savedAt, report: liveReport }, null, 2) + "\n";
      const name = snapshotFilename();
      await writeSnapshotFile(name, contents);
      postgresElements.fileStatus.textContent = `已保存最新日志快照：${name}`;
    } catch (error) {
      postgresElements.fileStatus.textContent = error?.name === "AbortError" ? "已取消保存" : `保存失败：${error.message || error}`;
    } finally {
      postgresElements.saveButton.disabled = false;
    }
  }

  async function showLivePostgresLog() {
    postgresElements.fileStatus.textContent = "正在返回当前日志…";
    try {
      const report = postgresState.liveReport || await fetchLivePostgresReport();
      renderPostgresReport(report);
      postgresElements.fileStatus.textContent = "已切换回当前 PostgreSQL 日志。";
    } catch (error) {
      postgresElements.fileStatus.textContent = `切换失败：${error.message || error}`;
    }
  }

  function archiveMatchingLines(term, position) {
    const lines = archiveState.lines;
    if (!term) {
      const start = position === "tail" ? Math.max(0, lines.length - archiveDisplayLineLimit) : 0;
      return { shown: lines.slice(start, start + archiveDisplayLineLimit), total: lines.length, start };
    }
    const lowered = term.toLocaleLowerCase("zh-CN");
    let total = 0;
    for (const line of lines) {
      if (line.toLocaleLowerCase("zh-CN").includes(lowered)) total += 1;
    }
    const shown = [];
    if (position === "head") {
      for (let index = 0; index < lines.length && shown.length < archiveDisplayLineLimit; index += 1) {
        if (lines[index].toLocaleLowerCase("zh-CN").includes(lowered)) shown.push(lines[index]);
      }
    } else {
      for (let index = lines.length - 1; index >= 0 && shown.length < archiveDisplayLineLimit; index -= 1) {
        if (lines[index].toLocaleLowerCase("zh-CN").includes(lowered)) shown.push(lines[index]);
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
        ? "…内容过长，已截取末尾…\n" + display.slice(-archiveDisplayCharacterLimit)
        : display.slice(0, archiveDisplayCharacterLimit) + "\n…内容过长，已截取开头…";
    }
    archiveElements.output.textContent = display || "没有匹配的日志行。";
    if (term) {
      archiveElements.resultCount.textContent = `匹配 ${formatCount(result.total)} 行，显示 ${formatCount(result.shown.length)} 行${characterLimited ? "；正文达到 4 MiB 显示上限" : ""}`;
    } else {
      const first = result.shown.length ? result.start + 1 : 0;
      const last = result.start + result.shown.length;
      archiveElements.resultCount.textContent = `共 ${formatCount(result.total)} 行，显示第 ${formatCount(first)}–${formatCount(last)} 行${characterLimited ? "；正文达到 4 MiB 显示上限" : ""}`;
    }
    if (position === "tail") archiveElements.output.scrollTop = archiveElements.output.scrollHeight;
    else archiveElements.output.scrollTop = 0;
  }

  async function readArchiveLog() {
    const file = archiveState.selectedFile;
    if (!file) return;
    archiveElements.readButton.disabled = true;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "一键合并到现有日志中";
    archiveElements.status.textContent = `正在读取 ${file.name}…`;
    try {
      const text = await readFileText(file, archiveElements.encoding.value);
      archiveState.text = text;
      archiveState.lines = text.split(/\r\n|\n|\r/);
      archiveElements.search.disabled = false;
      archiveElements.position.disabled = false;
      archiveElements.clearButton.disabled = false;
      archiveElements.mergeButton.disabled = false;
      archiveElements.status.textContent = `已读取 ${file.name} · ${formatCount(file.size)} 字节 · ${formatCount(archiveState.lines.length)} 行${text.includes("\x00") ? " · 检测到二进制内容，显示可能不完整" : ""}`;
      renderArchiveLog();
    } catch (error) {
      archiveElements.status.textContent = `读取失败：${error.message || error}`;
      archiveElements.output.textContent = "无法读取所选日志。";
    } finally {
      archiveElements.readButton.disabled = false;
    }
  }

  async function mergeArchiveLog() {
    const file = archiveState.selectedFile;
    if (!file || !archiveState.text) return;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "正在合并…";
    archiveElements.status.textContent = `正在将 ${file.name} 写入受管审计日志…`;
    try {
      const result = JSON.parse(await run(["/usr/local/sbin/security-operations-control", "import-log", file.name], true, archiveState.text));
      archiveElements.status.textContent = result.duplicate
        ? `该文件已在审计中：${result.id} · SHA-256 ${result.sha256}`
        : `已合并并加入审计：${result.id} · ${formatCount(result.bytes)} 字节 · SHA-256 ${result.sha256}`;
      archiveElements.mergeButton.textContent = result.duplicate ? "已存在于审计中" : "已合并到现有日志";
    } catch (error) {
      archiveElements.status.textContent = `合并失败：${error.message || error}`;
      archiveElements.mergeButton.textContent = "一键合并到现有日志中";
      archiveElements.mergeButton.disabled = false;
    }
  }

  function clearArchiveLog() {
    archiveState.selectedFile = null;
    archiveState.lines = [];
    archiveState.text = "";
    archiveElements.fileInput.value = "";
    archiveElements.fileName.textContent = "尚未选择文件";
    archiveElements.fileName.title = "";
    archiveElements.status.textContent = "尚未选择日志";
    archiveElements.search.value = "";
    archiveElements.search.disabled = true;
    archiveElements.position.disabled = true;
    archiveElements.readButton.disabled = true;
    archiveElements.clearButton.disabled = true;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "一键合并到现有日志中";
    archiveElements.resultCount.textContent = "单次读取最多 64 MiB，页面最多显示 20,000 行";
    archiveElements.output.textContent = "选择日志文件后点击“读取日志”。";
  }

  async function refreshAll() {
    const button = document.getElementById("refresh");
    button.disabled = true;
    button.textContent = "正在刷新…";
    try {
      await Promise.allSettled([refresh(), refreshPostgres()]);
    } finally {
      button.disabled = false;
      button.textContent = "刷新状态";
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
    logs.textContent = "最近日志";
    actions.append(logs);

    if (item.restart) {
      const restart = document.createElement("button");
      restart.type = "button";
      restart.dataset.action = "restart";
      restart.dataset.unit = item.unit;
      restart.textContent = "重启服务";
      actions.append(restart);
    }

    card.append(top, description, actions);
    return card;
  }

  function show(text) {
    output.textContent = text || "操作完成。";
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
    updated.textContent = "更新于 " + new Date().toLocaleTimeString();
  }

  async function privilegedAction(button, args, successMessage) {
    button.disabled = true;
    show("正在执行…");
    try {
      const text = await run(args, true);
      show((text && text.trim()) || successMessage);
      await refresh();
    } catch (error) {
      show("操作失败：" + (error.message || error));
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
    if (button.id === "clear-output") return show("等待操作…");
    if (button.dataset.jump) return cockpit.jump(button.dataset.jump);

    const action = button.dataset.action;
    const unit = button.dataset.unit;
    if (action === "logs" && serviceByUnit.has(unit)) {
      await privilegedAction(button, ["/usr/bin/journalctl", "-u", unit, "-n", "40", "--no-pager", "-o", "short-iso"], "没有近期日志。");
    } else if (action === "restart" && serviceByUnit.get(unit)?.restart) {
      if (window.confirm("确定要重启“" + serviceByUnit.get(unit).label + "”吗？"))
        await privilegedAction(button, ["/usr/bin/systemctl", "restart", unit], "服务已重启。");
    } else if (action === "ufw") {
      await privilegedAction(button, ["/usr/sbin/ufw", "status", "verbose"], "防火墙状态已读取。");
    } else if (action === "fail2ban") {
      await privilegedAction(button, ["/usr/bin/fail2ban-client", "status", "sshd"], "Fail2ban 状态已读取。");
    } else if (action === "audit") {
      await privilegedAction(button, ["/usr/sbin/auditctl", "-l"], "审计规则已读取。");
    }
  });

  postgresElements.fileInput.addEventListener("change", () => {
    const file = postgresElements.fileInput.files?.[0] || null;
    postgresState.selectedFile = file;
    postgresElements.readButton.disabled = !file;
    postgresElements.fileName.textContent = file ? file.name : "尚未选择文件";
    postgresElements.fileName.title = file?.name || "";
    postgresElements.fileStatus.textContent = file ? `已选择 ${file.name}（${formatCount(file.size)} 字节）` : "";
  });
  archiveElements.fileInput.addEventListener("change", () => {
    const file = archiveElements.fileInput.files?.[0] || null;
    archiveState.selectedFile = file;
    archiveState.text = "";
    archiveState.lines = [];
    archiveElements.readButton.disabled = !file;
    archiveElements.mergeButton.disabled = true;
    archiveElements.mergeButton.textContent = "一键合并到现有日志中";
    archiveElements.fileName.textContent = file ? file.name : "尚未选择文件";
    archiveElements.fileName.title = file?.name || "";
    archiveElements.status.textContent = file ? `已选择 ${file.name}（${formatCount(file.size)} 字节）` : "尚未选择日志";
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
