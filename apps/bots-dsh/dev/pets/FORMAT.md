# Automagik adoption contract

Canonical new export: a folder containing `pet.json` and `spritesheet.webp`, spriteVersionNumber 2. Preserve v1 import compatibility where supported. WebP/PNG atlas alpha must be real; deliver WebP for the package.

- Cell: 192×208 pixels; 8 columns.
- v1: 1536×1872, 9 rows, 57 populated cells.
- v2: 1536×2288, 11 rows, 73 populated cells.
- Unused cells remain fully transparent. Maximum20MiB for the hosted Work Pets preflight.

| Row | Animation | Frames |
|---|---|---|
|0|idle|6|
|1|running-right|8|
|2|running-left|8|
|3|waving|4|
|4|jumping|5|
|5|failed|8|
|6|waiting|6|
|7|running / active work|6|
|8|review|6|
|9|look000 through157.5|8|
|10|look180 through337.5|8|

Look angles advance clockwise from UP,22.5degrees per frame. Neutral comes from idle, not look000. Sleep is an Automagik sidecar asset, not a twelfth standard row. Do not put custom poses in unused standard cells.

Use the shipped example manifest for the locally verified Codex fields: id, displayName, description, spriteVersionNumber and spritesheetPath. Additional name/kind fields in our example are compatibility metadata, not evidence that all consumers require them. ChatGPT Work stores stable identity/metadata through its API rather than importing this folder directly.

## DSH presentation mapping

Verified source snapshot: `examples/genie-v5/qa/dsh-commit.txt`, repository automagik-dev/automagik, apps/bots-dsh. Original adapter and mark source are included in that QA directory.

- idle → idle
- thinking, working, sending, orbit → running
- searching → review
- waiting → idle (quiet wait)
- alert → waiting (person required)
- done → jumping once
- poked → waving once
- failed → failed (caller extension)
- sleeping → separate sleep loop (explicit app state)

These are presentation inputs, not universal raw DSH event names. Completion is triggered by actual outcomes. Preserve text/status accessibility and reduced motion. Existing image-only Bot avatars use the256px static WebP until the player is integrated.

## Acceptance

Generate coherent state strips from the same approved canonical art. Extract whole poses rather than assuming equal source cuts. Register scale and anchors, preserve intentional jump lift, despill once per final candidate, validate final encoded bytes, inspect direction meaning and preview at actual avatar size. Keep QA warnings visible. Source art, package dimensions and successful upload are distinct from in-app acceptance.
