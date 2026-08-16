# Security policy

## Reporting a vulnerability

Open a GitHub security advisory for vulnerabilities. Do not include live credentials, private keys, authentication cookies, private log content, or exploitable production endpoints in a public issue.

## Release privacy checklist

Before publishing a fork or release:

1. Confirm that only repository files are staged: `git status --short`.
2. Search for home-directory paths, emails, tokens, private-key headers, SSH public keys, IP addresses, and credential assignments.
3. Inspect the Debian payload with `dpkg-deb --contents` and `dpkg-deb --fsys-tarfile`.
4. Verify that `/var/lib`, `/var/log`, `/var/backups`, `.env`, key files, and generated archives are absent.
5. Review the Git history as well as the current tree before making the repository public.

This repository intentionally uses documentation-only example addresses from `192.0.2.0/24` and `example.com`, which are reserved for examples.
