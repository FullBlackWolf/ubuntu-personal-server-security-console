#!/usr/bin/python3
"""Generate deterministic, synthetic security events for the public demo."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
import random


SEED = 20260816
BASE = dt.datetime(2026, 8, 16, 22, 0, tzinfo=dt.timezone.utc)
OUTPUT = Path(__file__).parents[1] / "docs" / "demo-data.json"
randomizer = random.Random(SEED)

SOURCES = {
    "sshd": [
        ("authentication", "medium", "Failed public-key authentication for {actor} from {ip}"),
        ("remote access", "low", "Accepted public-key session for {actor} from {ip}"),
        ("authentication", "high", "Maximum authentication attempts exceeded for {actor} from {ip}"),
    ],
    "auditd": [
        ("privilege", "high", "Privileged command executed by {actor}: systemctl restart demo-service"),
        ("identity", "medium", "User account policy changed by {actor}"),
        ("configuration", "high", "Security configuration file updated by {actor}"),
    ],
    "ufw": [
        ("firewall", "medium", "Blocked inbound TCP probe from {ip} to port {port}"),
        ("firewall", "low", "Rate-limited connection attempt from {ip}"),
    ],
    "fail2ban": [
        ("response", "medium", "Banned {ip} after repeated authentication failures"),
        ("response", "low", "Expired temporary ban for {ip}"),
    ],
    "cockpit": [
        ("administration", "low", "Cockpit session opened by {actor} from {ip}"),
        ("authentication", "medium", "Cockpit authentication rejected for {actor} from {ip}"),
    ],
    "postgresql": [
        ("database authentication", "medium", "FATAL: password authentication failed for user \"{actor}\" from {ip}"),
        ("database", "high", "FATAL: remaining connection slots are reserved for administrative roles"),
        ("database", "medium", "ERROR: synthetic query canceled after statement timeout"),
    ],
    "imported": [
        ("historical import", "medium", "Verified historical log entry imported from synthetic-auth.log"),
        ("historical import", "low", "Synthetic legacy service restart record imported and indexed"),
    ],
}

ACTORS = ["admin", "postgres", "deploy", "backup", "monitor", "unknown"]
PORTS = [22, 80, 443, 5432, 8080, 9090]
RANGES = ["192.0.2", "198.51.100", "203.0.113"]


def address() -> str:
    return f"{randomizer.choice(RANGES)}.{randomizer.randint(2, 240)}"


def timestamp(minutes_ago: int) -> str:
    return (BASE - dt.timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


events = []
for index in range(360):
    minutes_ago = int((randomizer.random() ** 1.5) * 43_200)
    source = randomizer.choices(list(SOURCES), weights=[26, 18, 16, 9, 7, 19, 5], k=1)[0]
    category, severity, template = randomizer.choice(SOURCES[source])
    actor = randomizer.choice(ACTORS)
    ip = address()
    message = template.format(actor=actor, ip=ip, port=randomizer.choice(PORTS))
    events.append({
        "id": f"DEMO-{index + 1:04d}",
        "timestamp": timestamp(minutes_ago),
        "minutes_ago": minutes_ago,
        "source": source,
        "category": category,
        "severity": severity,
        "actor": actor,
        "ip": ip,
        "message": message,
        "review": randomizer.choices(["pending", "reviewed", "resolved", "false_positive"], weights=[58, 20, 15, 7], k=1)[0],
    })
events.sort(key=lambda item: item["timestamp"], reverse=True)

hours = []
for hour in range(168):
    wave = 0.18 + (0.26 if hour % 24 in {1, 2, 3, 18, 19, 20} else 0)
    value = max(0, wave + randomizer.gauss(0.18, 0.16))
    if randomizer.random() < 0.07:
        value += randomizer.uniform(0.8, 2.8)
    hours.append({"timestamp": timestamp((167 - hour) * 60), "errors_per_minute": round(value, 2)})

fatal_events = [event for event in events if event["source"] == "postgresql" and "FATAL:" in event["message"]][:30]
failed_pg = [event for event in events if event["source"] == "postgresql" and "authentication failed" in event["message"]]


def ranking(field: str) -> list[dict[str, object]]:
    counts: dict[str, int] = {}
    for event in failed_pg:
        value = str(event[field])
        counts[value] = counts.get(value, 0) + 1
    return [{field: key, "count": value} for key, value in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))]


dataset = {
    "metadata": {
        "schema": "security-console-public-demo-v1",
        "synthetic": True,
        "seed": SEED,
        "generated_at": BASE.isoformat().replace("+00:00", "Z"),
        "host": "demo-server.example.invalid",
        "notice": "All identities, addresses, events, and measurements in this file are synthetic.",
    },
    "summary": {
        "active_alerts": 5,
        "critical_alerts": 1,
        "events_24h": sum(event["minutes_ago"] <= 1440 for event in events),
        "pending_reviews": sum(event["review"] == "pending" for event in events),
        "postgres_auth_failures_1h": sum(event["minutes_ago"] <= 60 for event in failed_pg),
        "postgres_auth_failures_24h": sum(event["minutes_ago"] <= 1440 for event in failed_pg),
        "archive_integrity": "Verified",
        "retention_days": 30,
    },
    "health": [
        {"name": "auditd", "status": "healthy", "detail": "0 lost events · backlog 3"},
        {"name": "journald", "status": "healthy", "detail": "Persistent · 428 MiB used"},
        {"name": "Time sync", "status": "healthy", "detail": "Synchronized"},
        {"name": "Imported logs", "status": "healthy", "detail": "4 files · SHA-256 verified"},
        {"name": "Archives", "status": "healthy", "detail": "14 valid · 0 modified"},
    ],
    "alerts": [
        {"severity": "critical", "title": "Authentication burst", "detail": "27 failures from a new synthetic source within 10 minutes."},
        {"severity": "high", "title": "Off-hours privileged action", "detail": "A simulated root-level service change occurred outside the configured window."},
        {"severity": "high", "title": "PostgreSQL authentication threshold", "detail": "The one-hour failed-login threshold was exceeded in the demo dataset."},
        {"severity": "medium", "title": "Security configuration changed", "detail": "A synthetic audit event reported a protected configuration update."},
        {"severity": "medium", "title": "New remote source", "detail": "A documentation-range source address has not appeared in the prior demo window."},
    ],
    "events": events,
    "postgresql": {
        "errors_per_minute": hours,
        "fatal_logs": fatal_events,
        "top_users": ranking("actor")[:100],
        "top_ips": ranking("ip")[:100],
    },
    "components": [
        {"id": "dashboard", "name": "Security Dashboard", "enabled": True, "depends_on": []},
        {"id": "postgresql", "name": "PostgreSQL Security Analytics", "enabled": True, "depends_on": ["dashboard"]},
        {"id": "operations", "name": "Security Event Center", "enabled": True, "depends_on": ["dashboard", "postgresql"]},
        {"id": "automation", "name": "Retention, Alerts, and Archives", "enabled": True, "depends_on": ["operations"]},
        {"id": "scanners", "name": "On-demand Security Scanners", "enabled": False, "depends_on": ["dashboard"]},
        {"id": "ssh_keys", "name": "SSH Key and SPA Manager", "enabled": False, "depends_on": ["dashboard"]}
    ]
}

OUTPUT.write_text(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"Wrote {len(events)} synthetic events to {OUTPUT}")
