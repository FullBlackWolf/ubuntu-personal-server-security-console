(function () {
  "use strict";

  const helper = "/usr/local/sbin/security-heavy-control";
  const tasks = [
    { id: "aide", label: "AIDE File Integrity", description: "Builds a baseline and reads many system files; verifies integrity after the baseline exists.", resource: "High disk reads · extended duration", autoText: "daily automatic verification" },
    { id: "lynis", label: "Lynis System Audit", description: "Inspects system configuration, software, and security policies and produces an audit report.", resource: "Medium-to-high CPU/disk · several minutes", autoText: "daily automatic audit" },
    { id: "debsums", label: "debsums Package Verification", description: "Verifies installed-package file hashes and may traverse many files.", resource: "High disk reads · extended duration", autoText: "weekly automatic verification" },
    { id: "clam-scan", label: "ClamAV Full-system Scan", description: "Recursively scans the filesystem while excluding virtual system directories.", resource: "High CPU/disk · potentially hours", autoText: "weekly automatic scan" },
    { id: "clamd", label: "ClamAV Resident Engine", description: "Keeps the virus database in memory and provides scanning services to other programs.", resource: "Sustained higher memory usage", autoText: "automatic startup" }
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
    output.textContent = text || "Action completed.";
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
    const current = state || { automatic: false, running: false, detail: "Status unknown" };
    const card = document.createElement("article");
    card.className = "card" + (current.running ? " running" : "");

    const top = document.createElement("div");
    top.className = "card-top";
    const title = document.createElement("h3");
    title.textContent = task.label;
    const badge = document.createElement("span");
    badge.className = "badge " + (current.running ? "running" : "stopped");
    badge.textContent = current.running ? "Running" : "Stopped";
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
    scheduleBadge.textContent = current.automatic ? "Enabled" : "Disabled by default";
    schedule.append(scheduleText, scheduleBadge);

    const detail = document.createElement("p");
    detail.className = "detail";
    detail.textContent = current.detail;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      makeButton(current.automatic ? "Disable Automatic Run" : "Enable Automatic Run", "toggle-auto", task.id, current.automatic ? "danger" : "warning-button"),
      makeButton(current.running ? "Stop Task" : "Run Now", current.running ? "stop" : "run", task.id, current.running ? "danger" : "run-button"),
      makeButton("Recent Logs", "logs", task.id, "quiet")
    );

    card.append(top, description, resource, schedule, detail, actions);
    return card;
  }

  async function refresh() {
    try {
      states = parseStatus(await run([helper, "status"], false));
      grid.replaceChildren(...tasks.map(task => renderCard(task, states.get(task.id))));
      updated.textContent = "Updated " + new Date().toLocaleTimeString("en-US");
    } catch (error) {
      show("Unable to read status: " + (error.message || error));
    }
  }

  async function action(button, args, successMessage) {
    button.disabled = true;
    show("Running…");
    try {
      const text = await run([helper].concat(args), true);
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
    if (button.id === "refresh") return refresh();
    if (button.id === "clear-output") return show("Waiting for an action…");
    if (button.dataset.jump) return cockpit.jump(button.dataset.jump);

    const task = taskById.get(button.dataset.task);
    const state = states.get(button.dataset.task);
    if (!task || !state) return;

    if (button.dataset.action === "toggle-auto") {
      const next = state.automatic ? "off" : "on";
      const message = next === "on"
        ? "Enable “" + task.autoText + "”? Scheduled runs can consume significant resources."
        : "Disable “" + task.autoText + "”? A task already running will not stop automatically.";
      if (window.confirm(message)) await action(button, ["set-auto", task.id, next], next === "on" ? "Automatic run enabled." : "Automatic run disabled.");
    } else if (button.dataset.action === "run") {
      if (window.confirm("Run “" + task.label + "” now?\n\nResource impact: " + task.resource))
        await action(button, ["run", task.id], "Task started in the background.");
    } else if (button.dataset.action === "stop") {
      if (window.confirm("Stop the running “" + task.label + "” task?"))
        await action(button, ["stop", task.id], "Task stopped.");
    } else if (button.dataset.action === "logs") {
      await action(button, ["logs", task.id], "No recent logs.");
    }
  });

  refresh();
  window.setInterval(refresh, 30000);
})();
