from __future__ import annotations

import importlib.machinery
import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "packaging" / "server-security-console-installer"
loader = importlib.machinery.SourceFileLoader("console_installer", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
installer = importlib.util.module_from_spec(spec)
loader.exec_module(installer)


class DependencyTests(unittest.TestCase):
    def test_automation_has_transitive_dependencies(self):
        self.assertEqual(
            installer.dependency_closure({"automation"}),
            {"dashboard", "postgresql", "operations", "automation"},
        )

    def test_scanners_require_dashboard(self):
        self.assertEqual(installer.dependency_closure({"scanners"}), {"dashboard", "scanners"})

    def test_ssh_manager_requires_dashboard(self):
        self.assertEqual(installer.dependency_closure({"ssh_keys"}), {"dashboard", "ssh_keys"})

    def test_unknown_component_is_rejected(self):
        with self.assertRaises(ValueError):
            installer.parse_components("dashboard,arbitrary-command")


class PayloadSafetyTests(unittest.TestCase):
    def test_targets_are_absolute_and_unique(self):
        targets = []
        for component in installer.COMPONENTS.values():
            for _, target, _ in component["files"]:
                self.assertTrue(target.startswith(("/etc/", "/usr/")))
                self.assertNotIn("..", Path(target).parts)
                targets.append(target)
        self.assertEqual(len(targets), len(set(targets)))

    def test_privileged_modes_are_not_world_writable(self):
        for component in installer.COMPONENTS.values():
            for _, _, mode in component["files"]:
                self.assertEqual(mode & 0o002, 0)


if __name__ == "__main__":
    unittest.main()
