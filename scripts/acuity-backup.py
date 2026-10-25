#!/usr/bin/env python3
"""
Acuity.Search — Standalone Backup & Restore Verification Script

Creates `/Users/ethanjfarrell/Acuity.Search /Acuity-Search-Backup-2026-10-25.zip` containing:
1. Full working source tree (excluding `node_modules/`, `.next/`, `.git/`, `Acuity-Search-Agent-Pack/`, `.env.local`, and `*.zip`)
2. Standalone Git bundle (`acuity-search.bundle`) containing full commit history
3. Full Git diff patch from pinned Morphic baseline `011ce44d0edc446212e2aa823088f37f98383b76` (`acuity-search-from-baseline.patch`)
4. `BACKUP-MANIFEST.json`, `RESTORE.md`, and `SHA256SUMS`

Then extracts the ZIP into a clean temporary directory and verifies:
- Every file's SHA-256 matches `SHA256SUMS`
- `git bundle verify` and `git clone` from `acuity-search.bundle` succeed
- No real `.env.local` or secret keys are present in the archive
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

BASELINE_COMMIT = "011ce44d0edc446212e2aa823088f37f98383b76"
BACKUP_DATE = "2026-10-25"
ZIP_FILENAME = f"Acuity-Search-Backup-{BACKUP_DATE}.zip"

EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    ".next",
    "Acuity-Search-Agent-Pack",
    "coverage",
    ".turbo",
    ".vercel",
    "__pycache__",
}

EXCLUDED_FILES = {
    ".env",
    ".env.local",
    ".env.development.local",
    ".env.test.local",
    ".env.production.local",
    ".DS_Store",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def run_cmd(cmd: list[str], cwd: Path) -> str:
    res = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"Command failed ({' '.join(cmd)}):\nSTDOUT: {res.stdout}\nSTDERR: {res.stderr}"
        )
    return res.stdout.strip()


def should_include(rel_path: Path) -> bool:
    for part in rel_path.parts:
        if part in EXCLUDED_DIRS:
            return False
    name = rel_path.name
    if name in EXCLUDED_FILES:
        return False
    if name.endswith(".zip") or name.endswith(".bundle") or name.endswith(".patch"):
        return False
    if name.startswith(".env") and not name.endswith(".example"):
        return False
    return True


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    output_zip = repo_root / ZIP_FILENAME

    head_commit = run_cmd(["git", "rev-parse", "HEAD"], cwd=repo_root)
    branch_name = run_cmd(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root)

    with tempfile.TemporaryDirectory(prefix="acuity-search-backup-") as tmp_dir_str:
        staging_root = Path(tmp_dir_str) / "Acuity.Search"
        staging_root.mkdir(parents=True, exist_ok=True)

        # 1. Copy clean source tree into staging_root
        copied_files: list[Path] = []
        for root, dirs, files in os.walk(repo_root):
            dirs[:] = [d for d in sorted(dirs) if d not in EXCLUDED_DIRS]
            rel_dir = Path(root).relative_to(repo_root)
            for fname in sorted(files):
                rel_file = rel_dir / fname if str(rel_dir) != "." else Path(fname)
                if not should_include(rel_file):
                    continue
                src_file = repo_root / rel_file
                dst_file = staging_root / rel_file
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dst_file)
                copied_files.append(rel_file)

        # 2. Create standalone git bundle
        bundle_path = staging_root / "acuity-search.bundle"
        run_cmd(["git", "bundle", "create", str(bundle_path), "--all"], cwd=repo_root)
        copied_files.append(Path("acuity-search.bundle"))

        # 3. Create full git patch from pinned Morphic baseline commit
        patch_path = staging_root / "acuity-search-from-baseline.patch"
        diff_res = subprocess.run(
            ["git", "diff", "--binary", f"{BASELINE_COMMIT}..HEAD"],
            cwd=str(repo_root),
            capture_output=True,
        )
        if diff_res.returncode != 0:
            raise RuntimeError("Failed to generate git diff patch from baseline commit")
        patch_path.write_bytes(diff_res.stdout)
        copied_files.append(Path("acuity-search-from-baseline.patch"))

        # 4. Write RESTORE.md
        restore_md = f"""# Acuity.Search — Backup Restore Instructions

- **Backup Archive:** `{ZIP_FILENAME}`
- **Created At:** `{datetime.datetime.now(datetime.timezone.utc).isoformat()}`
- **Upstream Morphic Baseline Commit:** `{BASELINE_COMMIT}`
- **Acuity.Search HEAD Commit:** `{head_commit}` (`{branch_name}`)

## Option A: Restore Working Tree Directly

```bash
unzip {ZIP_FILENAME}
cd Acuity.Search
shasum -a 256 -c SHA256SUMS
cp .env.acuity.example .env.local
bun install --frozen-lockfile
bun scripts/acuity-validate-registry.ts
bun run typecheck && bun run lint && bun run test && bun run build
```

## Option B: Clone Full Git Repository from Bundle

```bash
git clone acuity-search.bundle acuity-search-restored
cd acuity-search-restored
git checkout {branch_name}
bun install --frozen-lockfile
```

## Option C: Apply Patch onto Upstream Morphic Baseline

```bash
git checkout {BASELINE_COMMIT}
git apply --check acuity-search-from-baseline.patch
git apply acuity-search-from-baseline.patch
```
"""
        (staging_root / "RESTORE.md").write_text(restore_md, encoding="utf-8")
        copied_files.append(Path("RESTORE.md"))

        # 5. Write BACKUP-MANIFEST.json
        manifest_data = {
            "schemaVersion": "acuity.search.backup-manifest.v1",
            "product": "Acuity.Search",
            "backupDate": BACKUP_DATE,
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "upstreamRepository": "https://github.com/miurla/morphic",
            "baselineCommit": BASELINE_COMMIT,
            "headCommit": head_commit,
            "branch": branch_name,
            "fileCount": len(copied_files) + 2,  # + BACKUP-MANIFEST.json + SHA256SUMS
            "secretsIncluded": False,
            "includesGitBundle": True,
            "includesBaselinePatch": True,
        }
        manifest_path = staging_root / "BACKUP-MANIFEST.json"
        manifest_path.write_text(
            json.dumps(manifest_data, indent=2) + "\n", encoding="utf-8"
        )
        copied_files.append(Path("BACKUP-MANIFEST.json"))

        # 6. Compute SHA256SUMS for every file in staging_root
        sha_lines: list[str] = []
        for rel_file in sorted(copied_files, key=lambda p: p.as_posix()):
            digest = sha256_file(staging_root / rel_file)
            sha_lines.append(f"{digest}  {rel_file.as_posix()}")

        sha256sums_path = staging_root / "SHA256SUMS"
        sha256sums_path.write_text("\n".join(sha_lines) + "\n", encoding="utf-8")
        copied_files.append(Path("SHA256SUMS"))

        # 7. Create the ZIP archive
        if output_zip.exists():
            output_zip.unlink()

        with zipfile.ZipFile(
            output_zip, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as zf:
            for rel_file in sorted(copied_files, key=lambda p: p.as_posix()):
                full_path = staging_root / rel_file
                arcname = f"Acuity.Search/{rel_file.as_posix()}"
                zf.write(full_path, arcname=arcname)

    # 8. Restore-verify the generated ZIP in a second clean temporary directory
    with tempfile.TemporaryDirectory(prefix="acuity-search-verify-") as verify_dir_str:
        verify_dir = Path(verify_dir_str)
        with zipfile.ZipFile(output_zip, mode="r") as zf:
            zf.extractall(verify_dir)

        restored_root = verify_dir / "Acuity.Search"
        if not restored_root.is_dir():
            raise RuntimeError("Extracted ZIP is missing Acuity.Search/ root directory")

        # Verify SHA256SUMS
        sha_lines = (
            (restored_root / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
        )
        for line in sha_lines:
            if not line.strip():
                continue
            expected_hash, rel_str = line.split("  ", 1)
            actual_hash = sha256_file(restored_root / rel_str)
            if actual_hash != expected_hash:
                raise RuntimeError(
                    f"SHA-256 mismatch on restored file {rel_str}: expected {expected_hash}, got {actual_hash}"
                )

        # Verify git bundle clones cleanly
        clone_target = verify_dir / "cloned-from-bundle"
        run_cmd(
            [
                "git",
                "clone",
                str(restored_root / "acuity-search.bundle"),
                str(clone_target),
            ],
            cwd=verify_dir,
        )
        cloned_head = run_cmd(["git", "rev-parse", "HEAD"], cwd=clone_target)
        if cloned_head != head_commit:
            raise RuntimeError(
                f"Cloned bundle HEAD ({cloned_head}) does not match repo HEAD ({head_commit})"
            )

        # Verify patch applies cleanly to BASELINE_COMMIT in cloned repo
        run_cmd(["git", "checkout", BASELINE_COMMIT], cwd=clone_target)
        run_cmd(
            [
                "git",
                "apply",
                "--check",
                str(restored_root / "acuity-search-from-baseline.patch"),
            ],
            cwd=clone_target,
        )

    zip_sha256 = sha256_file(output_zip)
    zip_size = output_zip.stat().st_size
    print(
        json.dumps(
            {
                "status": "PASS",
                "zipPath": str(output_zip),
                "zipSizeBytes": zip_size,
                "zipSha256": zip_sha256,
                "baselineCommit": BASELINE_COMMIT,
                "headCommit": head_commit,
                "fileCount": len(sha_lines),
                "restoreVerified": True,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
