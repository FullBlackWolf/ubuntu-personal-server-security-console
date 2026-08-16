from __future__ import annotations

import ipaddress
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
DATA = json.loads((ROOT / "docs" / "demo-data.json").read_text(encoding="utf-8"))
DOCUMENTATION_NETWORKS = [
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
]


class SyntheticDataTests(unittest.TestCase):
    def test_dataset_is_explicitly_synthetic(self):
        self.assertTrue(DATA["metadata"]["synthetic"])
        self.assertEqual(DATA["metadata"]["schema"], "security-console-public-demo-v1")
        self.assertTrue(DATA["metadata"]["host"].endswith(".example.invalid"))

    def test_expected_event_and_chart_volume(self):
        self.assertEqual(len(DATA["events"]), 360)
        self.assertEqual(len(DATA["postgresql"]["errors_per_minute"]), 168)

    def test_every_address_is_reserved_for_documentation(self):
        for event in DATA["events"]:
            address = ipaddress.ip_address(event["ip"])
            self.assertTrue(any(address in network for network in DOCUMENTATION_NETWORKS), event["ip"])

    def test_no_key_material_or_private_key_header(self):
        raw = json.dumps(DATA)
        self.assertNotIn("BEGIN OPENSSH PRIVATE KEY", raw)
        self.assertNotIn("ssh-ed25519 AAAA", raw)
        self.assertNotIn("github_pat_", raw)


if __name__ == "__main__":
    unittest.main()
