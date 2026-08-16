(function () {
  "use strict";

  const helper = "/usr/local/sbin/security-heavy-control";
  const tasks = [
    { id: "aide", label: "AIDE 文件完整性", description: "建立基线并读取大量系统文件；基线存在后执行完整性校验。", resource: "高磁盘读取 · 较长时间", autoText: "每日自动校验" },
    { id: "lynis", label: "Lynis 系统审计", description: "检查系统配置、软件和安全策略并生成审计报告。", resource: "中高 CPU/磁盘 · 数分钟", autoText: "每日自动审计" },
    { id: "debsums", label: "debsums 软件校验", description: "校验已安装软件包的文件哈希，可能遍历大量文件。", resource: "高磁盘读取 · 较长时间", autoText: "每周自动校验" },
    { id: "clam-scan", label: "ClamAV 全盘扫描", description: "递归扫描整个文件系统，并跳过虚拟系统目录。", resource: "高 CPU/磁盘 · 可能数小时", autoText: "每周自动扫描" },
    { id: "clamd", label: "ClamAV 常驻引擎", description: "将病毒库常驻内存，为其他程序提供扫描服务。", resource: "持续占用较多内存", autoText: "开机自动常驻" }
  ];

  const taskById = new Map(tasks.map(task => [task.id, task]));
  const grid = document.getElementById("task-grid");
  const output = document.getElementById("output");
  const updated = document.getElementById("updated");
  let states = new Map();

  function run(args, privileged) {
    return cockpit.spawn(args, { superuser: privileged ? "require" : undefined, err: "message" });
  }

  function show(text) {
    output.textContent = text || "操作完成。";
    output.scrollTop = output.scrollHeight;
  }

  function parseStatus(text) {
    const result = new Map();
    text.trim().split("\n").filter(Boolean).forEach(line => {
      const [id, automatic, running, detail] = line.split("|");
      result.set(id, { automatic: automatic === "on", running: running === "running", detail: detail || "" });
    });
    return result;
  }

  function makeButton(text, action, taskId, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.dataset.action = action;
    button.dataset.task = taskId;
    if (className) button.className = className;
    return button;
  }

  function renderCard(task, state) {
    const current = state || { automatic: false, running: false, detail: "状态未知" };
    const card = document.createElement("article");
    card.className = "card" + (current.running ? " running" : "");

    const top = document.createElement("div");
    top.className = "card-top";
    const title = document.createElement("h3");
    title.textContent = task.label;
    const badge = document.createElement("span");
    badge.className = "badge " + (current.running ? "running" : "stopped");
    badge.textContent = current.running ? "正在运行" : "未运行";
    top.append(title, badge);

    const description = document.createElement("p");
    description.className = "description";
    description.textContent = task.description;
    const resource = document.createElement("p");
    resource.className = "resource";
    resource.textContent = task.resource;

    const schedule = document.createElement("div");
    schedule.className = "schedule";
    const scheduleText = document.createElement("span");
    scheduleText.textContent = task.autoText;
    const scheduleBadge = document.createElement("strong");
    scheduleBadge.className = current.automatic ? "on" : "off";
    scheduleBadge.textContent = current.automatic ? "已启用" : "默认关闭";
    schedule.append(scheduleText, scheduleBadge);

    const detail = document.createElement("p");
    detail.className = "detail";
    detail.textContent = current.detail;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      makeButton(current.automatic ? "关闭自动运行" : "启用自动运行", "toggle-auto", task.id, current.automatic ? "danger" : "warning-button"),
      makeButton(current.running ? "停止任务" : "立即运行", current.running ? "stop" : "run", task.id, current.running ? "danger" : "run-button"),
      makeButton("最近日志", "logs", task.id, "quiet")
    );

    card.append(top, description, resource, schedule, detail, actions);
    return card;
  }

  async function refresh() {
    try {
      states = parseStatus(await run([helper, "status"], false));
      grid.replaceChildren(...tasks.map(task => renderCard(task, states.get(task.id))));
      updated.textContent = "更新于 " + new Date().toLocaleTimeString();
    } catch (error) {
      show("无法读取状态：" + (error.message || error));
    }
  }

  async function action(button, args, successMessage) {
    button.disabled = true;
    show("正在执行…");
    try {
      const text = await run([helper].concat(args), true);
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
    if (button.id === "refresh") return refresh();
    if (button.id === "clear-output") return show("等待操作…");
    if (button.dataset.jump) return cockpit.jump(button.dataset.jump);

    const task = taskById.get(button.dataset.task);
    const state = states.get(button.dataset.task);
    if (!task || !state) return;

    if (button.dataset.action === "toggle-auto") {
      const next = state.automatic ? "off" : "on";
      const message = next === "on"
        ? "确定启用“" + task.autoText + "”吗？到达计划时间后会产生明显资源占用。"
        : "确定关闭“" + task.autoText + "”吗？正在运行的任务不会因此自动停止。";
      if (window.confirm(message)) await action(button, ["set-auto", task.id, next], next === "on" ? "自动运行已启用。" : "自动运行已关闭。");
    } else if (button.dataset.action === "run") {
      if (window.confirm("确定立即运行“" + task.label + "”吗？\n\n资源影响：" + task.resource))
        await action(button, ["run", task.id], "任务已在后台启动。");
    } else if (button.dataset.action === "stop") {
      if (window.confirm("确定停止正在运行的“" + task.label + "”吗？"))
        await action(button, ["stop", task.id], "任务已停止。");
    } else if (button.dataset.action === "logs") {
      await action(button, ["logs", task.id], "没有近期日志。");
    }
  });

  refresh();
  window.setInterval(refresh, 30000);
})();
