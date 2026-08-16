# Component architecture

## Data flow

```text
auditd ─────────┐
journald ───────┤
UFW / SSH ──────┤
Fail2ban ───────┼──> read-only report adapters ──> Cockpit Event Center
PostgreSQL ─────┤                 │                         │
imported logs ──┘                 ├──> rules/correlations  ├──> review state
                                  └──> verified archives   └──> exports
```

The browser calls fixed report and control programs through Cockpit. Privileged controllers accept only enumerated actions and validated structured input. They do not expose a general command runner.

## Dependency graph

```text
Security Dashboard
├── PostgreSQL Security Analytics
│   └── Security Event Center
│       └── Retention, Alerts, and Archives
├── On-demand Security Scanners
└── SSH Key and SPA Manager
```

The optional installer calculates the transitive dependency closure. If a user selects a child without its parent, a graphical or terminal confirmation dialog lists every component that must be added. System package dependencies use a separate confirmation before any `apt` command runs.

## Privilege boundaries

| Program | Privilege | Boundary |
| --- | --- | --- |
| `postgresql-security-report` | Read-only; elevated when needed | Reads known PostgreSQL journal/file locations and bounded stdin imports |
| `security-operations-report` | Read-only; elevated when needed | Reads known security sources and emits normalized JSON |
| `security-operations-control` | Root via Cockpit/polkit | Fixed review, configuration, import, archive, verification, retention, and notification actions |
| `security-heavy-control` | Root via Cockpit/polkit | Fixed scanner task and service actions |
| `security-key-control` | Root via Cockpit/polkit | Validates and atomically rewrites `authorized_keys`; creates backups first |
| `security-key-session-gate` | Forced command | Applies a bounded session policy to keys that require SPA access |

## Runtime storage

| Path | Content |
| --- | --- |
| `/var/lib/server-security-console/operations-state.json` | Reviews, rule settings, filters, import metadata, and archive records |
| `/var/lib/server-security-console/imported-logs/` | Managed historical log copies, deduplicated by SHA-256 |
| `/var/lib/server-security-console/archives/` | JSON reports, Markdown summaries, and SHA-256 sidecars |
| `/var/backups/server-security-console-installer/` | Files replaced or removed by the component installer |

Runtime storage is deliberately outside the Debian payload and is never bundled by the build script.
