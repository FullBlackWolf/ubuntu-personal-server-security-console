"use strict";

const DEMO_USER = "visitor";
const DEMO_PASSWORD = "preview-only";
const SESSION_KEY = "security-console-public-demo";
const destination = "app/security_dashboard/security-dashboard.html";

const username = document.getElementById("username");
const password = document.getElementById("password");
const error = document.getElementById("login-error");

document.getElementById("fill-demo").addEventListener("click", () => {
  username.value = DEMO_USER;
  password.value = DEMO_PASSWORD;
  error.textContent = "";
});

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (username.value !== DEMO_USER || password.value !== DEMO_PASSWORD) {
    error.textContent = "Use the public preview username and password shown on this page.";
    return;
  }
  sessionStorage.setItem(SESSION_KEY, "authenticated");
  window.location.assign(destination);
});

if (sessionStorage.getItem(SESSION_KEY) === "authenticated") {
  window.location.replace(destination);
}
