#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo 'Run this installer as an administrator.' >&2
    exit 1
fi

src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
backup="/var/backups/server-security-operations-$(date +%Y%m%d-%H%M%S)"
target=/usr/share/cockpit/security_operations

install -d -o root -g root -m 0755 "$backup" "$target" /usr/local/libexec /usr/local/sbin
for asset in manifest.json high-risk-operations.html suspicious-operations.html security-center.html security-operations.js security-center.js security-operations.css; do
    if [ -f "$target/$asset" ]; then
        cp -a "$target/$asset" "$backup/$asset"
    fi
    install -o root -g root -m 0644 "$src/security_operations/$asset" "$target/$asset"
done
install -o root -g root -m 0755 "$src/security-operations-report" /usr/local/libexec/security-operations-report
install -o root -g root -m 0755 "$src/security-operations-control" /usr/local/sbin/security-operations-control
for unit in security-log-retention.service security-log-retention.timer security-operations-daily-archive.service security-operations-daily-archive.timer security-operations-weekly-archive.service security-operations-weekly-archive.timer security-alert-monitor.service security-alert-monitor.timer; do
    install -o root -g root -m 0644 "$src/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now security-log-retention.timer security-operations-daily-archive.timer security-operations-weekly-archive.timer security-alert-monitor.timer

echo "The security operations workbench has been deployed; the previous page is backed up at $backup"
