# Council: DSH 0.2.2 upgrade plan (2026-11-06)

Provenance: the synthesis of the council run for the DSH 0.2.2 upgrade wish (tracker #516, Lane D).
Its source is the session's `scratchpad/council-dsh022-synthesis.md`, copied here verbatim, with
the brief the lenses ran on (`council-brief.md`). Both files live outside this repository, in the
working session's scratchpad, and cannot be resolved from it. Lines marked ERRATA or "added in
review" are the editor's and not part of the copy. Five lenses (architecture, delivery,
product, security, dissent) ran on one model family through one runtime: role-separated, not
independent.

Line citations to `docs/rfcs/0003-model-routes-and-acp.md` in the copy are as of the council's
base (`6e2dd5af`); on this head that section, "Claude Code keeps the person's own settings", is
86-93.

Lenses: architecture, delivery, product, security, dissent. All five answered. All ran on one model family through one runtime: role-separated, not independent. The saved council workflow was switched off in this session, so the lenses were dispatched by hand with the identical brief (council-brief.md).

Verdicts: architecture support-with-conditions; delivery support-with-conditions; product support-with-conditions; security support-with-conditions; dissent oppose (the plan as one bundled decision).

## Synthesizer's reading
The owner asked for three different things under one name: a version move (forced by DSH, mechanical but release-wide), a cleanup (partly real, partly conceptual overlap), and a new product capability (ACP agents with DSH's tools and live switching) that reverses a recorded owner decision. The first is ready to plan; the third is not ready to build.

## Decision: proceed-with-conditions (split into three decisions)

Consensus (5/5): split the plan; version move first, deletions second, ACP parity last behind an RFC 0003 amendment. Counted findings:
- fallback.js:65 (and unfold-session index.js:298) rewrite the model in agent/request, which 0.2.2 breaks: 5/5.
  ERRATA (added in review, checked on this head): the second citation is wrong. `agent/request` in
  `apps/unfold-session-dsh/index.js:298-300` only counts the event and calls `next()`; the rewrite
  is `{ ...rest, provider: entry.route.provider, model: entry.route.model }` in
  `apps/bots-dsh/src/host/fallback.js:65-74`. The finding stands; the file it named does not.
- locale-pt-br-dsh is only partly covered by DSH's built-in Portuguese (it carries the Bot team's 1287 omni-ui keys; DSH registers "pt", ours "pt-BR"): 5/5. Shrink, do not delete.
- No DSH package serves DSH's tools as an MCP server; acp.js:64 passes mcpServers: []; RFC 0003 delivery 4 (bridge) unbuilt: 5/5.
- Step 3 as worded conflicts with RFC 0003:84-89 (Claude Code keeps its own tools, settings, hooks): 5/5. [added in review: as of the council's base, `6e2dd5af`; 86-93 on this head.]
- rc.1 is two days old, still depends on the "absorbed" worktree package: 4/5.
- Node 24.9 floor: CI pins 22 in ~10 jobs; desktop is fine (Electron 44.5.0 ships Node 24.21.0, delivery lens): 4/5.
- subagent_oar and Change requests/worktrees overlap only in concept, not deletion candidates: 3/5.

New single-lens findings:
- Delivery: every plugin declares engines.dsh ">=0.2.1-rc.5 <0.2.2-0"; runtime, both harness pins, engines ranges and patches must move in one release. Rollback is one-way (0.2.2 rewrites config/storage; older may not read it). Plugin indexes in 0.2.2 drop tag-pinned versions, which could cut off our market. No uninstall path exists in lane.js/main.js. teammate-models.patch must be confirmed upstream or rebased.
- Architecture: "creator mode" = DSH's cordis agent preset (presets standard, ptc, minimal, cordis; dsh-web-app README:91,123); btw.js:74-78 registers a projection synchronously.
  [added in review: the line above restores the copy's own refs; they resolve against the upstream
  npm package's README at 0.2.1-rc.3, which lists standard/ptc/minimal/cordis at :123 and creator
  at :91. That file is outside this repository, so no commit or lines here.]
- Security: an "always allow" or hook rule in Claude Code would let mcp__dsh__* tools run with no DSH dialog; Full access on an ACP route would open two unprompted tool sets; web_fetch is on by default and 0.2.2 lets it reach private addresses (bots read external channels: prompt-injection path to localhost services); live switching moves history (with secrets) across providers.

Dissent (dissent lens, verbatim): "oppose (the plan as one bundled decision. The upgrade itself is fine; the bundling and step 3 are the problem.)" ... "Step 3 conflicts with a recorded owner decision. RFC 0003:84-89 says 'Claude Code keeps the person's own settings... CLAUDE.md, MCP servers and hooks keep working.' A 'same tool set as vanilla DSH' agent means either two overlapping tool sets (agent Bash/Edit next to DSH bash/fs) or overriding the person's setup. This cannot be done without reopening the RFC." ... "The 'no overlaps' rule could turn against acp-dsh itself. 0.2.2 ships the experimental subagent_oar." [added in review: the dissent's RFC 0003:84-89 above is as of the council's base, `6e2dd5af`; that section is 86-93 on this head.]

Conflict resolution: no lens disagreed on order or substance; the dissent opposes the bundling, which every other lens also conditions away by splitting. The dissent's point that "no overlaps" could apply to acp-dsh itself stands unresolved: subagent_oar's location and permission flags were not found by any lens.

## Conditions
Step 0 (read-only, before code): Omni harness can move in the same series; 0.2.2 index generation still lists tag-pinned releases; teammate-models upstream or rebase; pt dictionaries diffed per namespace against ours; whether a 0.2.2-migrated home loads on 0.2.1-rc.5; rc.1 vs final decided.
Step 1 (one atomic PR): Node 24.9 in CI and engines; runtime + both harness + Omni pins + engines ranges + patches together; fallback.js and unfold-session to agent.model (test: a failed turn still moves to the configured backup); async projections (btw.js, unfold); ~43 config reads checked against Cordis 4.1; web_fetch private-address policy set explicitly for bot/channel profiles; read-before-write and apply_patch set deliberately; worktree package dropped only when final drops it. Evidence: full gate once + CI, boot-check on fresh and on an upgraded 0.2.1 home with a backup, Reviewer + Tester + Fixer on one head.
Step 2 (one PR per removal): locale-pt-br-dsh shrinks to non-DSH strings (or omni-ui moves into bots-dsh with the id kept as a shim); one Portuguese entry in the picker; saved pt-BR choice migrated; uninstall/tombstone path first; plugin ids stay reserved.
Step 3 (one PR each, optional): Session snapshot/subscribe for Pocket (RFC 0015) and Unfold; scheduled tasks.
Step 4 (ACP parity): RFC 0003 amendment with owner decisions (replace vs beside vs preset-scoped DSH tools; which approval path wins; history on a switch, each way, with redaction); spike proving claude-agent-acp and codex-acp honour per-session mcpServers and list_changed; stdio/per-session-token bridge built from the active preset (standard/cordis), level-filtered, DSH approval always on the DSH side; live switching last, behind a flag.

## Evidence gaps
subagent_oar location and flags; pt = Brazilian or European; adapters' mcpServers support; 0.2.2 final date and diff; Omni harness readiness; rollback compatibility of a migrated home.

## Next action
Step 0 as one read-only DSH-squad task, scratch folders only, reporting each gap with file:line.
