# Windows commands

Use these forms from the repository root. Quote paths that contain spaces.
If RTK is unavailable, run the command without its prefix.

```powershell
rtk proxy rg --files docs -g '*.md'
rtk proxy rg -n -F 'recordProgress' src tests -g '*.js'
rtk read 'docs/AGENT_GUIDE.md'
rtk proxy powershell -NoProfile -Command "Get-Content -LiteralPath 'docs/AGENT_GUIDE.md' -TotalCount 12"
rtk proxy node src/cli.js state active
```

Find a path before reading it. Give `rg` file patterns through `-g`; do not
pass a wildcard as a literal path. Run PowerShell cmdlets through PowerShell
when using `rtk proxy`. Use `-F` for a literal search term.

For a dynamic Node.js import, convert a Windows path to a file URL:

```javascript
import { pathToFileURL } from "node:url";
const module = await import(pathToFileURL(absolutePath).href);
```
