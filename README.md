# Claude Code Hooks Settings Checker

Free no-signup browser-only checker for Claude Code `settings.json` and hooks configuration shape.

Live app: https://claude-code-hooks-settings-checker.vercel.app/

## What It Checks

- JSON parse errors before a settings file is committed.
- Whether hook event arrays live under the `hooks` object.
- Common hook handler shape for `command`, `http`, `prompt`, `agent`, and `mcp_tool` entries.
- Matcher shape problems, including array matchers where a pipe-separated string is expected.
- Hook events that normally ignore matchers.
- Project/user/settings location hints for keys that belong in a different Claude Code configuration file.

The app does not upload pasted settings. All analysis runs in the browser.

## Sources

- Claude Code settings documentation: https://code.claude.com/docs/en/configuration
- Claude Code hooks reference: https://docs.anthropic.com/en/docs/claude-code/hooks
- Claude Code debug and settings notes: https://docs.anthropic.com/en/docs/claude-code/troubleshooting

## Development

```sh
npm run check
```

## License

MIT
