# Getting Started: Install the Kit, Create Your First Skill, and Run It

This tutorial takes you from an empty project to a working custom skill. You will:

1. Install the kit into a project
2. Set it up with `vc-setup`
3. Create your own skill
4. Check it with the kit's validator
5. Run it in Claude Code

The examples use Claude Code. Codex works the same way unless a step says otherwise.

## Before you start

You need:

- **Node.js 22 or newer**, **git**, and **bash**. On Windows, open **Git Bash** from the Start menu and run every command in this tutorial there (or use WSL), not in PowerShell or `cmd.exe`. To paste into Git Bash, right-click and choose Paste, or press Shift+Insert.
- **Claude Code** (or Codex), installed and signed in.
- **A project to try it in.** Your own project works, but a small practice project is safer for a first run.

If you've never used git on this computer, tell it who you are first, using your own name and email:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Then make a practice project:

```bash
mkdir kit-demo
cd kit-demo
git init
npm init -y
git add -A
git commit -m "chore: initial commit"
```

The last command should print `1 file changed`. If it printed an error instead, the commit didn't happen, so fix that before you continue. Committing first means `git status` will show you exactly what the kit adds.

> [!WARNING]
> The kit runs multi-step agent workflows, and some of them use a lot of tokens. If you pay per use, try it on a small project first and keep an eye on your usage.

## Step 1: Install the kit

From inside your project folder, run:

```bash
curl -fsSL https://raw.githubusercontent.com/withkynam/vibecode-pro-max-kit/main/install.sh | bash
```

> [!TIP]
> Prefer to read a script before you run it? Download it, read it, then run it:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/withkynam/vibecode-pro-max-kit/main/install.sh -o /tmp/vc-install.sh
> bash /tmp/vc-install.sh
> ```

When it finishes, the end of the output looks like this (the numbers change between versions):

```text
  Install complete. (v3.2.5)

    Agents:     15 (Claude Code + Codex)
    Skills:     33
    Hooks:      10
    Files:      415 installed

  Next:
    1. Run: claude
    2. Say: "Run vc-setup"
```

Run `git status` to see what the kit added:

| Path | What it is |
| --- | --- |
| `.claude/` | Agents, skills, and hooks for Claude Code |
| `.codex/` | Matching agents for Codex |
| `.agents/skills` | A link to `.claude/skills`, so Codex finds the same skills |
| `CLAUDE.md`, `AGENTS.md` | Routing rules and the agent and skill registry |
| `process/` | Shared workflow docs (`vc-setup` adds more) |
| `.vc-version`, `.vc-installed-files` | Which kit version and files are installed, used by updates |

The installer also adds `.vibecode-backup*/` to your `.gitignore`. It never wipes your own files: existing config is backed up to `.vibecode-backup/`, and an existing `CLAUDE.md` is saved as `CLAUDE.md.pre-vibecode`.

## Step 2: Set up the kit with `vc-setup`

Start Claude Code in your project folder:

```bash
claude
```

Then type:

```text
Run vc-setup
```

In Codex, run `/vc-setup` instead.

`vc-setup` detects your stack, asks you about your project, and fills `process/context/` with real details about your code. When it wants to change files that already exist, it shows you the plan first, so read each summary before you approve it.

## Step 3: Create your first skill

A skill is a folder inside `.claude/skills/` that contains a `SKILL.md` file. The block at the top of the file (the frontmatter) tells Claude what the skill is called and when to use it. The rest of the file is the instructions Claude follows.

You'll make a small skill that writes a commit message for your staged changes. Create the folder:

```bash
mkdir -p .claude/skills/my-commit-message
```

Then create the skill file. This command writes the whole file at once, so paste it as one block:

```bash
cat > .claude/skills/my-commit-message/SKILL.md <<'EOF'
---
name: my-commit-message
description: "Write a conventional commit message for the currently staged changes. Use when the user asks for a commit message or says they are ready to commit."
metadata:
  author: your-name
  version: "1.0.0"
---

# Commit Message

1. Run `git diff --staged`. If nothing is staged, say so and stop.
2. Read the diff and work out the single main purpose of the change.
3. Write one commit message in conventional commit format:
   - First line: `type: short summary`, where type is one of feat, fix, docs, chore, refactor or test, and the summary is 50 characters or fewer.
   - Then a blank line and 1 to 3 short lines explaining why the change was made.
4. Show the message to the user. Do not run `git commit` yourself.
EOF
```

You can also create `.claude/skills/my-commit-message/SKILL.md` in your editor and paste in everything between the `cat` line and `EOF`.

Three rules keep a skill working:

- **Match the name to the folder.** Use lowercase letters, numbers, and hyphens, and make `name` the same as the folder name.
- **Don't start the name with `vc-`.** That prefix belongs to the kit, and `vc-update` may remove skills that use it. Use a prefix like `my-` or `team-`.
- **Say when to use it.** Claude decides when to use a skill from its `description`, so include a phrase like "Use when…" and keep it under about 220 characters.

Codex finds skills through `.agents/skills`, which normally links to `.claude/skills`, so the same skill works in both tools. On Windows it can be a copy instead, which Step 4 explains.

## Step 4: Check your skill

Run the kit's skill validator:

```bash
node .claude/skills/vc-audit-vc/scripts/validate-skills.mjs
```

You should see one more skill than the kit ships with, and no warnings or failures:

```json
{
  "checkedSkills": 34,
  "warnings": [],
  "failures": []
}
```

> [!NOTE]
> **On Windows**, `.agents/skills` can end up as a copy of `.claude/skills` instead of a link. The validator then reports two failures:
>
> ```text
> ".agents/skills does not resolve to .claude/skills",
> ".agents/skills/my-commit-message/SKILL.md missing"
> ```
>
> Claude Code isn't affected, because it reads `.claude/skills` directly. If you also use Codex, copy your new skill into `.agents/skills` so Codex can see it:
>
> ```bash
> cp -r .claude/skills/my-commit-message .agents/skills/
> ```
>
> That clears the second failure. The first one stays until `.agents/skills` is a real link.

If you see a warning, it names the file and the problem. Fix it and run the validator again.

> [!NOTE]
> The kit's own skill list (`discover-skills.mjs`) shows only the kit's `vc-` skills, so your skill won't appear there. That's expected: Claude Code finds skills by scanning the `.claude/skills/` folder.

## Step 5: Run your skill

Make a small change and stage it:

```bash
echo "# Kit Demo" > README.md
git add README.md
```

Start Claude Code with `claude` and ask:

```text
Write a commit message for my staged changes.
```

Claude reads your skill's description, sees that it matches, and follows your instructions. You'll see a line like `Skill(my-commit-message)` followed by `Successfully loaded skill`, which means Claude found your skill. Then you get something like this:

```text
docs: add README

Add a README so the project has a title and a place for setup notes.
```

Claude only shows you the message. If you like it, commit it yourself.

If Claude doesn't use your skill:

- Ask for it by name: `Use the my-commit-message skill.`
- Start a new Claude Code session, so it picks up the new skill.
- Run the validator from Step 4 again and fix any warnings.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `claude: command not found` | Install Claude Code, then open a new terminal. |
| The installer fails on Windows | Run it in Git Bash or WSL, not PowerShell or `cmd.exe`. |
| Your skill disappeared after `vc-update` | Its name probably starts with `vc-`. Rename the folder and the `name` with another prefix, like `my-`. |
| You ran the installer twice | That's safe. It detects the existing install and tells you to run `vc-update` instead. |

## Next steps

- Read [The RIPER-5 Lifecycle](../README.md#-the-riper-5-lifecycle) to see how the kit plans and builds features.
- Keep the kit up to date with `vc-update` (see [Kit Lifecycle](../README.md#-kit-lifecycle-install--setup--update--publish)).
- Turn tasks you repeat into skills: review checklists, release notes, test plans.
