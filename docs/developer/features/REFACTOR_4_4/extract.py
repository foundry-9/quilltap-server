#!/usr/bin/env python3
"""
Extract function/method signatures from TypeScript/TSX files using regex.
Not perfect — TS is not a regular language — but good enough to cluster.

Outputs JSONL: one row per function found, with fields:
  file, line, name, kind, params, returns, async, exported, area, snippet
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

# Areas
def classify_area(rel: str) -> str:
    """Classify file into 'api' (backend) or 'frontend' or 'shared' or 'skip'."""
    # Skip
    skip_dirs = ("node_modules/", ".next/", ".swc/", "coverage/", "test-results/",
                 "playwright-report/", "__mocks__/", "__tests__/",
                 "scripts/", "migrations/", "plugins/", "packages/",
                 "first-startup/", "cicd/", "docker/", "website/",
                 "themes/", "help/", "public/", "types/", "stubs/")
    for s in skip_dirs:
        if rel.startswith(s):
            return "skip"
    # Tests
    if ".test." in rel or ".spec." in rel or ".stories." in rel:
        return "skip"

    # API/backend
    if rel.startswith("app/api/"):
        return "api"
    # All of lib is server-leaning except a few client utility files
    if rel.startswith("lib/"):
        # Client-only sub-areas
        if rel.startswith("lib/hooks/"):
            return "frontend"
        # Most lib is server-side or shared infra
        return "api"
    if rel.startswith("instrumentation.") or rel.startswith("proxy.") or rel.startswith("server."):
        return "api"

    # Frontend
    if rel.startswith("app/"):
        return "frontend"
    if rel.startswith("components/"):
        return "frontend"
    if rel.startswith("hooks/"):
        return "frontend"

    return "skip"


# Function declaration patterns
# 1. function decls: [export] [async] function name(...) [: ReturnType]
# 2. arrow fn const: [export] const name = [async] (...) [: ReturnType] =>
# 3. class methods: methodName(...) [: ReturnType] { (inside a class)

FUNC_DECL_RE = re.compile(
    r"^(?P<indent>\s*)(?P<export>export\s+(?:default\s+)?)?(?P<async>async\s+)?function\s*\*?\s*(?P<name>[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\((?P<params>[^)]*?)\)\s*(?::\s*(?P<ret>[^{=]+?))?\s*[{;]",
    re.MULTILINE,
)

ARROW_RE = re.compile(
    r"^(?P<indent>\s*)(?P<export>export\s+(?:default\s+)?)?(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?\s*=\s*(?P<async>async\s+)?(?:<[^>]*>\s*)?\((?P<params>[^)]*?)\)\s*(?::\s*(?P<ret>[^=]+?))?\s*=>",
    re.MULTILINE,
)

# Class method - rougher; tries to catch methods within class bodies
METHOD_RE = re.compile(
    r"^(?P<indent>\s{2,})(?:(?P<vis>public|private|protected)\s+)?(?:(?P<static>static)\s+)?(?P<async>async\s+)?(?P<name>[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\((?P<params>[^)]*?)\)\s*(?::\s*(?P<ret>[^{;]+?))?\s*\{",
    re.MULTILINE,
)

# Skip well-known names that aren't real functions (loops, etc.)
NOT_FUNCTION_NAMES = {
    "if", "for", "while", "switch", "catch", "do", "return", "throw",
    "constructor",  # we'll treat constructors specially below
}


def normalize_params(params: str) -> str:
    """Strip default values and types to count positional arity; keep names."""
    if not params.strip():
        return ""
    # Naive split on top-level commas
    depth = 0
    parts = []
    cur = []
    for ch in params:
        if ch in "<({[":
            depth += 1
        elif ch in ">)}]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if cur:
        parts.append("".join(cur).strip())
    return ", ".join(parts)


def first_param_type(params: str) -> str:
    """Get first parameter's type annotation (rough)."""
    if not params.strip():
        return ""
    # First top-level comma split
    depth = 0
    end = len(params)
    for i, ch in enumerate(params):
        if ch in "<({[":
            depth += 1
        elif ch in ">)}]":
            depth -= 1
        elif ch == "," and depth == 0:
            end = i
            break
    first = params[:end]
    if ":" in first:
        return first.split(":", 1)[1].strip()
    return ""


def extract_from_file(path: Path, rel: str, area: str):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return

    # Avoid huge generated files
    if len(text) > 600_000:
        return

    # Determine inside-class context naively (for methods)
    # We'll record line offsets of `class X {` and `}` to know depth.
    # Cheap approach: any method-pattern hit inside a file containing `class\s+\w+`.
    has_class = bool(re.search(r"\bclass\s+[A-Z]", text))

    seen = set()

    for m in FUNC_DECL_RE.finditer(text):
        name = m.group("name")
        if name in NOT_FUNCTION_NAMES:
            continue
        line = text[: m.start()].count("\n") + 1
        params = normalize_params(m.group("params") or "")
        ret = (m.group("ret") or "").strip().rstrip(":{").strip()
        key = ("fn", name, line)
        if key in seen:
            continue
        seen.add(key)
        yield {
            "file": rel,
            "line": line,
            "name": name,
            "kind": "function",
            "params": params,
            "param_count": 0 if not params else len([p for p in params.split(",") if p.strip()]),
            "first_param_type": first_param_type(m.group("params") or ""),
            "returns": ret,
            "async": bool(m.group("async")),
            "exported": bool(m.group("export")),
            "area": area,
        }

    for m in ARROW_RE.finditer(text):
        name = m.group("name")
        line = text[: m.start()].count("\n") + 1
        params = normalize_params(m.group("params") or "")
        ret = (m.group("ret") or "").strip()
        key = ("arrow", name, line)
        if key in seen:
            continue
        seen.add(key)
        yield {
            "file": rel,
            "line": line,
            "name": name,
            "kind": "arrow",
            "params": params,
            "param_count": 0 if not params else len([p for p in params.split(",") if p.strip()]),
            "first_param_type": first_param_type(m.group("params") or ""),
            "returns": ret,
            "async": bool(m.group("async")),
            "exported": bool(m.group("export")),
            "area": area,
        }

    if has_class:
        for m in METHOD_RE.finditer(text):
            name = m.group("name")
            if name in NOT_FUNCTION_NAMES:
                continue
            # Skip if this is actually one of the function/arrow matches we already have
            line = text[: m.start()].count("\n") + 1
            key = ("method", name, line)
            if key in seen:
                continue
            # Don't double-count function declarations as methods
            if ("fn", name, line) in seen or ("arrow", name, line) in seen:
                continue
            params = normalize_params(m.group("params") or "")
            ret = (m.group("ret") or "").strip()
            seen.add(key)
            yield {
                "file": rel,
                "line": line,
                "name": name,
                "kind": "method",
                "params": params,
                "param_count": 0 if not params else len([p for p in params.split(",") if p.strip()]),
                "first_param_type": first_param_type(m.group("params") or ""),
                "returns": ret,
                "async": bool(m.group("async")),
                "exported": False,
                "area": area,
            }


def main():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # Prune
        dirnames[:] = [d for d in dirnames if d not in (
            "node_modules", ".next", ".swc", ".git", "coverage",
            "test-results", "playwright-report", "dist", "build",
        )]
        for fn in filenames:
            if not (fn.endswith(".ts") or fn.endswith(".tsx")):
                continue
            if fn.endswith(".d.ts"):
                continue
            p = Path(dirpath) / fn
            rel = str(p.relative_to(ROOT))
            area = classify_area(rel)
            if area == "skip":
                continue
            for row in extract_from_file(p, rel, area):
                out.append(row)
    for row in out:
        print(json.dumps(row))


if __name__ == "__main__":
    main()
