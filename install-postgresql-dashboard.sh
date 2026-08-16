#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo 'Run this installer as an administrator.' >&2
    exit 1
fi

src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
backup="/var/backups/server-security-console-pre-postgresql-$(date +%Y%m%d-%H%M%S)"
target=/usr/share/cockpit/security_dashboard

install -d -o root -g root -m 0755 "$backup" "$target" /usr/local/libexec
for asset in security-dashboard.html security-dashboard.js security-dashboard.css; do
    if [ -f "$target/$asset" ]; then
        cp -a "$target/$asset" "$backup/$asset"
    fi
    install -o root -g root -m 0644 "$src/security_dashboard/$asset" "$target/$asset"
done
install -o root -g root -m 0755 "$src/postgresql-security-report" /usr/local/libexec/postgresql-security-report

echo "PostgreSQL security analytics has been deployed; the previous page is backed up at $backup"
