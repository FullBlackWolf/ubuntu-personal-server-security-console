(function () {
  "use strict";

  const mode = document.body.dataset.mode;
  const CONTROL = "/usr/local/sbin/security-operations-control";
  const state = { report: null, visible: 100, reviews: {}, selectedEventId: null, reviewer: "cockpit-admin" };
  const elements = {
    refresh: document.getElementById("refresh"),
    period: document.getElementById("period"),
    search: document.getElementById("search"),
    rows: document.getElementById("event-rows"),
    resultCount: document.getElementById("result-count"),
    loadMore: document.getElementById("load-more"),
    generated: document.getElementById("generated"),
    dialog: document.getElementById("log-dialog"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogMeta: document.getElementById("dialog-meta"),
    dialogLog: document.getElementById("dialog-log"),
    category: document.getElementById("category-filter"),
    severity: document.getElementById("severity-filter"),
    review: document.getElementById("review-filter"),
    attention: document.getElementById("attention-list"),
    toggleReview: document.getElementById("toggle-review"),
    exportCsv: document.getElementById("export-csv"),
    exportJson: document.getElementById("export-json"),
    reviewStatus: document.getElementById("review-status"),
    reviewNote: document.getElementById("review-note"),
    reviewMeta: document.getElementById("review-meta")
  };

  function spawnReport() {
    return cockpit.spawn(["/usr/local/libexec/security-operations-report", mode], {
      superuser: "require",
      err: "message"
    });
  }

  function control(action, input) {
    const process = cockpit.spawn([CONTROL, action], { superuser: "require", err: "message" });
    if (input !== undefined) process.input(JSON.stringify(input));
    return process;
  }

  function reviewRecord(eventId) { return state.reviews[eventId] || null; }
  function isResolved(eventId) { return ["reviewed", "false_positive", "resolved"].includes(reviewRecord(eventId)?.status); }
  function reviewLabel(eventId) {
    return ({ reviewed: "已复核", false_positive: "误报", resolved: "已处置", escalated: "升级调查", pending: "待复核" })[reviewRecord(eventId)?.status] || "待复核";
  }

  function number(value) {
    return new Intl.NumberFormat("zh-CN").format(value || 0);
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function renderBars(containerId, items, labelKey, valueKey) {
    const container = document.getElementById(containerId);
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "此时间范围内没有记录";
      container.append(empty);
      return;
    }
    const maximum = Math.max(...items.map(item => Number(item[valueKey]) || 0), 1);
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "bar-item";
      const label = document.createElement("span");
      label.className = "bar-label";
      label.title = String(item[labelKey]);
      label.textContent = String(item[labelKey]);
      const track = document.createElement("span");
      track.className = "bar-track";
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.style.width = `${Math.max(2, (Number(item[valueKey]) / maximum) * 100)}%`;
      track.append(fill);
      const value = document.createElement("span");
      value.className = "bar-value";
      value.textContent = number(item[valueKey]);
      row.append(label, track, value);
      container.append(row);
    }
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("zh-CN", { hour12: false });
  }

  function filteredEvents() {
    if (!state.report) return [];
    const period = elements.period.value;
    const cutoff = Date.now() - (period === "1h" ? 3_600_000 : Number(period) * 86_400_000);
    const term = elements.search.value.trim().toLocaleLowerCase("zh-CN");
    return state.report.events.filter(event => {
      if (event.epoch_ms < cutoff) return false;
      if (elements.category?.value && event.category !== elements.category.value) return false;
      if (elements.severity?.value && event.severity !== elements.severity.value) return false;
      if (elements.review?.value === "pending" && isResolved(event.id)) return false;
      if (elements.review?.value === "reviewed" && !isResolved(event.id)) return false;
      if (!term) return true;
      return [event.category, event.title, event.actor, event.source, event.target, event.detail]
        .join(" ").toLocaleLowerCase("zh-CN").includes(term);
    });
  }

  function appendCell(row, text, className) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text;
    row.append(cell);
    return cell;
  }

  function renderTable() {
    const events = filteredEvents();
    const shown = events.slice(0, state.visible);
    elements.rows.replaceChildren();
    for (const event of shown) {
      const row = document.createElement("tr");
      appendCell(row, formatTime(event.timestamp), "time-cell");

      const severityCell = document.createElement("td");
      const severity = document.createElement("span");
      severity.className = `severity ${event.severity}`;
      severity.textContent = event.severity === "high" ? "高" : "关注";
      severityCell.append(severity);
      row.append(severityCell);

      appendCell(row, event.category);
      appendCell(row, mode === "high" ? event.actor : (event.source !== "—" ? event.source : event.actor));

      const target = document.createElement("td");
      target.className = "target-cell";
      const title = document.createElement("strong");
      title.textContent = event.title;
      const detail = document.createElement("span");
      detail.textContent = event.target;
      target.append(title, detail);
      row.append(target);

      if (mode === "high") {
        const reviewCell = document.createElement("td");
        const review = document.createElement("button");
        const reviewed = isResolved(event.id);
        review.className = `review-button ${reviewed ? "reviewed" : "pending"}`;
        review.type = "button";
        review.dataset.reviewId = event.id;
        review.textContent = reviewLabel(event.id);
        reviewCell.append(review);
        row.append(reviewCell);
      }

      const logCell = document.createElement("td");
      const button = document.createElement("button");
      button.className = "log-button";
      button.type = "button";
      button.dataset.eventId = event.id;
      button.textContent = "查看日志";
      logCell.append(button);
      row.append(logCell);
      elements.rows.append(row);
    }

    if (!shown.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = mode === "high" ? 7 : 6;
      cell.className = "empty";
      cell.textContent = "当前筛选条件下没有记录";
      row.append(cell);
      elements.rows.append(row);
    }
    const suffix = state.report.details_limited ? "；详情仅保留最新 1500 条用于页面展示" : "";
    elements.resultCount.textContent = `匹配 ${number(events.length)} 条，显示 ${number(shown.length)} 条${suffix}`;
    elements.loadMore.classList.toggle("hidden", shown.length >= events.length);
  }

  function addMeta(label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    elements.dialogMeta.append(term, description);
  }

  function openLog(eventId) {
    const event = state.report?.events.find(item => item.id === eventId);
    if (!event) return;
    state.selectedEventId = eventId;
    elements.dialogTitle.textContent = event.title;
    elements.dialogMeta.replaceChildren();
    addMeta("时间", formatTime(event.timestamp));
    addMeta("类别", event.category);
    addMeta("用户/来源", `${event.actor} / ${event.source}`);
    addMeta("目标", event.target);
    addMeta("日志来源", event.log_source === "auditd" ? "auditd 审计日志" : "systemd journal");
    addMeta("日志引用", event.log_ref);
    elements.dialogLog.textContent = event.detail || "没有可显示的日志正文。";
    if (elements.toggleReview) {
      const record = reviewRecord(eventId);
      elements.reviewStatus.value = record?.status || "pending";
      elements.reviewNote.value = record?.note || "";
      elements.reviewMeta.textContent = record ? `上次由 ${record.reviewer} 于 ${formatTime(record.updated_at)} 保存` : "尚未保存服务端复核记录";
      elements.toggleReview.textContent = "保存复核记录";
    }
    elements.dialog.showModal();
  }

  async function saveReview(eventId, quickToggle) {
    const event = state.report?.events.find(item => item.id === eventId);
    if (!event) return;
    const current = reviewRecord(eventId);
    const status = quickToggle ? (isResolved(eventId) ? "pending" : "reviewed") : elements.reviewStatus.value;
    const note = quickToggle ? (current?.note || "") : elements.reviewNote.value;
    if (elements.toggleReview) elements.toggleReview.disabled = true;
    try {
      const record = JSON.parse(await control("review", { event_id: eventId, status, note, reviewer: state.reviewer, event }));
      state.reviews[eventId] = record;
      renderTable(); renderHighWorkspace();
      if (elements.dialog.open && state.selectedEventId === eventId) {
        elements.reviewStatus.value = record.status; elements.reviewNote.value = record.note;
        elements.reviewMeta.textContent = `已由 ${record.reviewer} 于 ${formatTime(record.updated_at)} 保存到服务器`;
      }
    } catch (error) {
      if (elements.reviewMeta) elements.reviewMeta.textContent = `保存失败：${error.message || error}`;
    } finally {
      if (elements.toggleReview) elements.toggleReview.disabled = false;
    }
  }

  function sourceChip(id, label, count) {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = `${label}：${number(count)} 条`;
    node.className = `source-chip ${count ? "active" : "empty-source"}`;
  }

  function renderHighWorkspace() {
    if (mode !== "high" || !state.report) return;
    const events = state.report.events;
    const pending = events.filter(event => event.severity === "high" && !isResolved(event.id));
    const insights = state.report.insights || {};
    setText("count-pending", number(pending.length));
    setText("count-actors", number(insights.unique_actors ?? new Set(events.map(event => event.actor).filter(value => value && value !== "—")).size));
    sourceChip("audit-source", "auditd", insights.log_sources?.auditd || 0);
    sourceChip("journal-source", "journald", insights.log_sources?.journald || 0);
    const lastEvent = document.getElementById("last-event");
    if (lastEvent) lastEvent.textContent = `最近事件：${insights.last_event_at ? formatTime(insights.last_event_at) : "无"}`;

    elements.attention.replaceChildren();
    for (const [index, event] of pending.slice(0, 8).entries()) {
      const button = document.createElement("button");
      button.className = "attention-item";
      button.type = "button";
      button.dataset.eventId = event.id;
      const rank = document.createElement("span");
      rank.className = "attention-rank";
      rank.textContent = String(index + 1);
      const copy = document.createElement("span");
      copy.className = "attention-copy";
      const title = document.createElement("strong");
      title.textContent = event.title;
      const meta = document.createElement("span");
      meta.textContent = `${event.category} · ${event.actor}`;
      copy.append(title, meta);
      const time = document.createElement("span");
      time.className = "attention-time";
      time.textContent = formatTime(event.timestamp);
      button.append(rank, copy, time);
      elements.attention.append(button);
    }
    if (!pending.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "已载入的高优先级事件均已复核";
      elements.attention.append(empty);
    }
  }

  function populateCategoryFilter(categories) {
    if (!elements.category) return;
    const previous = elements.category.value;
    elements.category.replaceChildren(new Option("全部类别", ""), ...categories.map(item => new Option(item.name, item.name)));
    elements.category.value = previous;
  }

  function renderReport(report) {
    state.report = report;
    state.visible = 100;
    setText("count-24h", number(report.periods["24h"]));
    setText("count-7d", number(report.periods["7d"]));
    setText("count-30d", number(report.periods["30d"]));
    setText("count-severe", number(report.severity.high));
    setText("dimension-title", report.dimension_label);
    renderBars("daily-chart", report.daily.slice(-14), "date", "count");
    renderBars("category-chart", report.categories, "name", "count");
    renderBars("dimension-chart", report.dimension, "name", "count");
    populateCategoryFilter(report.categories);
    elements.generated.textContent = `统计生成于 ${formatTime(report.generated_at)}；日志最长保留 ${report.retention_days} 天`;
    renderTable();
    renderHighWorkspace();
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportEvents(format) {
    const events = filteredEvents();
    const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
    if (format === "json") {
      download(`high-risk-operations-${stamp}.json`, JSON.stringify({
        exported_at: new Date().toISOString(),
        filters: {
          period: elements.period.value,
          category: elements.category?.value || "",
          severity: elements.severity?.value || "",
          review: elements.review?.value || "",
          search: elements.search.value
        },
        details_limited: state.report.details_limited,
        events: events.map(event => ({ ...event, review: reviewRecord(event.id) }))
      }, null, 2) + "\n", "application/json;charset=utf-8");
      return;
    }
    const header = ["时间", "优先级", "类别", "操作用户", "来源", "目标", "摘要", "复核状态", "日志来源", "日志引用"];
    const rows = events.map(event => [
      event.timestamp, event.severity, event.category, event.actor, event.source,
      event.target, event.title, reviewLabel(event.id),
      event.log_source, event.log_ref
    ]);
    const csv = "\ufeff" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    download(`high-risk-operations-${stamp}.csv`, csv, "text/csv;charset=utf-8");
  }

  async function refresh() {
    elements.refresh.disabled = true;
    elements.refresh.textContent = "正在分析…";
    elements.generated.textContent = "正在读取近 30 天日志…";
    try {
      if (mode === "high") {
        const [text, stateText] = await Promise.all([spawnReport(), control("reviews")]);
        const serverState = JSON.parse(stateText);
        state.reviews = serverState.reviews || {};
        renderReport(JSON.parse(text));
      } else {
        renderReport(JSON.parse(await spawnReport()));
      }
    } catch (error) {
      elements.generated.textContent = `统计加载失败：${error.message || error}`;
      elements.rows.replaceChildren();
    } finally {
      elements.refresh.disabled = false;
      elements.refresh.textContent = "刷新统计";
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.jump) {
      if (elements.dialog.open) elements.dialog.close();
      cockpit.jump(button.dataset.jump);
    } else if (button.dataset.reviewId) {
      saveReview(button.dataset.reviewId, true);
    } else if (button.dataset.eventId) {
      openLog(button.dataset.eventId);
    } else if (button.id === "refresh") {
      refresh();
    } else if (button.id === "load-more") {
      state.visible += 100;
      renderTable();
    } else if (button.id === "toggle-review") {
      saveReview(state.selectedEventId, false);
    } else if (button.id === "export-csv") {
      exportEvents("csv");
    } else if (button.id === "export-json") {
      exportEvents("json");
    } else if (button.id === "close-dialog" || button.id === "close-dialog-bottom") {
      elements.dialog.close();
    }
  });

  elements.period.addEventListener("change", () => { state.visible = 100; renderTable(); });
  elements.search.addEventListener("input", () => { state.visible = 100; renderTable(); });
  [elements.category, elements.severity, elements.review].filter(Boolean).forEach(element => {
    element.addEventListener("change", () => { state.visible = 100; renderTable(); });
  });
  elements.dialog.addEventListener("click", event => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
  cockpit.user().then(user => { state.reviewer = user.name || user.user || state.reviewer; }).catch(() => {});
  refresh();
})();
