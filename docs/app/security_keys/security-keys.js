(function () {
  "use strict";

  const CONTROL = "/usr/local/sbin/security-key-control";
  const state = { keys: [], users: [], knock: {}, selected: null };
  const list = document.getElementById("key-list");
  const empty = document.getElementById("empty");
  const settingsDialog = document.getElementById("settings-dialog");
  const addDialog = document.getElementById("add-dialog");
  const outputDialog = document.getElementById("output-dialog");
  const settingsForm = document.getElementById("settings-form");
  const addForm = document.getElementById("add-form");
  let toastTimer;

  function run(args, input) {
    const process = cockpit.spawn(args, { superuser: "require", err: "message" });
    if (input !== undefined) process.input(JSON.stringify(input));
    return process;
  }

  function escapeText(value) {
    const node = document.createElement("span");
    node.textContent = value || "";
    return node.innerHTML;
  }

  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
  }

  function policyTags(key) {
    const tags = [];
    if (key.knock_required) tags.push('<span class="tag knock">敲门</span>');
    if (key.allow_from) tags.push('<span class="tag">限定来源</span>');
    if (key.expires) tags.push('<span class="tag warn">' + escapeText(key.expires) + ' 失效</span>');
    if (!key.port_forwarding) tags.push('<span class="tag">禁用隧道</span>');
    if (!key.agent_forwarding) tags.push('<span class="tag">禁用 Agent</span>');
    if (!key.enabled) tags.push('<span class="tag warn">已停用</span>');
    return tags.join("");
  }

  function render() {
    const query = document.getElementById("search").value.trim().toLowerCase();
    const user = document.getElementById("user-filter").value;
    const keys = state.keys.filter(key => {
      const haystack = [key.comment, key.fingerprint, key.user, key.type].join(" ").toLowerCase();
      return (!query || haystack.includes(query)) && (!user || key.user === user);
    });
    document.getElementById("key-count").textContent = String(keys.length);
    list.replaceChildren();
    empty.hidden = state.keys.length !== 0 || Boolean(query || user);

    keys.forEach(key => {
      const article = document.createElement("article");
      article.className = "key-card" + (key.enabled ? "" : " disabled");
      article.innerHTML =
        '<div class="key-icon">⌁</div>' +
        '<div class="key-main"><div class="key-title"><strong>' + escapeText(key.comment || "未命名公钥") + '</strong><span class="badge ' + (key.enabled ? "active" : "inactive") + '">' + (key.enabled ? "启用" : "停用") + '</span></div>' +
        '<p class="mono fingerprint">' + escapeText(key.fingerprint) + '</p></div>' +
        '<div class="key-meta"><div class="policy-tags">' + policyTags(key) + '</div><p>' + escapeText(key.user) + ' · ' + escapeText(key.type_label) + '</p></div>' +
        '<button class="edit-button" type="button">安全设置</button>';
      article.querySelector(".edit-button").addEventListener("click", () => openSettings(key));
      list.append(article);
    });
  }

  function setUsers() {
    const filter = document.getElementById("user-filter");
    const prior = filter.value;
    filter.replaceChildren(new Option("全部账号", ""), ...state.users.map(user => new Option(user.name, user.name)));
    filter.value = prior;
    const select = addForm.elements.user;
    select.replaceChildren(...state.users.map(user => new Option(user.name + " — " + user.home, user.name)));
  }

  function setKnockStatus() {
    const badge = document.getElementById("knock-badge");
    const card = document.getElementById("knock-card");
    const good = state.knock.installed && state.knock.active && state.knock.gate_installed;
    badge.className = "badge " + (good ? "active" : "inactive");
    badge.textContent = good ? "运行中" : state.knock.installed ? "需要检查" : "未安装";
    card.classList.toggle("warning", !good);
    let text = state.knock.installed ? "fwknop 已安装" : "未检测到 fwknop";
    text += state.knock.active ? "且服务正在运行" : "，但服务未运行";
    text += state.knock.access_configured ? "；已配置 SPA 访问策略。" : "；尚未检测到有效访问策略。";
    document.getElementById("knock-description").textContent = text;
  }

  async function refresh() {
    const button = document.getElementById("refresh");
    button.disabled = true;
    try {
      const data = JSON.parse(await run([CONTROL, "list"]));
      state.keys = data.keys;
      state.users = data.users;
      state.knock = data.knock;
      setUsers();
      setKnockStatus();
      render();
    } catch (error) {
      toast("读取失败：" + (error.message || error));
    } finally {
      button.disabled = false;
    }
  }

  function openSettings(key) {
    state.selected = key;
    document.getElementById("settings-title").textContent = key.comment || "未命名公钥";
    document.getElementById("settings-fingerprint").textContent = key.user + " · " + key.fingerprint;
    ["comment", "allow_from", "expires"].forEach(name => settingsForm.elements[name].value = key[name] || "");
    ["knock_required", "enabled", "pty", "port_forwarding", "agent_forwarding", "x11_forwarding", "user_rc", "touch_required"].forEach(name => settingsForm.elements[name].checked = Boolean(key[name]));
    const fido = key.type.startsWith("sk-");
    document.getElementById("touch-setting").hidden = !fido;
    settingsForm.elements.touch_required.disabled = !fido;
    document.getElementById("form-error").textContent = key.command_conflict ? "此公钥已有自定义强制命令；启用敲门前需先移除该命令。" : "";
    settingsDialog.showModal();
  }

  function closeDialogs() {
    [settingsDialog, addDialog, outputDialog].forEach(dialog => { if (dialog.open) dialog.close(); });
  }

  async function submitSettings(event) {
    event.preventDefault();
    const error = document.getElementById("form-error");
    const button = document.getElementById("save-key");
    const payload = { action: "update", user: state.selected.user, fingerprint: state.selected.fingerprint };
    ["comment", "allow_from", "expires"].forEach(name => payload[name] = settingsForm.elements[name].value.trim());
    ["knock_required", "enabled", "pty", "port_forwarding", "agent_forwarding", "x11_forwarding", "user_rc", "touch_required"].forEach(name => payload[name] = settingsForm.elements[name].checked);
    button.disabled = true;
    error.textContent = "";
    try {
      await run([CONTROL, "mutate"], payload);
      settingsDialog.close();
      toast("公钥安全设置已保存");
      await refresh();
    } catch (caught) {
      error.textContent = caught.message || String(caught);
    } finally { button.disabled = false; }
  }

  async function submitAdd(event) {
    event.preventDefault();
    const error = document.getElementById("add-error");
    const button = document.getElementById("create-key");
    const payload = {
      action: "add",
      user: addForm.elements.user.value,
      public_key: addForm.elements.public_key.value.trim(),
      comment: addForm.elements.comment.value.trim(),
      knock_required: addForm.elements.knock_required.checked
    };
    button.disabled = true;
    error.textContent = "";
    try {
      await run([CONTROL, "mutate"], payload);
      addDialog.close();
      addForm.reset();
      addForm.elements.knock_required.checked = true;
      toast("公钥已添加");
      await refresh();
    } catch (caught) {
      error.textContent = caught.message || String(caught);
    } finally { button.disabled = false; }
  }

  async function deleteKey() {
    if (!state.selected || !window.confirm("确定永久删除“" + (state.selected.comment || state.selected.fingerprint) + "”吗？此操作会立即撤销 SSH 登录权限。")) return;
    const button = document.getElementById("delete-key");
    button.disabled = true;
    try {
      await run([CONTROL, "mutate"], { action: "delete", user: state.selected.user, fingerprint: state.selected.fingerprint });
      settingsDialog.close();
      toast("公钥已删除");
      await refresh();
    } catch (error) {
      document.getElementById("form-error").textContent = error.message || String(error);
    } finally { button.disabled = false; }
  }

  async function showLogs() {
    outputDialog.showModal();
    const output = document.getElementById("output");
    output.textContent = "正在读取…";
    try {
      output.textContent = await run([CONTROL, "knock-logs"]);
    } catch (error) { output.textContent = "读取失败：" + (error.message || error); }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.jump) return cockpit.jump(button.dataset.jump);
    if (button.dataset.close !== undefined) return closeDialogs();
    if (button.dataset.openAdd !== undefined || button.id === "add-key") { document.getElementById("add-error").textContent = ""; addDialog.showModal(); }
  });
  document.getElementById("refresh").addEventListener("click", refresh);
  document.getElementById("knock-logs").addEventListener("click", showLogs);
  document.getElementById("delete-key").addEventListener("click", deleteKey);
  document.getElementById("search").addEventListener("input", render);
  document.getElementById("user-filter").addEventListener("change", render);
  settingsForm.addEventListener("submit", submitSettings);
  addForm.addEventListener("submit", submitAdd);
  refresh();
})();
