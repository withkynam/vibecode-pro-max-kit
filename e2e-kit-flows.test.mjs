#!/usr/bin/env node
/**
 * e2e-kit-flows.test.mjs
 * Four end-to-end trials for vibecode-pro-max-kit v3.0.0.
 * Uses Node built-in node:test — no external test dependencies.
 * ALL writes go to /tmp — never touches the target/source repo.
 *
 * Run: node e2e-kit-flows.test.mjs
 * Or:  node --test e2e-kit-flows.test.mjs
 *
 * VC_KIT_SOURCE must point to the local kit for all trials.
 * Default: KIT_PATH = the kit repo root (this file's directory)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const KIT_PATH = process.env.VC_KIT_SOURCE
  ?? path.dirname(new URL(import.meta.url).pathname);
const INSTALL_SH = path.join(KIT_PATH, 'install.sh');

/**
 * Create a fresh /tmp project directory, optionally seeded with fixtures.
 * CRITICAL: every project is git-initialized so discover-skills.mjs (git rev-parse) works.
 * Returns the project path. Caller is responsible for cleanup.
 *
 * @param {object} opts
 * @param {'empty'|'with-user-skill'|'v2x-snapshot'} opts.seed
 * @returns {string} projectPath
 */
function seedProject(opts) {
  const projectPath = fs.mkdtempSync('/tmp/vc-e2e-');

  // Every project needs git init — discover-skills.mjs runs git rev-parse
  execSync('git init -q', { cwd: projectPath });
  execSync('git commit --allow-empty -m "init" -q', {
    cwd: projectPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    },
  });

  if (opts.seed === 'with-user-skill') {
    // Seed: user has a non-vc custom skill that must survive install
    const userSkillDir = path.join(projectPath, '.claude/skills/my-custom-skill');
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSkillDir, 'SKILL.md'),
      '# my-custom-skill\nThis is user-owned. Must survive install.'
    );
    // Seed: user has a non-kit root file
    fs.writeFileSync(path.join(projectPath, 'MY_NOTES.txt'), 'user note file');
    // Seed: user has .claude/settings.json (merge-preserved)
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, '.claude/settings.json'),
      JSON.stringify(
        {
          userCustomSetting: true,
          permissions: { allow: ['Bash(**/my-scripts/**:*)'] },
        },
        null,
        2
      )
    );
  }

  if (opts.seed === 'v2x-snapshot') {
    // Seed: simulate v2.4.1 install state
    // Has deprecated vc-team skill (in legacyDeletions) present on disk
    const vcTeamDir = path.join(projectPath, '.claude/skills/vc-team');
    fs.mkdirSync(vcTeamDir, { recursive: true });
    fs.writeFileSync(path.join(vcTeamDir, 'SKILL.md'), '# vc-team (deprecated v2.x skill)');
    // Has a user skill that must survive
    const userSkillDir = path.join(projectPath, '.claude/skills/my-tool');
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), '# my-tool — user owned');
    // Write a prior .vc-installed-files snapshot (v2.x state)
    // Lists vc-team/SKILL.md as kit-installed (it was, in v2.x)
    const v2Snapshot = [
      '.claude/skills/vc-team/SKILL.md',
      'CLAUDE.md',
      'AGENTS.md',
    ].join('\n');
    fs.writeFileSync(path.join(projectPath, '.vc-installed-files'), v2Snapshot);
    fs.writeFileSync(path.join(projectPath, '.vc-version'), '2.4.1');
  }

  return projectPath;
}

// ──────────────────────────────────────────────────────────────
// Trial A: New install on empty project
// ──────────────────────────────────────────────────────────────
test('Trial A: new install on empty project', async () => {
  const projectPath = seedProject({ seed: 'empty' });
  try {
    execSync(`bash ${INSTALL_SH}`, {
      cwd: projectPath,
      env: { ...process.env, VC_KIT_SOURCE: KIT_PATH },
      stdio: 'pipe',
    });

    // AC-3: VC_KIT_SOURCE honored — installed version matches kit manifest version
    const kitVersion = JSON.parse(
      fs.readFileSync(path.join(KIT_PATH, 'vc-manifest.json'), 'utf8')
    ).version;
    const installedVersion = fs.readFileSync(
      path.join(projectPath, '.vc-version'),
      'utf8'
    ).trim();
    assert.equal(installedVersion, kitVersion, 'AC-3: installed version matches kit version');

    // AC-2: no rm -rf wipe — .vc-installed-files written
    assert.ok(
      fs.existsSync(path.join(projectPath, '.vc-installed-files')),
      'AC-2: .vc-installed-files written'
    );

    // AC-2 (code audit): install.sh does not contain the wipe line
    const installShContent = fs.readFileSync(INSTALL_SH, 'utf8');
    assert.ok(
      !installShContent.includes('rm -rf .claude .codex .agents'),
      'AC-2: install.sh does not contain rm -rf .claude .codex .agents wipe'
    );

    // vc-* skills directory present
    assert.ok(
      fs.existsSync(path.join(projectPath, '.claude/skills')),
      'kit skills directory present'
    );

    // .agents/skills symlink or directory present
    assert.ok(
      fs.existsSync(path.join(projectPath, '.agents/skills')),
      '.agents/skills exists'
    );

    // Installed hook launcher forwards arguments and stdin to Node.
    const hookOutput = execFileSync('sh', [
      '.codex/hooks/run-node.sh',
      '-e',
      "process.stdout.write(process.argv[1] + require('node:fs').readFileSync(0, 'utf8'))",
      'hook argument with spaces: ',
    ], { cwd: projectPath, input: 'hook input', encoding: 'utf8' });
    assert.equal(hookOutput, 'hook argument with spaces: hook input');

    // discover-skills exits 0 (tests git rev-parse + skill discovery)
    execSync(
      `node ${path.join(KIT_PATH, '.claude/skills/vc-context-discovery/scripts/discover-skills.mjs')}`,
      { cwd: projectPath, stdio: 'pipe' }
    );
    // No assertion needed — execSync throws on non-zero exit
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────
// Trial B: Coexistence — user-owned skills survive install
// ──────────────────────────────────────────────────────────────
test('Trial B: coexistence — user skills survive install', async () => {
  const projectPath = seedProject({ seed: 'with-user-skill' });

  // Capture user skill content before install
  const userSkillPath = path.join(
    projectPath,
    '.claude/skills/my-custom-skill/SKILL.md'
  );
  const userSkillBefore = fs.readFileSync(userSkillPath);

  // Capture user settings.json before install
  const settingsPath = path.join(projectPath, '.claude/settings.json');
  const settingsBefore = fs.readFileSync(settingsPath);

  try {
    execSync(`bash ${INSTALL_SH}`, {
      cwd: projectPath,
      env: { ...process.env, VC_KIT_SOURCE: KIT_PATH },
      stdio: 'pipe',
    });

    // AC-1: user's custom skill is byte-identical after install
    const userSkillAfter = fs.readFileSync(userSkillPath);
    assert.equal(
      Buffer.compare(userSkillBefore, userSkillAfter),
      0,
      'AC-1: user custom skill byte-identical after install'
    );

    // AC-1: user's non-kit root file untouched
    assert.ok(
      fs.existsSync(path.join(projectPath, 'MY_NOTES.txt')),
      'AC-1: user MY_NOTES.txt untouched'
    );

    // AC-1: settings.json preserved (merge semantics — user version kept)
    const settingsAfter = fs.readFileSync(settingsPath);
    assert.equal(
      Buffer.compare(settingsBefore, settingsAfter),
      0,
      'AC-1: .claude/settings.json merge preserved (user version kept)'
    );

    // AC-17: backup present (HAS_EXISTING=true because we seeded .claude/)
    assert.ok(
      fs.existsSync(path.join(projectPath, '.vibecode-backup')),
      'AC-17: .vibecode-backup directory present'
    );

    // AC-2: kit vc-* skills installed alongside user skill
    const skillDirs = fs.readdirSync(path.join(projectPath, '.claude/skills'));
    const hasVcSkills = skillDirs.some((d) => d.startsWith('vc-'));
    assert.ok(hasVcSkills, 'AC-2: vc-* skills installed');
    assert.ok(
      skillDirs.includes('my-custom-skill'),
      'AC-1: my-custom-skill still present'
    );
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────
// Trial C: v2.x → v3 migration via install
// ──────────────────────────────────────────────────────────────
test('Trial C: v2.x to v3 migration via install', async () => {
  const projectPath = seedProject({ seed: 'v2x-snapshot' });

  // Capture user tool before install
  const userToolPath = path.join(
    projectPath,
    '.claude/skills/my-tool/SKILL.md'
  );
  const userToolBefore = fs.readFileSync(userToolPath);

  try {
    execSync(`bash ${INSTALL_SH}`, {
      cwd: projectPath,
      env: { ...process.env, VC_KIT_SOURCE: KIT_PATH },
      stdio: 'pipe',
    });

    // AC-7: deprecated vc-team removed (legacyDeletion — full dir)
    assert.ok(
      !fs.existsSync(path.join(projectPath, '.claude/skills/vc-team')),
      'AC-7: .claude/skills/vc-team removed (legacyDeletion)'
    );

    // AC-7: .vc-version updated to current kit version
    const kitVersion = JSON.parse(
      fs.readFileSync(path.join(KIT_PATH, 'vc-manifest.json'), 'utf8')
    ).version;
    const installedVersion = fs.readFileSync(
      path.join(projectPath, '.vc-version'),
      'utf8'
    ).trim();
    assert.equal(installedVersion, kitVersion, 'AC-7: .vc-version updated to v3.0.0');

    // AC-7 / AC-1: user-owned my-tool untouched
    const userToolAfter = fs.readFileSync(userToolPath);
    assert.equal(
      Buffer.compare(userToolBefore, userToolAfter),
      0,
      'AC-7: user tool byte-identical after migration install'
    );

    // AC-5: legacyDeletions audit — every path must start with a kit-owned prefix
    const manifest = JSON.parse(
      fs.readFileSync(path.join(KIT_PATH, 'vc-manifest.json'), 'utf8')
    );
    const legacyDeletions = manifest.legacyDeletions || [];
    for (const p of legacyDeletions) {
      const isKitOwned =
        p.startsWith('.claude/skills/vc-') ||
        p.startsWith('.claude/agents/vc-') ||
        p.startsWith('process/development-protocols/');
      assert.ok(
        isKitOwned,
        `AC-5: legacyDeletion '${p}' must start with .claude/skills/vc-, .claude/agents/vc-, or process/development-protocols/`
      );
    }
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────
// Trial D: Publish dry-run — no git push occurs without explicit approval
// ──────────────────────────────────────────────────────────────
test('Trial D: publish dry-run — no git push occurs without explicit approval', async () => {
  // This trial is a proxy for "agent paused at push gate."
  // We cannot automate the full vc-publish prose flow (it requires Claude Code).
  // The proxy: assert SKILL.md contains the required gate language, then run
  // compute-sync-plan.mjs in publish direction and assert git state unchanged.

  const publishSkillPath = path.join(
    KIT_PATH,
    '.claude/skills/vc-publish/SKILL.md'
  );
  const skillContent = fs.readFileSync(publishSkillPath, 'utf8');

  // AC-14: SKILL.md has explicit separate push gate (Step 9b)
  assert.ok(
    skillContent.includes('Explicit Push Approval') ||
      (skillContent.includes('explicit') &&
        skillContent.includes('push') &&
        skillContent.includes('Step 9')),
    'AC-14: vc-publish SKILL.md contains explicit push gate step'
  );

  // AC-14: NEVER auto-push rule present in SKILL.md Rules section
  assert.ok(
    skillContent.includes('NEVER auto-push') ||
      skillContent.includes('never auto-push'),
    'AC-14: vc-publish SKILL.md Rules section has NEVER auto-push rule'
  );

  // AC-15: leak detection step precedes commit/push step in the flow
  const leakPos = skillContent.indexOf('Leak Detection');
  const commitPos = skillContent.indexOf('Commit and Tag');
  assert.ok(leakPos !== -1, 'AC-15: Leak Detection step present in vc-publish SKILL.md');
  assert.ok(
    commitPos !== -1,
    'AC-15: Commit and Tag step present in vc-publish SKILL.md'
  );
  assert.ok(
    leakPos < commitPos,
    'AC-15: Leak Detection appears before Commit and Tag in the flow'
  );

  // Proxy: run compute-sync-plan.mjs in publish direction and assert git state unchanged
  const tmpKitClone = fs.mkdtempSync('/tmp/vc-e2e-publish-');
  try {
    // Clone the local kit to a tmpdir (simulates kitRepoPath in vc-publish)
    execSync(`git clone --local --quiet "${KIT_PATH}" "${tmpKitClone}"`, {
      stdio: 'pipe',
    });

    // Capture git log before
    const logBefore = execSync('git log --oneline', {
      cwd: tmpKitClone,
      encoding: 'utf8',
    });
    const tagsBefore = execSync('git tag -l', {
      cwd: tmpKitClone,
      encoding: 'utf8',
    });

    // Run compute-sync-plan.mjs (publish direction: project=tmpKitClone, kit=KIT_PATH)
    // Pure computation — no git ops
    execSync(
      `node "${path.join(KIT_PATH, 'compute-sync-plan.mjs')}" --root "${tmpKitClone}" --kit-root "${KIT_PATH}" --json`,
      { stdio: 'pipe' }
    );

    // Capture git log after
    const logAfter = execSync('git log --oneline', {
      cwd: tmpKitClone,
      encoding: 'utf8',
    });
    const tagsAfter = execSync('git tag -l', {
      cwd: tmpKitClone,
      encoding: 'utf8',
    });

    // AC-14: no commit or tag happened during computation
    assert.equal(
      logBefore,
      logAfter,
      'AC-14: git log unchanged after compute-sync-plan.mjs run'
    );
    assert.equal(
      tagsBefore,
      tagsAfter,
      'AC-14: git tags unchanged after compute-sync-plan.mjs run'
    );
  } finally {
    fs.rmSync(tmpKitClone, { recursive: true, force: true });
  }
});
