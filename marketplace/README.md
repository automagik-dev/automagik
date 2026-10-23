# Automagik market index

`automagik.json` is this repository's [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin market index (format 1): the Bot team and the welcome, each a git source pinned to a release commit with the plugin's folder. Each release lists itself here (`release.yml` runs `bun scripts/marketplace.ts pin v<version>`), and `bun scripts/marketplace.ts check` proves every entry: DSH's own parser, and each commit holds the package and version it lists.

Most people add the Automagik market, which lists these plugins with every other Automagik product's, at each release ([automagik-dev/dsh-marketplace](https://github.com/automagik-dev/dsh-marketplace)):

```
https://raw.githubusercontent.com/automagik-dev/dsh-marketplace/main/index.json
```

## Add it to your DSH

The market ships with DSH as an optional bundle. Turn it on, then add the index:

1. Settings → Plugins → enable **Plugin market** (`@deepseek-ai/dsh-experimental-plugin-market-bundle`).
2. Market → Indexes → add the URL above. Or put it straight into your profile's `cordis.patch.yml`:

   ```yaml
   - id: plugin-market
     config:
       indexes:
         - https://raw.githubusercontent.com/automagik-dev/dsh-marketplace/main/index.json
   ```

DSH asks before it installs anything, and installs exactly the version listed. Every Omni also serves a market for its own release (`https://<your-omni>/api/market/index.json`) with the release of these plugins it was tested with.
