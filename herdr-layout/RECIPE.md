# automagik layout

The Herdr layout of the Automagik pack (`../herdr/`): the Automagik sidebar (`am-sidebar`) docked
on the left, with the panes the pack's mods open beside it. It names the pack's mods, so it is
useful once the pack is installed.

It lives in its own folder, outside `herdr/`, because herdr.dev's crawler skips a whole repository
when a herdr-mod entry folder holds `layouts/` (RFC 0011). The pack's release still ships it: the
tarball carries it as `layouts/automagik.json`, and `install.sh` puts it in
`~/.config/herdr-app/layouts/`.

## By hand

```bash
mkdir -p ~/.config/herdr-app/layouts
cp automagik.json ~/.config/herdr-app/layouts/
herdr-app do layout.switch '{"name":"automagik"}'
```

`preview.png` shows the sidebar this layout docks.
