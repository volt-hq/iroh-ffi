#!/usr/bin/env python3
"""Bump only the Volt-owned napi package and its platform packages."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
JS_ROOT = REPO / "iroh-js"
OWNED_NAME = "@hansjm10/volt-iroh"


def write_json(path: pathlib.Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def bump(version: str) -> None:
    package_path = JS_ROOT / "package.json"
    package = json.loads(package_path.read_text())
    if package.get("name") != OWNED_NAME:
        sys.exit(f"expected {package_path} name to be {OWNED_NAME!r}")
    package["version"] = version
    # napi pre-publish adds exact platform optionalDependencies after all
    # artifacts exist. Keeping unpublished versions here would break CI install.
    package.pop("optionalDependencies", None)
    write_json(package_path, package)

    platform_paths = sorted((JS_ROOT / "npm").glob("*/package.json"))
    if not platform_paths:
        sys.exit("no platform package manifests found")
    for path in platform_paths:
        platform = json.loads(path.read_text())
        if not platform.get("name", "").startswith(f"{OWNED_NAME}-"):
            sys.exit(f"unexpected platform package name in {path}: {platform.get('name')!r}")
        platform["version"] = version
        write_json(path, platform)

    cargo_path = JS_ROOT / "Cargo.toml"
    cargo = cargo_path.read_text()
    updated, count = re.subn(
        r'(?ms)(\[package\][^\[]*?)\nversion = "[^"]+"',
        lambda match: match.group(1) + f'\nversion = "{version}"',
        cargo,
        count=1,
    )
    if count != 1:
        sys.exit(f"could not find [package].version in {cargo_path}")
    cargo_path.write_text(updated)

    print(f"bumped {OWNED_NAME} and {len(platform_paths)} platform packages to {version}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="semver without a leading v")
    args = parser.parse_args()
    version = args.version.removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        parser.error(f"invalid semver: {args.version!r}")
    bump(version)


if __name__ == "__main__":
    main()
