#!/bin/sh
set -eu

project=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
version=${VERSION:-1.0.0}
architecture=all
stage="$project/build/server-security-console_${version}_${architecture}"
output="$project/dist"

case "$version" in
    *[!0-9A-Za-z.+~:-]*|'') echo "Invalid Debian version: $version" >&2; exit 2 ;;
esac

rm -rf "$stage"
install -d "$stage/DEBIAN" "$stage/usr/sbin" "$stage/usr/share/applications"
install -d "$stage/usr/share/server-security-console/payload" "$stage/usr/share/server-security-console/metadata"
install -d "$stage/usr/share/doc/server-security-console" "$output"

cat >"$stage/DEBIAN/control" <<EOF
Package: server-security-console
Version: $version
Architecture: $architecture
Section: admin
Priority: optional
Maintainer: Ubuntu Personal Server Security Console Contributors <noreply@example.invalid>
Depends: cockpit, python3 (>= 3.10), systemd, whiptail
Recommends: policykit-1
Suggests: zenity, auditd, aide, lynis, debsums, clamav, openssh-server, fwknop-server, iptables, fail2ban, ufw, postgresql
Description: Modular Cockpit security console for Ubuntu personal servers
 Provides a dependency-aware optional installer for a security dashboard,
 PostgreSQL analytics, a unified event center, verified archives, on-demand
 scanners, and per-key SSH and Single Packet Authorization controls.
EOF

install -m 0755 "$project/packaging/postinst" "$stage/DEBIAN/postinst"
install -m 0755 "$project/packaging/prerm" "$stage/DEBIAN/prerm"
install -m 0755 "$project/packaging/server-security-console-installer" "$stage/usr/sbin/server-security-console-installer"
install -m 0644 "$project/packaging/server-security-console-installer.desktop" "$stage/usr/share/applications/server-security-console-installer.desktop"
install -m 0644 "$project/packaging/components.json" "$stage/usr/share/server-security-console/metadata/components.json"

for path in \
    security_dashboard security_heavy security_keys security_operations \
    postgresql-security-report security-heavy-control security-key-control \
    security-key-session-gate security-key-knock-check security-key-knock.sudoers \
    security-operations-report security-operations-control journald-30day.conf \
    security-log-retention.service security-log-retention.timer \
    security-operations-daily-archive.service security-operations-daily-archive.timer \
    security-operations-weekly-archive.service security-operations-weekly-archive.timer \
    security-alert-monitor.service security-alert-monitor.timer
do
    cp -a "$project/$path" "$stage/usr/share/server-security-console/payload/$path"
done

install -m 0644 "$project/README.md" "$stage/usr/share/doc/server-security-console/README.md"
install -m 0644 "$project/LICENSE" "$stage/usr/share/doc/server-security-console/copyright"
install -m 0644 "$project/SECURITY.md" "$stage/usr/share/doc/server-security-console/SECURITY.md"
cp -a "$project/docs" "$stage/usr/share/doc/server-security-console/docs"
find "$stage/usr/share/server-security-console/payload" -type f -exec chmod 0644 {} +
find "$stage/usr/share/doc/server-security-console/docs" -type f -exec chmod 0644 {} +
find "$stage" -type d -exec chmod 0755 {} +

dpkg-deb --root-owner-group --build "$stage" "$output/server-security-console_${version}_${architecture}.deb"
(cd "$output" && sha256sum "server-security-console_${version}_${architecture}.deb" >"server-security-console_${version}_${architecture}.deb.sha256")
echo "Built $output/server-security-console_${version}_${architecture}.deb"
