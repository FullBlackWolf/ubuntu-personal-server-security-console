from __future__ import annotations

import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
APP = ROOT / "docs" / "app"
PACKAGES = ("security_dashboard", "security_operations", "security_heavy", "security_keys")
PRODUCTION_SCRIPT = '<script src="../base1/cockpit.js"></script>'
DEMO_SCRIPT = '<script src="../cockpit-demo.js"></script>'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ProductionParityTests(unittest.TestCase):
    def test_generated_files_match_production_sources(self):
        for package in PACKAGES:
            for source in (ROOT / package).iterdir():
                if not source.is_file() or source.name == "manifest.json":
                    continue
                generated = APP / package / source.name
                self.assertTrue(generated.is_file(), generated)
                if source.suffix == ".html":
                    expected = source.read_text(encoding="utf-8").replace(PRODUCTION_SCRIPT, DEMO_SCRIPT)
                    self.assertEqual(generated.read_text(encoding="utf-8"), expected)
                else:
                    self.assertEqual(generated.read_bytes(), source.read_bytes())

    def test_source_manifest_matches_files(self):
        manifest = json.loads((APP / "source-manifest.json").read_text(encoding="utf-8"))
        for relative, entry in manifest["files"].items():
            self.assertEqual(entry["production_sha256"], digest(ROOT / relative))
            self.assertEqual(entry["demo_sha256"], digest(APP / relative))

    def test_every_production_page_uses_demo_transport_only(self):
        pages = list(APP.glob("*/*.html"))
        self.assertGreaterEqual(len(pages), 6)
        for page in pages:
            content = page.read_text(encoding="utf-8")
            self.assertNotIn("base1/cockpit.js", content)
            self.assertEqual(content.count("../cockpit-demo.js"), 1)


if __name__ == "__main__":
    unittest.main()
