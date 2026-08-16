#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo 'Run this installer as an administrator.' >&2
    exit 1
fi

src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
backup=/var/backups/security-key-manager-install

/usr/sbin/visudo -cf "$src/security-key-knock.sudoers" >/dev/null
install -d -o root -g root -m 0700 "$backup"
if [ -d /usr/share/cockpit/security_keys ] && [ ! -e "$backup/security_keys" ]; then
    cp -a /usr/share/cockpit/security_keys "$backup/security_keys"
fi
if [ -d /usr/share/cockpit/security_dashboard ] && [ ! -e "$backup/security_dashboard" ]; then
    cp -a /usr/share/cockpit/security_dashboard "$backup/security_dashboard"
fi

install -d -o root -g root -m 0755 /usr/share/cockpit/security_keys /usr/share/cockpit/security_dashboard /usr/local/libexec
install -d -o root -g root -m 0750 /etc/sudoers.d
install -o root -g root -m 0644 "$src/security_keys/manifest.json" /usr/share/cockpit/security_keys/manifest.json
install -o root -g root -m 0644 "$src/security_keys/security-keys.html" /usr/share/cockpit/security_keys/security-keys.html
install -o root -g root -m 0644 "$src/security_keys/security-keys.js" /usr/share/cockpit/security_keys/security-keys.js
install -o root -g root -m 0644 "$src/security_keys/security-keys.css" /usr/share/cockpit/security_keys/security-keys.css
install -o root -g root -m 0755 "$src/security-key-control" /usr/local/sbin/security-key-control
install -o root -g root -m 0755 "$src/security-key-session-gate" /usr/local/libexec/security-key-session-gate
install -o root -g root -m 0755 "$src/security-key-knock-check" /usr/local/libexec/security-key-knock-check
install -o root -g root -m 0440 "$src/security-key-knock.sudoers" /etc/sudoers.d/security-key-knock
install -o root -g root -m 0644 "$src/security_dashboard/manifest.json" /usr/share/cockpit/security_dashboard/manifest.json
install -o root -g root -m 0644 "$src/security_dashboard/security-dashboard.html" /usr/share/cockpit/security_dashboard/security-dashboard.html
install -o root -g root -m 0644 "$src/security_dashboard/security-dashboard.js" /usr/share/cockpit/security_dashboard/security-dashboard.js
install -o root -g root -m 0644 "$src/security_dashboard/security-dashboard.css" /usr/share/cockpit/security_dashboard/security-dashboard.css

/usr/sbin/visudo -cf /etc/sudoers.d/security-key-knock >/dev/null
if [ -x /usr/sbin/fwknopd ]; then
    systemctl enable --now fwknop-server.service
fi

echo 'The SSH key and SPA manager has been installed in Cockpit.'
