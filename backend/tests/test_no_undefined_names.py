"""Catch NameErrors that only show up at runtime (e.g. after a refactor removes a helper)."""

import ast
import builtins
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def _module_level_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Import):
            names.update((a.asname or a.name).split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.update(a.asname or a.name for a in node.names)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
        elif isinstance(node, ast.alias):
            names.add((node.asname or node.name).split(".")[0])
    return names


class UndefinedNameTests(unittest.TestCase):
    def test_no_loaded_name_is_undefined_anywhere_in_its_module(self) -> None:
        # Deliberately loose (any binding anywhere in the file counts), so it only
        # flags names that are never defined at all, like a deleted helper or constant.
        problems = []
        for path in sorted(APP_DIR.rglob("*.py")):
            tree = ast.parse(path.read_text())
            defined = _module_level_names(tree) | set(dir(builtins)) | {"__file__", "__name__"}
            for node in ast.walk(tree):
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id not in defined:
                    problems.append(f"{path.relative_to(APP_DIR)}:{node.lineno} {node.id}")
        self.assertEqual(problems, [])
