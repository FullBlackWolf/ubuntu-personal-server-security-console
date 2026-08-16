#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo 'Run this installer as an administrator.' >&2
    exit 1
fi

src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
backup="/var/backups/server-security-console-$(date +%Y%m%d-%H%M%S)"

install -d -o root -g root -m 0755 "$backup"
if [ -d /usr/share/cockpit/security_dashboard ] && [ ! -e "$backup/security_dashboard" ]; then
    cp -a /usr/share/cockpit/security_dashboard "$backup/security_dashboard"
fi

install -d -o root -g root -m 0755 /usr/share/cockpit/security_dashboard /usr/share/cockpit/security_heavy /usr/share/cockpit/security_operations /usr/share/cockpit/security_keys
install -d -o root -g root -m 0755 /usr/local/libexec /etc/systemd/journald.conf.d /etc/sudoers.d
install -o root -g root -m 0644 "$src/security_dashboard/manifest.json" /usr/share/cockpit/security_dashboard/manifest.json
install -o root -g root -m 0644 "$src/security_dashboard/security-dashboard.html" /usr/share/cockpit/security_dashboard/security-dashboard.html
install -o root -g root -m 0644 "$src/security_dashboard/security-dashboard.js" /usr/share/cockpit/security_dashboard/security-dashboard.js
install -o root -g root -m 0644 "$src/security_dashboard/security-dashboard.css" /usr/share/cockpit/security_dashboard/security-dashboard.css
install -o root -g root -m 0755 "$src/postgresql-security-report" /usr/local/libexec/postgresql-security-report
install -o root -g root -m 0644 "$src/security_heavy/manifest.json" /usr/share/cockpit/security_heavy/manifest.json
install -o root -g root -m 0644 "$src/security_heavy/security-heavy.html" /usr/share/cockpit/security_heavy/security-heavy.html
install -o root -g root -m 0644 "$src/security_heavy/security-heavy.js" /usr/share/cockpit/security_heavy/security-heavy.js
install -o root -g root -m 0644 "$src/security_heavy/security-heavy.css" /usr/share/cockpit/security_heavy/security-heavy.css
install -o root -g root -m 0755 "$src/security-heavy-control" /usr/local/sbin/security-heavy-control
install -o root -g root -m 0644 "$src/security_keys/manifest.json" /usr/share/cockpit/security_keys/manifest.json
install -o root -g root -m 0644 "$src/security_keys/security-keys.html" /usr/share/cockpit/security_keys/security-keys.html
install -o root -g root -m 0644 "$src/security_keys/security-keys.js" /usr/share/cockpit/security_keys/security-keys.js
install -o root -g root -m 0644 "$src/security_keys/security-keys.css" /usr/share/cockpit/security_keys/security-keys.css
install -o root -g root -m 0755 "$src/security-key-control" /usr/local/sbin/security-key-control
install -o root -g root -m 0755 "$src/security-key-session-gate" /usr/local/libexec/security-key-session-gate
install -o root -g root -m 0755 "$src/security-key-knock-check" /usr/local/libexec/security-key-knock-check
install -o root -g root -m 0440 "$src/security-key-knock.sudoers" /etc/sudoers.d/security-key-knock
/usr/sbin/visudo -cf /etc/sudoers.d/security-key-knock >/dev/null
install -o root -g root -m 0644 "$src/security_operations/manifest.json" /usr/share/cockpit/security_operations/manifest.json
install -o root -g root -m 0644 "$src/security_operations/high-risk-operations.html" /usr/share/cockpit/security_operations/high-risk-operations.html
install -o root -g root -m 0644 "$src/security_operations/suspicious-operations.html" /usr/share/cockpit/security_operations/suspicious-operations.html
install -o root -g root -m 0644 "$src/security_operations/security-operations.css" /usr/share/cockpit/security_operations/security-operations.css
install -o root -g root -m 0644 "$src/security_operations/security-operations.js" /usr/share/cockpit/security_operations/security-operations.js
install -o root -g root -m 0755 "$src/security-operations-report" /usr/local/libexec/security-operations-report
install -o root -g root -m 0755 "$src/security-operations-control" /usr/local/sbin/security-operations-control
install -o root -g root -m 0644 "$src/security_operations/security-center.html" /usr/share/cockpit/security_operations/security-center.html
install -o root -g root -m 0644 "$src/security_operations/security-center.js" /usr/share/cockpit/security_operations/security-center.js
install -o root -g root -m 0644 "$src/journald-30day.conf" /etc/systemd/journald.conf.d/60-server-security.conf
install -o root -g root -m 0644 "$src/security-log-retention.service" /etc/systemd/system/security-log-retention.service
install -o root -g root -m 0644 "$src/security-log-retention.timer" /etc/systemd/system/security-log-retention.timer
install -o root -g root -m 0644 "$src/security-operations-daily-archive.service" /etc/systemd/system/security-operations-daily-archive.service
install -o root -g root -m 0644 "$src/security-operations-daily-archive.timer" /etc/systemd/system/security-operations-daily-archive.timer
install -o root -g root -m 0644 "$src/security-operations-weekly-archive.service" /etc/systemd/system/security-operations-weekly-archive.service
install -o root -g root -m 0644 "$src/security-operations-weekly-archive.timer" /etc/systemd/system/security-operations-weekly-archive.timer
install -o root -g root -m 0644 "$src/security-alert-monitor.service" /etc/systemd/system/security-alert-monitor.service
install -o root -g root -m 0644 "$src/security-alert-monitor.timer" /etc/systemd/system/security-alert-monitor.timer

sed -i -E 's|^num_logs =.*|num_logs = 30|' /etc/audit/auditd.conf
systemctl daemon-reload
systemctl enable --now security-log-retention.timer security-operations-daily-archive.timer security-operations-weekly-archive.timer security-alert-monitor.timer
systemctl restart systemd-journald

sed -i -E 's|^CRON_DAILY_RUN=.*|CRON_DAILY_RUN=no|' /etc/default/aide
sed -i -E 's|^CRON_CHECK=.*|CRON_CHECK=never|' /etc/default/debsums
systemctl disable --now dailyaidecheck.timer lynis.timer clamav-weekly-scan.timer
systemctl disable --now clamav-daemon.service clamav-daemon.socket 2>/dev/null || true

echo 'The security console has been updated; all high-resource features remain disabled.'
