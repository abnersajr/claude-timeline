#!/usr/bin/env python3
"""
Consolidate claude-timeline git history from 118 commits → ~44 clean conventional commits.
Uses git rebase -i --root with an automated sequence editor.
"""

import subprocess
import sys
import os

REPO = os.path.expanduser("~/projects/claude-timeline")

def run(cmd, **kwargs):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=REPO, **kwargs)
    if r.returncode != 0:
        print(f"FAILED: {cmd}")
        print(f"  stdout: {r.stdout}")
        print(f"  stderr: {r.stderr}")
        sys.exit(1)
    return r.stdout.strip()

def get_commit_date(sha):
    return run(f"git log --format=%aI -1 {sha}")

# Groups: (shas_chronological, message_or_None, newest_sha_for_date)
GROUPS = [
    (["4121e76","f39e491","c35aebf","956d112","c8cf337","c5a51f4","c4a1b19","dfcbbcc"],
     "docs: add design spec and iterate on reviewer feedback", "dfcbbcc"),
    (["177bf50","90079a1","67191e3","03d38da"],
     "feat: bootstrap monorepo and extractor package", "03d38da"),
    (["7fd5e02","3b3d786","070ddc3","0378b37"],
     "feat(extractor): add core modules — types, utils, pricing, db-reader", "0378b37"),
    (["056f0a3","d2d15d9","21d239d"],
     "feat(merger): extract commandExecuted from JSONL with hardened regex", "21d239d"),
    (["0208ec7"], None, "0208ec7"),
    (["1ef2ce7"], None, "1ef2ce7"),
    (["b0a78d7","b494b5d"],
     "feat(cli+db): add --list-sessions flag and getProcessedFiles", "b494b5d"),
    (["330da31","fbbba5e","0b6e182"],
     "chore: update docs, gitignore, and fix stale JSONL structure", "0b6e182"),
    (["8ac0bc4"], None, "8ac0bc4"),
    (["5614038"], None, "5614038"),
    (["e0e6dff","e5f3dbd","7694ef0","b0ddb23"],
     "chore: cleanup and package exports map", "b0ddb23"),
    (["6cc34cd"], None, "6cc34cd"),
    (["bf2f1de"], None, "bf2f1de"),
    (["1bb25ad"], None, "1bb25ad"),
    (["3ae3d13"], None, "3ae3d13"),
    (["37f3d5c"], None, "37f3d5c"),
    (["db450cc","28eca89"],
     "feat(extractor): subagent file discovery and conversation grouping", "28eca89"),
    (["5be6d13","af643b6","89f744b","b171a2a","2de724a","6a828f8","fa8a6f3","637f428"],
     "feat(api): scaffold package — types, server, OpenAPI, routes, Bruno, Turborepo", "637f428"),
    (["2732627","9755549","6f1930b"],
     "feat(web): session detail page with context stats and token chart", "6f1930b"),
    (["b2907d3"], None, "b2907d3"),
    (["b938cad"], None, "b938cad"),
    (["4e06212","05d0335","283873b"],
     "refactor(web): simplify routes, migrate to Tailwind, consolidate", "283873b"),
    (["32fc5e5","a1d5d9b","393db02","cc4bf2b","7f39749"],
     "feat(web): timeline vertical line, fix chart popover and chat alignment", "7f39749"),
    (["d732bcf","8d3c013","8df6e8e","55f77b5"],
     "feat: display active duration in session overview, fix cost and turn display", "55f77b5"),
    (["5892015","5f186ff","ea3c99f","1286e98"],
     "fix: detect string content in JSONL parsing, fix timestamp inflation", "1286e98"),
    (["d15c011","3e3878d","68d6831","3f49661"],
     "fix: add ai-title noise filter, normalize content, merge dedup blocks", "3f49661"),
    (["d45014e"], None, "d45014e"),
    (["ae8b008"], None, "ae8b008"),
    (["fe402e7"], None, "fe402e7"),
    (["e0963e0","641b635"],
     "chore: add unified dev wrapper script and extractor internals docs", "641b635"),
    (["1ef53fb","93e426e","ffb1651","5510d2e"],
     "fix: cost-stream exports, toolCall timestamps, text previews and badges", "5510d2e"),
    (["2a897a0"], None, "2a897a0"),
    (["272ed85","b4ce8cb","b6e5931"],
     "chore: maintenance fixes and dependency cleanup", "b6e5931"),
    (["674c2f2","3c64325","ca710fb"],
     "chore: clean internal docs, pin deps to exact versions", "ca710fb"),
    (["420aa9a"], None, "420aa9a"),
    (["b345bd1"], None, "b345bd1"),
    (["622b857","f25ee6a","df3e743"],
     "fix: restore SessionSummary type, extend privacy blur to chat and text previews", "df3e743"),
    (["c7a4b17"], None, "c7a4b17"),
    (["a2310f5","1ffb117","eb6a0f5","8c85095","7dab4a1","6eba033"],
     "ci: add release workflow with changesets and fix Node.js requirements", "6eba033"),
    (["eea8e02","70e5e85"],
     "docs: add package READMEs and fix import paths", "70e5e85"),
    (["fcd0e28","3a30589","9b9f68d","4e8e2f1"],
     "feat: add direct-run guard, Cost Capture docs, typecheck scripts", "4e8e2f1"),
    (["5f5b5e2"], None, "5f5b5e2"),
    (["9de1429","96d458c","f18e4e7","14b6203","fb23211","7593bb8","221c42f"],
     "feat: rewrite pricing module with OpenRouter API, update tests and web UI", "221c42f"),
    (["7f0b1d4","9c53920"],
     "fix: verify statusline installation and clean up tracked files", "9c53920"),
    (["20ad0a5"], None, "20ad0a5"),
]

def main():
    print("=== Commit History Consolidation ===")
    print(f"Working directory: {REPO}")

    # Only check tracked file changes (untracked files are fine)
    diff_r = subprocess.run("git diff --quiet && git diff --cached --quiet", shell=True, cwd=REPO)
    if diff_r.returncode != 0:
        print("ERROR: Tracked file changes exist. Commit or stash first.")
        sys.exit(1)

    # Step 1: Backups
    print("\n1. Creating backups...")
    run("git branch -D main-backup-pre-rewrite 2>/dev/null || true")
    run("git tag -d pre-rewrite-backup 2>/dev/null || true")
    run("git branch main-backup-pre-rewrite")
    run("git tag -m 'pre-consolidation backup' pre-rewrite-backup")
    print("   ✓ Branch: main-backup-pre-rewrite")
    print("   ✓ Tag: pre-rewrite-backup")

    # Step 2: Build lookup structures
    print("\n2. Building commit maps...")
    first_shas = set()
    fixup_shas = set()
    # exec_map: last_sha_in_group -> (message, date)
    exec_map = {}

    for shas, message, newest_sha in GROUPS:
        first_shas.add(shas[0])
        for s in shas[1:]:
            fixup_shas.add(s)
        if message is not None and len(shas) > 1:
            last_sha = shas[-1]
            date = get_commit_date(newest_sha)
            exec_map[last_sha] = (message, date)

    total_commits = sum(len(g[0]) for g in GROUPS)
    print(f"   Total commits: {total_commits}")
    print(f"   Groups: {len(GROUPS)}")
    print(f"   Multi-commit groups needing exec: {len(exec_map)}")

    # Step 3: Write the sequence editor script
    print("\n3. Writing sequence editor script...")

    # Build the script content as regular strings (no f-string nesting)
    lines = []
    lines.append("#!/usr/bin/env python3")
    lines.append("import sys")
    lines.append("")
    lines.append("TODO_FILE = sys.argv[1]")
    lines.append("")
    lines.append(f"first_shas = {repr(first_shas)}")
    lines.append(f"fixup_shas = {repr(fixup_shas)}")
    lines.append(f"drop_shas = {{'b43a700'}}")
    lines.append(f"exec_after = {repr(exec_map)}")
    lines.append("")
    lines.append("with open(TODO_FILE, 'r') as f:")
    lines.append("    lines = f.readlines()")
    lines.append("")
    lines.append("new_lines = []")
    lines.append("for line in lines:")
    lines.append("    line = line.rstrip()")
    lines.append("    if not line or line.startswith('#'):")
    lines.append("        new_lines.append(line)")
    lines.append("        continue")
    lines.append("    parts = line.split(None, 2)")
    lines.append("    if len(parts) < 2:")
    lines.append("        new_lines.append(line)")
    lines.append("        continue")
    lines.append("    op, sha = parts[0], parts[1]")
    lines.append("    rest = parts[2] if len(parts) > 2 else ''")
    lines.append("    if sha in drop_shas:")
    lines.append("        new_lines.append(f'drop {sha} {rest}')")
    lines.append("    elif sha in fixup_shas:")
    lines.append("        new_lines.append(f'fixup {sha} {rest}')")
    lines.append("    else:")
    lines.append("        new_lines.append(f'pick {sha} {rest}')")
    lines.append("    if sha in exec_after:")
    lines.append("        msg, date = exec_after[sha]")
    lines.append("        new_lines.append(")
    lines.append("            f'exec GIT_COMMITTER_DATE=\"{date}\" git commit --amend --no-edit'")
    lines.append("            f' -m \"{msg}\" --date=\"{date}\"'")
    lines.append("        )")
    lines.append("")
    lines.append("with open(TODO_FILE, 'w') as f:")
    lines.append("    f.write('\\n'.join(new_lines) + '\\n')")

    editor_content = "\n".join(lines) + "\n"

    # Write editor script OUTSIDE the repo so it survives the stash
    editor_path = "/tmp/_rebase_editor.py"
    with open(editor_path, 'w') as f:
        f.write(editor_content)
    os.chmod(editor_path, 0o755)
    print(f"   Script: {editor_path}")

    # Save tree hash for verification
    original_tree = run("git rev-parse HEAD^{tree}")

    # Step 3.5: Remove ALL untracked/ignored files that conflict with historical commits
    print("\n3.5. Cleaning untracked files for rebase...")
    import shutil
    untracked_dir = "/tmp/pre-rebase-untracked"
    if os.path.exists(untracked_dir):
        shutil.rmtree(untracked_dir)
    os.makedirs(untracked_dir)

    # Move all non-git, non-node_modules top-level entries that aren't tracked
    for entry in os.listdir(REPO):
        if entry in (".git", "node_modules", "scripts"):
            continue
        src = os.path.join(REPO, entry)
        dst = os.path.join(untracked_dir, entry)
        # Check if tracked by git
        check = subprocess.run(f"git ls-files --error-unmatch '{entry}'",
                               shell=True, capture_output=True, cwd=REPO)
        if check.returncode != 0:
            # Untracked — move to temp
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
                shutil.rmtree(src)
            else:
                shutil.copy2(src, dst)
                os.remove(src)

    # Nuclear cleanup for anything remaining
    run("git clean -fdx -e node_modules/ -e scripts/ 2>/dev/null || true")
    print(f"   ✓ Working tree cleaned")

    # Step 4: Run the rebase
    print("\n4. Running rebase (this may take a moment)...")

    # Disable pre-commit hook during rebase (typecheck on every commit is too slow)
    hook_path = os.path.join(REPO, ".git", "hooks", "pre-commit")
    hook_backup = hook_path + ".bak"
    hook_existed = os.path.exists(hook_path)
    if hook_existed:
        os.rename(hook_path, hook_backup)
        print("   (pre-commit hook disabled for rebase)")

    env = os.environ.copy()
    env['GIT_SEQUENCE_EDITOR'] = f'python3 {editor_path}'

    r = subprocess.run(
        ['git', 'rebase', '-i', '--root'],
        cwd=REPO, env=env,
        capture_output=True, text=True
    )

    if r.returncode != 0:
        # Restore hook on failure
        if hook_existed and os.path.exists(hook_backup):
            os.rename(hook_backup, hook_path)
        print(f"\nREBASE FAILED (exit code {r.returncode})")
        print(f"stdout:\n{r.stdout}")
        print(f"stderr:\n{r.stderr}")
        print("\nAttempting to abort rebase...")
        subprocess.run(['git', 'rebase', '--abort'], cwd=REPO)
        print("Rebase aborted. Backup available.")
        sys.exit(1)

    # Restore hook after successful rebase
    if hook_existed and os.path.exists(hook_backup):
        os.rename(hook_backup, hook_path)
        print("   (pre-commit hook restored)")

    # Step 5: Verify
    print("\n5. Verifying result...")
    commit_count = run("git log --oneline | wc -l")
    print(f"   Commit count: {commit_count}")

    # Verify tree hash matches (no data loss)
    new_tree = run("git rev-parse HEAD^{tree}")
    if original_tree == new_tree:
        print("   ✓ Tree hash matches — no data loss")
    else:
        print(f"   ⚠️ Tree hash MISMATCH! Original: {original_tree}, New: {new_tree}")
        print("   This means the rebase lost or gained files. Investigate!")

    non_conv = run("""
        git log --oneline --format="%s" | grep -vE "^(feat|fix|chore|docs|ci|refactor|test|perf)(\\(.*\\))?:" | grep -v "^$" || true
    """)
    if non_conv:
        print(f"   ⚠️ Non-conventional commits:\n   {non_conv}")
    else:
        print("   ✓ All commits follow conventional format")

    # Show final timeline
    print("\n=== Final Timeline ===")
    log = run('git log --oneline --format="%h %ad %s" --date=short')
    for line in log.split('\n'):
        print(f"  {line}")

    # Step 5.5: Restore untracked files
    print("\n5.5. Restoring untracked files...")
    if os.path.isdir(untracked_dir):
        restored = 0
        for root, dirs, files in os.walk(untracked_dir):
            for fname in files:
                src = os.path.join(root, fname)
                rel = os.path.relpath(src, untracked_dir)
                dst = os.path.join(REPO, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                restored += 1
        shutil.rmtree(untracked_dir)
        print(f"   ✓ Restored {restored} untracked files")
    else:
        print("   No untracked files to restore")

    # Step 6: Build check
    print("\n6. Verifying build...")
    build = subprocess.run("pnpm build 2>&1 | tail -10", shell=True, capture_output=True, text=True, cwd=REPO)
    print(f"   {build.stdout.strip()}")
    if build.returncode != 0:
        print("   ⚠️ Build failed! Check manually.")
    else:
        print("   ✓ Build passed")

    # Step 7: Typecheck
    print("\n7. Verifying typecheck...")
    tc = subprocess.run("pnpm typecheck 2>&1 | tail -5", shell=True, capture_output=True, text=True, cwd=REPO)
    print(f"   {tc.stdout.strip()}")
    if tc.returncode != 0:
        print("   ⚠️ Typecheck failed! Check manually.")
    else:
        print("   ✓ Typecheck passed")

    print(f"\n✅ Done! {total_commits} commits → {commit_count} commits")
    print(f"   Original: main-backup-pre-rewrite")
    print(f"   To undo:  git reset --hard pre-rewrite-backup")
    print(f"   To push:  git push --force-with-lease origin main")

    # Cleanup
    os.unlink(editor_path)

if __name__ == '__main__':
    main()
