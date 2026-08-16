#!/usr/bin/python3
"""Build the public preview from the production Cockpit page sources."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil


ROOT = Path(__file__).parents[1]
OUTPUT = ROOT / "docs" / "app"
PACKAGES = ("security_dashboard", "security_operations", "security_heavy", "security_keys")
COCKPIT_SOURCE = '<script src="../base1/cockpit.js"></script>'
DEMO_SOURCE = '<script src="../cockpit-demo.js"></script>'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if OUTPUT.exists():
    shutil.rmtree(OUTPUT)
OUTPUT.mkdir(parents=True)

manifest: dict[str, object] = {
    "schema": "security-console-demo-source-manifest-v1",
    "statement": "Generated directly from production Cockpit assets; only the Cockpit transport script URL is replaced.",
    "files": {},
}

for package in PACKAGES:
    source_dir = ROOT / package
    target_dir = OUTPUT / package
    target_dir.mkdir()
    for source in sorted(source_dir.iterdir()):
        if not source.is_file() or source.name == "manifest.json":
            continue
        relative = f"{package}/{source.name}"
        target = target_dir / source.name
        if source.suffix == ".html":
            content = source.read_text(encoding="utf-8")
            if COCKPIT_SOURCE not in content:
                raise RuntimeError(f"Cockpit script tag not found in {relative}")
            target.write_text(content.replace(COCKPIT_SOURCE, DEMO_SOURCE), encoding="utf-8")
        else:
            shutil.copy2(source, target)
        manifest["files"][relative] = {
            "production_sha256": digest(source),
            "demo_sha256": digest(target),
            "transport_patch_only": source.suffix == ".html",
        }

shutil.copy2(ROOT / "docs" / "cockpit-demo.js", OUTPUT / "cockpit-demo.js")
(OUTPUT / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Built production-faithful preview with {len(manifest['files'])} Cockpit assets")
