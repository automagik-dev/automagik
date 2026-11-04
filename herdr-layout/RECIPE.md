# automagik layout

The Herdr layout of the Automagik pack: the Automagik sidebar (`am-sidebar`) docked on the left,
with the panes the pack's mods open beside it. Its blocks are the pack's mods, so add the pack
first, or the layout opens with empty blocks.

## Add it

1. Add the Automagik Herdr mod entry first:
   https://github.com/automagik-dev/automagik/tree/dev/herdr
   On a Mac with Node 22.7 or later, its install line
   ([herdr/README.md](https://github.com/automagik-dev/automagik/blob/dev/herdr/README.md#install)) is:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/automagik-dev/automagik/main/herdr/install.sh | bash
   ```

   That puts every mod this layout names in `~/.config/herdr-app/mods/`, and also puts this layout
   in `~/.config/herdr-app/layouts/automagik.json`.
2. If `~/.config/herdr-app/layouts/automagik.json` is still missing, copy this folder's
   `layouts/automagik.json` there.
3. Switch Herdr to it: `herdr-app do layout.switch '{"name":"automagik"}'`.
4. Check: `herdr-app status` names the layout `automagik`, and the Automagik sidebar shows on the
   left with no empty blocks. An empty block means step 1 was skipped or failed; do it, then
   switch again.

## Why its own folder

herdr.dev's crawler skips a whole repository when a herdr-mod entry folder holds `layouts/`
(RFC 0011), so the layout is not in `herdr/`. herdr.dev lists a layout only from its entry's
`layouts/<name>.json`, so the file is `layouts/automagik.json` here. The pack's release still
ships it: the tarball carries it as `layouts/automagik.json`, and `install.sh` puts it in
`~/.config/herdr-app/layouts/`.

## By hand

After step 1:

```bash
mkdir -p ~/.config/herdr-app/layouts
cp layouts/automagik.json ~/.config/herdr-app/layouts/
herdr-app do layout.switch '{"name":"automagik"}'
```

`preview.png` shows the sidebar this layout docks.
