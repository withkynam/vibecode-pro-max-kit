#!/usr/bin/env bash
set -euo pipefail

# vibecode-pro-max-kit installer
# Clean install with backup for both new and existing projects.
# Replaces .claude/, .codex/, .agents/, CLAUDE.md, AGENTS.md with kit versions.
# Preserves: process/ (user content), .claude/settings.json (user config).
# After this script, run Claude Code and say "Run vc-setup" to
# auto-detect your project, scaffold process/, and populate context.

REPO="https://github.com/withkynam/vibecode-pro-max-kit.git"
TMPDIR="/tmp/vc-kit-install-$$"
BACKUP_DIR=".vibecode-backup"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() { rm -rf "$TMPDIR" 2>/dev/null; }
trap cleanup EXIT

echo ""
echo "  vibecode-pro-max-kit installer"
echo "  ─────────────────────────────────"
echo ""

# ══════════════════════════════════════════════════════
# Preflight: Node.js required
# ══════════════════════════════════════════════════════
if ! command -v node &>/dev/null; then
  echo "  Error: Node.js is required but not found in PATH."
  echo "  Install Node.js >= 22 and try again."
  exit 1
fi

# Clone kit to temp
echo "  Fetching kit..."
git clone --depth 1 --quiet "$REPO" "$TMPDIR"

# Read version from manifest
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPDIR/vc-manifest.json','utf8')).version)" 2>/dev/null || echo "unknown")
echo "  Kit version: $VERSION"
echo ""

# ══════════════════════════════════════════════════════
# Resolve manifest to get file list + metadata
# ══════════════════════════════════════════════════════
MANIFEST_JSON=$(node "$TMPDIR/resolve-manifest.mjs" --root "$TMPDIR" --json 2>/dev/null)
if [ -z "$MANIFEST_JSON" ]; then
  echo "  Error: Failed to resolve manifest. Check Node.js version (>= 22 required)."
  exit 1
fi

# Extract file list, merge list, copyIfMissing list, and symlinks from JSON
FILES=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  d.files.forEach(f => console.log(f));
")
MERGE_FILES=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  d.merge.forEach(f => console.log(f));
")
COPY_IF_MISSING=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  d.copyIfMissing.forEach(f => console.log(f));
")
SYMLINKS_JSON=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  for (const [k,v] of Object.entries(d.symlinks)) console.log(k + '|' + v);
")

# ══════════════════════════════════════════════════════
# Backup existing setup (if any)
# ══════════════════════════════════════════════════════
HAS_EXISTING=false
if [ -d ".claude" ] || [ -d ".codex" ] || [ -d ".agents" ] || [ -f "CLAUDE.md" ] || [ -f "AGENTS.md" ]; then
  HAS_EXISTING=true
  echo -e "  ${YELLOW}Existing setup detected.${NC} Backing up..."
  mkdir -p "$BACKUP_DIR"

  # Back up directories
  [ -d ".claude" ] && cp -R .claude "$BACKUP_DIR/.claude" && echo -e "    ${YELLOW}Backed up${NC} .claude/"
  [ -d ".codex" ] && cp -R .codex "$BACKUP_DIR/.codex" && echo -e "    ${YELLOW}Backed up${NC} .codex/"
  [ -d ".agents" ] && cp -R .agents "$BACKUP_DIR/.agents" && echo -e "    ${YELLOW}Backed up${NC} .agents/"

  # Back up root protocol files
  [ -f "CLAUDE.md" ] && cp CLAUDE.md "$BACKUP_DIR/CLAUDE.md" && echo -e "    ${YELLOW}Backed up${NC} CLAUDE.md"
  [ -f "AGENTS.md" ] && cp AGENTS.md "$BACKUP_DIR/AGENTS.md" && echo -e "    ${YELLOW}Backed up${NC} AGENTS.md"
  [ -f "GUIDE.md" ] && cp GUIDE.md "$BACKUP_DIR/GUIDE.md" && echo -e "    ${YELLOW}Backed up${NC} GUIDE.md"

  echo -e "    Backup at: ${CYAN}$BACKUP_DIR/${NC}"
  echo ""

  # Clean slate — remove old agent tooling dirs
  rm -rf .claude .codex .agents
fi

# ══════════════════════════════════════════════════════
# Install kit — resolver-driven copy
# ══════════════════════════════════════════════════════
INSTALLED_COUNT=0
SKIPPED_MERGE=0
SKIPPED_COPY_IF_MISSING=0

echo "  Installing files..."

while IFS= read -r file; do
  [ -z "$file" ] && continue

  # Check if this file is in the merge list AND exists locally
  IS_MERGE=false
  while IFS= read -r mf; do
    [ "$file" = "$mf" ] && IS_MERGE=true && break
  done <<< "$MERGE_FILES"

  if [ "$IS_MERGE" = true ] && [ -f "$file" ]; then
    SKIPPED_MERGE=$((SKIPPED_MERGE + 1))
    continue
  fi

  # Check if this file is in the copyIfMissing list AND exists locally
  IS_COPY_IF_MISSING=false
  while IFS= read -r cim; do
    [ "$file" = "$cim" ] && IS_COPY_IF_MISSING=true && break
  done <<< "$COPY_IF_MISSING"

  if [ "$IS_COPY_IF_MISSING" = true ] && [ -f "$file" ]; then
    SKIPPED_COPY_IF_MISSING=$((SKIPPED_COPY_IF_MISSING + 1))
    continue
  fi

  # Create parent directory and copy
  mkdir -p "$(dirname "$file")"
  cp "$TMPDIR/$file" "$file"
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
done <<< "$FILES"

# ══════════════════════════════════════════════════════
# Symlinks
# ══════════════════════════════════════════════════════
echo "  Setting up symlinks..."
while IFS= read -r line; do
  [ -z "$line" ] && continue
  LINK_PATH="${line%%|*}"
  LINK_TARGET="${line##*|}"
  mkdir -p "$(dirname "$LINK_PATH")"
  # Remove existing (wrong symlink or real dir)
  [ -e "$LINK_PATH" ] || [ -L "$LINK_PATH" ] && rm -rf "$LINK_PATH"
  ln -sf "$LINK_TARGET" "$LINK_PATH"
done <<< "$SYMLINKS_JSON"

# ══════════════════════════════════════════════════════
# Write snapshot + version
# ══════════════════════════════════════════════════════
echo "$FILES" | sort > .vc-installed-files
echo "$VERSION" > .vc-version

cleanup

# ══════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════
# grep | wc -l: with `set -o pipefail`, a zero-match grep exits 1 and would
# abort the installer. Tolerate zero matches by appending `|| true` to the
# grep stage only — `wc -l` still returns 0 when no lines match.
AGENT_COUNT=$( (echo "$FILES" | grep -E '^\.(claude|codex)/agents/' || true) | wc -l | tr -d ' ')
SKILL_COUNT=$( (echo "$FILES" | grep -E '/SKILL\.md$'                || true) | wc -l | tr -d ' ')
HOOK_COUNT=$(  (echo "$FILES" | grep -E '/hooks/[^/]+\.cjs$'         || true) | wc -l | tr -d ' ')

echo ""
echo -e "  ${GREEN}Install complete.${NC} (v$VERSION)"
echo ""
echo -e "    ${CYAN}Agents${NC}:     $AGENT_COUNT (Claude Code + Codex)"
echo -e "    ${CYAN}Skills${NC}:     $SKILL_COUNT"
echo -e "    ${CYAN}Hooks${NC}:      $HOOK_COUNT"
echo -e "    ${CYAN}Files${NC}:      $INSTALLED_COUNT installed"
if [ "$SKIPPED_MERGE" -gt 0 ]; then
  echo -e "    ${CYAN}Merge${NC}:      $SKIPPED_MERGE preserved (user config)"
fi
if [ "$SKIPPED_COPY_IF_MISSING" -gt 0 ]; then
  echo -e "    ${CYAN}Existing${NC}:   $SKIPPED_COPY_IF_MISSING skipped (already present)"
fi

if [ "$HAS_EXISTING" = true ]; then
  echo ""
  echo -e "  ${YELLOW}Previous setup backed up to ${CYAN}$BACKUP_DIR/${NC}"
  echo -e "  ${YELLOW}Your process/ directory was preserved (plans, context, features).${NC}"
fi

echo ""
echo "  Next:"
echo "    1. Run: claude"
echo '    2. Say: "Run vc-setup"'
echo ""
echo "  vc-setup will auto-detect your project, scaffold the process/"
echo "  directory, deep-scan your codebase, and populate context with"
echo "  your real architecture, patterns, test commands, and conventions."
echo ""
