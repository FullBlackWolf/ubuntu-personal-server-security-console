(function () {
  "use strict";

  const REPORT = "/usr/local/libexec/security-operations-report";
  const CONTROL = "/usr/local/sbin/security-operations-control";
  const state = { report: null, settings: null, events: [], visible: 150, selectedEventId: null, reviewer: "cockpit-admin" };
  const byId = id => document.getElementById(id);
  const elements = {
    refresh: byId("refresh"), generated: byId("center-generated"), alertList: byId("alert-list"), alertCount: byId("alert-count"),
    correlationList: byId("correlation-list"), period: byId("timeline-period"), risk: byId("timeline-risk"), category: byId("timeline-category"),
    search: byId("timeline-search"), rows: byId("timeline-rows"), count: byId("timeline-count"), more: byId("timeline-more"),
    savedFilter: byId("saved-filter"), deleteFilter: byId("delete-filter"), archiveRows: byId("archive-rows"),
    eventDialog: byId("center-event-dialog"), dialogTitle: byId("center-dialog-title"), dialogMeta: byId("center-dialog-meta"),
    dialogLog: byId("center-dialog-log"), context: byId("context-events"), openHigh: byId("open-high-event"),
    configDialog: byId("config-dialog"), configForm: byId("config-form"), configStatus: byId("config-status")
  };

  function run(args, input) {
    const process = cockpit.spawn(args, { superuser: "require", err: "message" });
    if (input !== undefined) process.input(JSON.stringify(input));
    return process;
  }

  function number(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || "—") : date.toLocaleString("zh-CN", { hour12: false });
  }
  function bytes(value) {
    const amount = Number(value) || 0;
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let index = 0, size = amount;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return `${size.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} ${units[index]}`;
  }
  function textCell(row, value, className) {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (className) cell.className = className;
    row.append(cell);
  }
  function empty(container, message) {
    const node = document.createElement("p"); node.className = "empty"; node.textContent = message; container.replaceChildren(node);
  }

  function setHealth(name, status, detail, level) {
    const card = byId(`health-${name}`);
    card.className = `health-card ${level}`;
    byId(`health-${name}-status`).textContent = status;
    const detailNode = byId(`health-${name}-detail`);
    if (detailNode) detailNode.textContent = detail;
  }

  function renderHealth() {
    const health = state.report.health;
    const audit = health.auditd;
    const auditGood = audit.status === "active" && audit.lost === 0;
    setHealth("auditd", audit.status === "active" ? "运行中" : audit.status, `丢失 ${audit.lost ?? "—"} · backlog ${audit.backlog ?? "—"}/${audit.backlog_limit ?? "—"}`, auditGood ? "good" : audit.lost > 0 ? "bad" : "warning");
    const journalGood = health.journald.status === "active";
    setHealth("journal", journalGood ? "运行中" : health.journald.status, `${health.journald.disk_usage} · ${formatTime(health.journald.latest)}`, journalGood ? "good" : "bad");
    const storageLevel = health.storage.percent_used >= 95 ? "bad" : health.storage.percent_used >= 85 ? "warning" : "good";
    setHealth("storage", `${health.storage.percent_used}% 已用`, `剩余 ${bytes(health.storage.free)}`, storageLevel);
    setHealth("clock", health.clock.ntp_synchronized === true ? "已同步" : health.clock.ntp_synchronized === false ? "未同步" : "未知", "NTP 同步状态", health.clock.ntp_synchronized === true ? "good" : "warning");
    const archives = health.archives;
    setHealth("archive", `${number(archives.valid)}/${number(archives.count)} 有效`, archives.invalid ? `${archives.invalid} 个校验失败` : `最近 ${formatTime(archives.latest)}`, archives.invalid ? "bad" : archives.count ? "good" : "warning");
    const imports = health.imports;
    setHealth("imports", `${number(imports.valid)}/${number(imports.count)} 有效`, `${imports.invalid} 个损坏${imports.lines_limited ? " · 行数达到上限" : ""}`, imports.invalid ? "bad" : imports.count ? "good" : "warning");
    const pg = state.report.postgresql.auth_failures || {};
    setHealth("postgres", `${number(pg["1h"])} / ${number(pg["24h"])}`, `FATAL ${number(state.report.postgresql.fatal_count)} · 数据源 ${number(state.report.postgresql.sources.length)}`, Number(pg["1h"]) > 0 ? "warning" : "good");
  }

  function notifyAlerts(alerts) {
    if (!state.settings.config.browser_notifications || window.Notification?.permission !== "granted") return;
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem("security-center-seen-alerts") || "[]"); } catch (_) { seen = []; }
    const known = new Set(seen);
    for (const alert of alerts) {
      if (!known.has(alert.id)) new Notification(alert.title, { body: alert.description, tag: alert.id });
      known.add(alert.id);
    }
    localStorage.setItem("security-center-seen-alerts", JSON.stringify(Array.from(known).slice(-500)));
  }

  function renderAlerts() {
    const alerts = state.report.alerts || [];
    elements.alertCount.textContent = `${number(alerts.length)} 条活动告警`;
    elements.alertList.replaceChildren();
    for (const alert of alerts) {
      const button = document.createElement("button");
      button.type = "button"; button.className = `alert-item ${alert.severity}`; button.dataset.alertId = alert.id;
      const title = document.createElement("strong"); title.textContent = `${alert.severity === "high" ? "高" : "关注"} · ${alert.title}`;
      const detail = document.createElement("span"); detail.textContent = alert.description;
      const meta = document.createElement("span"); meta.textContent = `${formatTime(alert.latest_at)} · ${number(alert.count)} 条`;
      button.append(title, detail, meta); elements.alertList.append(button);
    }
    if (!alerts.length) empty(elements.alertList, "当前没有规则命中的活动告警");
    notifyAlerts(alerts);
  }

  function renderCorrelations() {
    const correlations = state.report.correlations || [];
    elements.correlationList.replaceChildren();
    for (const item of correlations) {
      const button = document.createElement("button"); button.type = "button"; button.className = "correlation-item"; button.dataset.correlationId = item.id;
      const title = document.createElement("strong"); title.textContent = `${item.identity_type} ${item.identity} · ${number(item.count)} 条`;
      const time = document.createElement("span"); time.textContent = `${formatTime(item.start_at)} → ${formatTime(item.end_at)}`;
      const categories = document.createElement("span"); categories.className = "correlation-categories"; categories.textContent = item.categories.join(" → ");
      button.append(title, time, categories); elements.correlationList.append(button);
    }
    if (!correlations.length) empty(elements.correlationList, "没有发现跨类别关联事件链");
  }

  function allEvents() {
    const unique = new Map();
    for (const event of [...(state.report.events || []), ...(state.report.imported_events || [])]) unique.set(event.id, event);
    return Array.from(unique.values()).sort((a, b) => b.epoch_ms - a.epoch_ms);
  }

  function filteredEvents() {
    const days = elements.period.value;
    const cutoff = days === "all" ? -Infinity : Date.now() - Number(days) * 86_400_000;
    const term = elements.search.value.trim().toLocaleLowerCase("zh-CN");
    return state.events.filter(event => event.epoch_ms >= cutoff && (!elements.risk.value || event.risk === elements.risk.value) && (!elements.category.value || event.category === elements.category.value) && (!term || [event.category, event.title, event.actor, event.source, event.target, event.detail].join(" ").toLocaleLowerCase("zh-CN").includes(term)));
  }

  function renderTimeline() {
    const events = filteredEvents();
    const shown = events.slice(0, state.visible);
    elements.rows.replaceChildren();
    for (const event of shown) {
      const row = document.createElement("tr");
      textCell(row, formatTime(event.timestamp), "time-cell");
      const riskCell = document.createElement("td"); const risk = document.createElement("span"); risk.className = `risk-tag ${event.risk}`; risk.textContent = event.risk === "high" ? "高风险" : event.risk === "suspicious" ? "可疑" : "导入"; riskCell.append(risk); row.append(riskCell);
      const severityCell = document.createElement("td"); const severity = document.createElement("span"); severity.className = `severity ${event.severity}`; severity.textContent = event.severity === "high" ? "高" : "关注"; severityCell.append(severity); row.append(severityCell);
      textCell(row, event.category); textCell(row, event.source !== "—" ? event.source : event.actor);
      const summary = document.createElement("td"); summary.className = "target-cell"; const strong = document.createElement("strong"); strong.textContent = event.title; const target = document.createElement("span"); target.textContent = event.target; summary.append(strong, target); row.append(summary);
      const detailCell = document.createElement("td"); const button = document.createElement("button"); button.className = "log-button"; button.type = "button"; button.dataset.eventId = event.id; button.textContent = "查看上下文"; detailCell.append(button); row.append(detailCell); elements.rows.append(row);
    }
    if (!shown.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 7; cell.className = "empty"; cell.textContent = "当前筛选条件下没有事件"; row.append(cell); elements.rows.append(row); }
    elements.count.textContent = `匹配 ${number(events.length)} 条，显示 ${number(shown.length)} 条${state.report.details_limited ? "；系统事件详情达到读取上限" : ""}`;
    elements.more.classList.toggle("hidden", shown.length >= events.length);
  }

  function renderCategories() {
    const previous = elements.category.value;
    const categories = Array.from(new Set(state.events.map(event => event.category))).sort((a, b) => a.localeCompare(b, "zh-CN"));
    elements.category.replaceChildren(new Option("全部类别", ""), ...categories.map(value => new Option(value, value))); elements.category.value = previous;
  }

  function addMeta(label, value) { const dtNode = document.createElement("dt"); dtNode.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; elements.dialogMeta.append(dtNode, dd); }
  function openEvent(eventId) {
    const event = state.events.find(item => item.id === eventId); if (!event) return;
    state.selectedEventId = eventId; elements.dialogTitle.textContent = event.title; elements.dialogMeta.replaceChildren();
    addMeta("时间", formatTime(event.timestamp)); addMeta("类型/级别", `${event.risk} / ${event.severity}`); addMeta("类别", event.category); addMeta("用户/来源", `${event.actor} / ${event.source}`); addMeta("目标", event.target); addMeta("日志引用", event.log_ref);
    if (event.imported_at) addMeta("导入时间", formatTime(event.imported_at));
    elements.dialogLog.textContent = event.detail || "没有日志正文。"; elements.context.replaceChildren();
    const related = state.events.filter(item => item.id !== event.id && Math.abs(item.epoch_ms - event.epoch_ms) <= 600_000).slice(0, 50);
    for (const item of related) { const node = document.createElement("div"); node.className = "context-item"; node.textContent = `${formatTime(item.timestamp)} · ${item.category} · ${item.source !== "—" ? item.source : item.actor} · ${item.title}`; elements.context.append(node); }
    if (!related.length) empty(elements.context, "前后 10 分钟没有其他已载入事件");
    elements.openHigh.hidden = event.risk !== "high"; elements.eventDialog.showModal();
  }

  function renderArchives(archives) {
    elements.archiveRows.replaceChildren();
    for (const item of archives || []) { const row = document.createElement("tr"); textCell(row, item.name || "—"); textCell(row, formatTime(item.created_at)); textCell(row, bytes(item.bytes)); textCell(row, item.valid ? "校验通过" : `校验失败${item.error ? "：" + item.error : ""}`, item.valid ? "integrity-valid" : "integrity-invalid"); elements.archiveRows.append(row); }
    if (!archives?.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 4; cell.className = "empty"; cell.textContent = "尚无归档；可点击“立即归档并校验”创建"; row.append(cell); elements.archiveRows.append(row); }
  }

  function renderSavedFilters() {
    const previous = elements.savedFilter.value; const filters = state.settings.saved_filters || [];
    elements.savedFilter.replaceChildren(new Option("保存的筛选器", ""), ...filters.map(item => new Option(item.name, item.name))); elements.savedFilter.value = previous; elements.deleteFilter.disabled = !elements.savedFilter.value;
  }

  function fillConfig() {
    const form = elements.configForm.elements, config = state.settings.config, threshold = config.thresholds;
    form.retention_days.value = config.retention_days || 30;
    for (const name of ["auth_failures_10m", "firewall_blocks_10m", "postgres_auth_failures_1h"]) form[name].value = threshold[name];
    for (const name of ["new_remote_source", "off_hours_root", "security_config_change"]) form[name].checked = Boolean(threshold[name]);
    form.off_hours_start.value = config.off_hours.start; form.off_hours_end.value = config.off_hours.end;
    form.whitelist_actors.value = config.whitelist.actors.join("\n"); form.whitelist_sources.value = config.whitelist.sources.join("\n"); form.whitelist_categories.value = config.whitelist.categories.join("\n"); form.browser_notifications.checked = config.browser_notifications;
    const notification = config.notifications || {};
    form.webhook_enabled.checked = Boolean(notification.webhook_enabled); form.webhook_url.value = notification.webhook_url || "";
    form.email_enabled.checked = Boolean(notification.email_enabled); form.email_to.value = notification.email_to || "";
  }

  async function refresh() {
    elements.refresh.disabled = true; elements.refresh.textContent = "正在分析…"; elements.generated.textContent = "正在读取日志、服务状态和完整性数据…";
    try {
      const [reportText, stateText] = await Promise.all([run([REPORT, "center"]), run([CONTROL, "state"])]);
      state.report = JSON.parse(reportText); state.settings = JSON.parse(stateText); state.events = allEvents(); state.visible = 150;
      renderHealth(); renderAlerts(); renderCorrelations(); renderCategories(); renderTimeline(); renderArchives(state.settings.archives); renderSavedFilters(); fillConfig();
      elements.generated.textContent = `统计生成于 ${formatTime(state.report.generated_at)} · 保留 ${state.settings.config.retention_days || 30} 天 · 统一事件 ${number(state.events.length)} 条`;
    } catch (error) { elements.generated.textContent = `事件中心加载失败：${error.message || error}`; }
    finally { elements.refresh.disabled = false; elements.refresh.textContent = "刷新事件中心"; }
  }

  function currentFilter() { return { period: elements.period.value, category: elements.category.value, severity: "", review: elements.risk.value, search: elements.search.value }; }
  function lines(value) { return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean); }

  async function saveConfig(event) {
    event.preventDefault(); const form = elements.configForm.elements; elements.configStatus.textContent = "正在保存并应用保留策略…";
    const payload = { reviewer: state.reviewer, retention_days: Number(form.retention_days.value), thresholds: {}, off_hours: { start: Number(form.off_hours_start.value), end: Number(form.off_hours_end.value) }, whitelist: { actors: lines(form.whitelist_actors.value), sources: lines(form.whitelist_sources.value), categories: lines(form.whitelist_categories.value) }, browser_notifications: form.browser_notifications.checked, notifications: { webhook_enabled: form.webhook_enabled.checked, webhook_url: form.webhook_url.value.trim(), email_enabled: form.email_enabled.checked, email_to: form.email_to.value.trim() } };
    for (const name of ["auth_failures_10m", "firewall_blocks_10m", "postgres_auth_failures_1h"]) payload.thresholds[name] = Number(form[name].value);
    for (const name of ["new_remote_source", "off_hours_root", "security_config_change"]) payload.thresholds[name] = form[name].checked;
    try { state.settings.config = JSON.parse(await run([CONTROL, "config"], payload)); elements.configStatus.textContent = "设置已保存；journald 与清理策略已经更新。"; window.setTimeout(() => { elements.configDialog.close(); refresh(); }, 700); }
    catch (error) { elements.configStatus.textContent = `保存失败：${error.message || error}`; }
  }

  async function archiveNow() { const button = byId("create-archive"); button.disabled = true; button.textContent = "正在归档…"; try { const result = JSON.parse(await run([CONTROL, "archive", "manual"])); elements.generated.textContent = `归档完成：${result.archive} · SHA-256 ${result.checksum}`; state.settings.archives = JSON.parse(await run([CONTROL, "verify"])); renderArchives(state.settings.archives); } catch (error) { elements.generated.textContent = `归档失败：${error.message || error}`; } finally { button.disabled = false; button.textContent = "立即归档并校验"; } }
  async function verifyArchives() { try { state.settings.archives = JSON.parse(await run([CONTROL, "verify"])); renderArchives(state.settings.archives); } catch (error) { elements.generated.textContent = `校验失败：${error.message || error}`; } }

  document.addEventListener("click", async event => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.jump) return cockpit.jump(button.dataset.jump);
    if (button.dataset.eventId) return openEvent(button.dataset.eventId);
    if (button.dataset.alertId) { const alert = state.report.alerts.find(item => item.id === button.dataset.alertId); if (alert?.event_ids?.[0]) openEvent(alert.event_ids[0]); return; }
    if (button.dataset.correlationId) { const item = state.report.correlations.find(entry => entry.id === button.dataset.correlationId); elements.period.value = "30"; elements.search.value = item.identity; state.visible = 150; renderTimeline(); return; }
    if (button.id === "refresh") return refresh();
    if (button.id === "create-archive") return archiveNow();
    if (button.id === "verify-archives") return verifyArchives();
    if (button.id === "open-config") { fillConfig(); elements.configStatus.textContent = ""; return elements.configDialog.showModal(); }
    if (button.id === "enable-notifications") { if (!("Notification" in window)) { elements.generated.textContent = "当前浏览器不支持桌面通知。"; return; } const permission = await Notification.requestPermission(); elements.generated.textContent = permission === "granted" ? "桌面通知已启用。" : "桌面通知未获授权。"; return; }
    if (["center-dialog-close", "center-dialog-close-bottom"].includes(button.id)) return elements.eventDialog.close();
    if (["config-close", "config-cancel"].includes(button.id)) return elements.configDialog.close();
    if (button.id === "open-high-event") return cockpit.jump("/security_operations/high-risk-operations");
    if (button.id === "timeline-more") { state.visible += 150; return renderTimeline(); }
    if (button.id === "timeline-export") { const content = JSON.stringify({ exported_at: new Date().toISOString(), filters: currentFilter(), events: filteredEvents() }, null, 2); const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `security-timeline-${Date.now()}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
    if (button.id === "save-filter") { const name = window.prompt("筛选器名称："); if (!name) return; state.settings.saved_filters = JSON.parse(await run([CONTROL, "save-filter"], { name, filters: currentFilter(), reviewer: state.reviewer })); renderSavedFilters(); return; }
    if (button.id === "delete-filter" && elements.savedFilter.value) { state.settings.saved_filters = JSON.parse(await run([CONTROL, "delete-filter"], { name: elements.savedFilter.value, reviewer: state.reviewer })); elements.savedFilter.value = ""; renderSavedFilters(); }
  });

  [elements.period, elements.risk, elements.category].forEach(node => node.addEventListener("change", () => { state.visible = 150; renderTimeline(); }));
  elements.search.addEventListener("input", () => { state.visible = 150; renderTimeline(); });
  elements.savedFilter.addEventListener("change", () => { const item = state.settings.saved_filters.find(entry => entry.name === elements.savedFilter.value); elements.deleteFilter.disabled = !item; if (!item) return; const filter = item.filters; elements.period.value = filter.period || "7"; elements.category.value = filter.category || ""; elements.risk.value = filter.review || ""; elements.search.value = filter.search || ""; state.visible = 150; renderTimeline(); });
  elements.configForm.addEventListener("submit", saveConfig);
  elements.eventDialog.addEventListener("click", event => { if (event.target === elements.eventDialog) elements.eventDialog.close(); });
  elements.configDialog.addEventListener("click", event => { if (event.target === elements.configDialog) elements.configDialog.close(); });
  cockpit.user().then(user => { state.reviewer = user.name || user.user || state.reviewer; }).catch(() => {});
  refresh();
})();
