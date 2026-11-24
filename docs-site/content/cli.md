---
title: Command line
section: Build and run
order: 1
description: The framesflow command: start, doctor, skill, mcp, call and tools.
---

`bin/framesflow.mjs` is the command line. It is registered under two names in `package.json` (`framesflow` and `framesflow-studio`), so after the package is published you can run it with `npx framesflow-studio <command>`. From a clone use `node bin/framesflow.mjs <command>` or the npm scripts.

| Command | What it does |
| --- | --- |
| `start [--port 4317]` | Builds the web app on first run, starts the helper, opens the studio in your browser. If one is already running it just opens it |
| `doctor` | Checks Node 20+, ffmpeg, ffprobe, yt-dlp, Whisper (optional), Edge or Chrome (for HTML animations) and the canvas module, and says how to fix gaps |
| `skill install` | Copies the skill to `~/.claude/skills/framesflow`. `--project` installs into `./.claude/skills`; `--dir <folder>` into `<folder>/framesflow` |
| `skill path` | Prints the folder the skill is in |
| `skill show [file]` | Prints `SKILL.md` or a reference such as `references/video-types.md` |
| `mcp` | Runs the stdio MCP server (the bridge for Claude Desktop, Cursor, opencode) |
| `call <tool> [json]` | Calls any tool against the running helper: `framesflow call get_project '{"clips":false}'` |
| `tools` | Lists every tool with a one-line description |
| `version`, `help` | |

The CLI is small on purpose: `start`, `doctor`, `mcp` and `call` delegate to the scripts in `scripts/` and `mcp/`, so behaviour is identical whether you use npm scripts or the command.

## Environment

The CLI and the helper read the variables in [Configuration](configuration.html). The most useful: `PORT`, `FRAMESFLOW_HOME`, `FFMPEG_PATH`, `YTDLP_PATH`, `FRAMESFLOW_NO_OPEN=1` (do not open a browser) and `FRAMESFLOW_URL` (where `call` and `mcp` should connect).

## Where data goes

Installed from npm, projects live in `~/Framesflow` (the package folder is read-only or temporary). In a clone they live in `workspace/`. See [The helper server](server.html).

## Windows

`Start-Framesflow.bat` starts the helper with a double-click.
