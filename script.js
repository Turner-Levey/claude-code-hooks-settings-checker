const settingsInput = document.querySelector("#settings-input");
const fileKind = document.querySelector("#file-kind");
const analyzeButton = document.querySelector("#analyze");
const sampleButton = document.querySelector("#load-sample");
const clearButton = document.querySelector("#clear-all");
const copyButton = document.querySelector("#copy-report");
const scoreValue = document.querySelector("#score-value");
const scoreCaption = document.querySelector("#score-caption");
const issueCount = document.querySelector("#issue-count");
const issuesEl = document.querySelector("#issues");
const reportOutput = document.querySelector("#report-output");
const eventCount = document.querySelector("#event-count");
const groupCount = document.querySelector("#group-count");
const handlerCount = document.querySelector("#handler-count");
const matcherCount = document.querySelector("#matcher-count");

const sampleSettings = `{
  "permissions": {
    "allow": ["Bash(npm test)", "Read(src/**)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ["write", "edit"],
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/check-edits.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command"
          }
        ]
      }
    ],
    "ConfigChange": {
      "hooks": [
        {
          "type": "http",
          "url": "https://hooks.example.com/config"
        }
      ]
    }
  },
  "autoConnectIde": true
}`;

const knownEvents = new Set([
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreCompact",
  "PostToolBatch",
  "PermissionRequest",
  "ConfigChange",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "WorktreeCreate",
  "WorktreeRemove",
  "CwdChanged",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd"
]);

const eventsWithoutMatchers = new Set([
  "SessionStart",
  "Notification",
  "Stop",
  "SubagentStop",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreCompact",
  "PermissionRequest",
  "ConfigChange",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "WorktreeCreate",
  "WorktreeRemove",
  "CwdChanged",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd"
]);

const commonToolNames = ["Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "TodoWrite"];
const handlerTypes = new Set(["command", "http", "prompt", "agent", "mcp_tool"]);
const globalOnlyKeys = new Set(["autoConnectIde", "autoInstallIdeExtension", "externalEditorContext"]);

function finding(severity, title, detail, path) {
  return { severity, title, detail, path };
}

function parseJsonWithLine(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    const message = error.message || "Invalid JSON";
    const positionMatch = message.match(/position\s+(\d+)/i);
    if (!positionMatch) return { value: null, error: message };
    const position = Number(positionMatch[1]);
    const prefix = text.slice(0, position);
    const line = prefix.split(/\r?\n/).length;
    const column = prefix.split(/\r?\n/).pop().length + 1;
    return { value: null, error: `${message} at line ${line}, column ${column}` };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function eventPath(eventName, index) {
  return `hooks.${eventName}[${index}]`;
}

function checkHandler(handler, path, findings) {
  if (!handler || typeof handler !== "object" || Array.isArray(handler)) {
    findings.push(finding("high", "Hook handler is not an object", "Each item inside a group hooks array should be a handler object.", path));
    return;
  }

  if (typeof handler.type !== "string") {
    findings.push(finding("high", "Hook handler is missing type", "Add a handler type such as command, http, prompt, agent, or mcp_tool.", path));
    return;
  }

  if (!handlerTypes.has(handler.type)) {
    findings.push(finding("medium", "Unknown hook handler type", `Found type \"${handler.type}\". Check the current hooks reference before relying on it.`, path));
    return;
  }

  if (handler.type === "command" && typeof handler.command !== "string") {
    findings.push(finding("high", "Command handler is missing command", "A command hook handler needs a command string.", path));
  }

  if (handler.type === "http" && typeof handler.url !== "string") {
    findings.push(finding("high", "HTTP handler is missing url", "An HTTP hook handler needs a url string.", path));
  }

  if (handler.type === "prompt" && typeof handler.prompt !== "string") {
    findings.push(finding("medium", "Prompt handler is missing prompt", "A prompt hook handler normally needs prompt text.", path));
  }

  if (handler.type === "agent" && typeof handler.agent !== "string" && typeof handler.name !== "string") {
    findings.push(finding("medium", "Agent handler is missing agent/name", "An agent hook handler should name the agent it calls.", path));
  }

  if (handler.type === "mcp_tool" && typeof handler.tool !== "string" && typeof handler.name !== "string") {
    findings.push(finding("medium", "MCP tool handler is missing tool/name", "An MCP tool hook handler should name the target tool.", path));
  }
}

function checkMatcher(matcher, eventName, path, findings) {
  if (matcher === undefined) return 0;

  if (eventsWithoutMatchers.has(eventName)) {
    findings.push(finding("low", "Matcher on event that does not use matchers", `${eventName} hooks normally run without tool matchers.`, path));
  }

  if (Array.isArray(matcher)) {
    findings.push(finding("high", "Matcher is an array", "Use a string matcher. Combine alternatives with a pipe character, for example Write|Edit.", path));
    return matcher.length;
  }

  if (typeof matcher !== "string") {
    findings.push(finding("medium", "Matcher is not a string", "Matcher values should be strings when present.", path));
    return 1;
  }

  const lowerCommon = commonToolNames.filter((tool) => matcher.includes(tool.toLowerCase()));
  const exactCommon = commonToolNames.filter((tool) => matcher.includes(tool));
  if (lowerCommon.length && !exactCommon.length) {
    findings.push(finding("medium", "Matcher may be case-sensitive", `Found lowercase common tool names: ${lowerCommon.join(", ")}.`, path));
  }

  return matcher.trim() ? 1 : 0;
}

function analyzeSettings() {
  const text = settingsInput.value.trim();
  const sourceKind = fileKind.value;
  const findings = [];
  let events = 0;
  let groups = 0;
  let handlers = 0;
  let matchers = 0;

  if (!text) {
    render({
      findings: [finding("low", "Paste a Claude Code JSON file", "Use the textarea to check settings.json or plugin hooks JSON.", "input")],
      events,
      groups,
      handlers,
      matchers,
      score: null
    });
    return;
  }

  const parsed = parseJsonWithLine(text);
  if (parsed.error) {
    render({
      findings: [finding("high", "JSON parse failed", parsed.error, "input")],
      events,
      groups,
      handlers,
      matchers,
      score: 0
    });
    return;
  }

  const root = parsed.value;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    findings.push(finding("high", "Top-level JSON is not an object", "Claude Code settings and hooks files should be JSON objects.", "$"));
  }

  if (sourceKind === "standalone-hooks") {
    findings.push(finding("high", "Standalone hooks.json is ambiguous", "Claude Code settings usually keep hooks under settings.json. Plugin hook files live at hooks/hooks.json.", "file"));
  }

  if (sourceKind === "plugin-hooks" && root.hooks && Object.keys(root).length === 1) {
    findings.push(finding("low", "Plugin hooks file may not need a wrapper", "If this is hooks/hooks.json for a plugin, confirm whether the file expects hook events directly or inside hooks for the current plugin format.", "file"));
  }

  const rootHookEvents = Object.keys(root || {}).filter((key) => knownEvents.has(key));
  if (rootHookEvents.length) {
    findings.push(finding("high", "Hook events found at top level", `Move ${rootHookEvents.join(", ")} under the hooks object for settings.json files.`, "$"));
  }

  for (const key of Object.keys(root || {})) {
    if (globalOnlyKeys.has(key) && sourceKind !== "user") {
      findings.push(finding("medium", "Global-only setting in project file", `${key} is documented as a global user setting, not a repo project setting.`, key));
    }
  }

  const hooks = root && root.hooks;
  if (!hooks) {
    findings.push(finding("medium", "No hooks object found", "This JSON may still be a valid settings file, but there are no hook definitions to inspect.", "hooks"));
  } else if (typeof hooks !== "object" || Array.isArray(hooks)) {
    findings.push(finding("high", "hooks is not an object", "The hooks key should contain event names mapped to hook groups.", "hooks"));
  } else {
    const eventNames = Object.keys(hooks);
    events = eventNames.length;
    for (const eventName of eventNames) {
      if (!knownEvents.has(eventName)) {
        findings.push(finding("medium", "Unknown hook event", `${eventName} is not in this checker's known Claude Code hook event list. Verify it against the current docs.`, `hooks.${eventName}`));
      }

      if (!Array.isArray(hooks[eventName])) {
        findings.push(finding("high", "Hook event value is not an array", `${eventName} should map to an array of hook groups.`, `hooks.${eventName}`));
        continue;
      }

      groups += hooks[eventName].length;
      hooks[eventName].forEach((group, groupIndex) => {
        const basePath = eventPath(eventName, groupIndex);
        if (!group || typeof group !== "object" || Array.isArray(group)) {
          findings.push(finding("high", "Hook group is not an object", "Each event array item should be an object with a hooks array.", basePath));
          return;
        }

        matchers += checkMatcher(group.matcher, eventName, `${basePath}.matcher`, findings);

        if (!Array.isArray(group.hooks)) {
          findings.push(finding("high", "Hook group is missing hooks array", "Each hook group should contain a hooks array of handler objects.", `${basePath}.hooks`));
          return;
        }

        handlers += group.hooks.length;
        group.hooks.forEach((handler, handlerIndex) => {
          checkHandler(handler, `${basePath}.hooks[${handlerIndex}]`, findings);
        });
      });
    }
  }

  if (!findings.some((item) => item.severity === "high" || item.severity === "medium")) {
    findings.push(finding("low", "No obvious shape issues found", "The pasted JSON parsed and the hook groups matched this checker's current shape rules.", "$"));
  }

  const high = findings.filter((item) => item.severity === "high").length;
  const medium = findings.filter((item) => item.severity === "medium").length;
  const score = Math.max(0, 100 - high * 28 - medium * 12);
  render({ findings, events, groups, handlers, matchers, score });
}

function render({ findings, events, groups, handlers, matchers, score }) {
  scoreValue.textContent = score === null ? "--" : `${score}`;
  scoreCaption.textContent = score === null ? "Waiting for settings" : score >= 85 ? "Looks clean" : score >= 60 ? "Review findings" : "Fix shape issues";
  issueCount.textContent = `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;
  eventCount.textContent = events;
  groupCount.textContent = groups;
  handlerCount.textContent = handlers;
  matcherCount.textContent = matchers;

  issuesEl.innerHTML = "";
  findings.forEach((item) => {
    const article = document.createElement("article");
    article.className = `issue ${item.severity}`;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const detail = document.createElement("p");
    detail.textContent = `${item.path}: ${item.detail}`;
    article.append(title, detail);
    issuesEl.append(article);
  });

  reportOutput.textContent = buildReport(findings, events, groups, handlers, matchers, score);
}

function buildReport(findings, events, groups, handlers, matchers, score) {
  const lines = [
    "# Claude Code Hooks Settings Check",
    "",
    `Readiness: ${score === null ? "n/a" : score}`,
    `Events: ${events}`,
    `Handler groups: ${groups}`,
    `Handlers: ${handlers}`,
    `Matchers: ${matchers}`,
    "",
    "## Findings"
  ];

  findings.forEach((item) => {
    lines.push(`- [${item.severity.toUpperCase()}] ${item.path}: ${item.title} - ${item.detail}`);
  });

  lines.push("", "Generated locally by Claude Code Hooks Settings Checker.");
  return lines.join("\n");
}

sampleButton.addEventListener("click", () => {
  settingsInput.value = sampleSettings;
  fileKind.value = "project";
  analyzeSettings();
});

clearButton.addEventListener("click", () => {
  settingsInput.value = "";
  render({
    findings: [finding("low", "Paste a Claude Code JSON file", "Use the textarea to check settings.json or plugin hooks JSON.", "input")],
    events: 0,
    groups: 0,
    handlers: 0,
    matchers: 0,
    score: null
  });
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(reportOutput.textContent);
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy report";
    }, 1400);
  } catch {
    reportOutput.focus();
  }
});

analyzeButton.addEventListener("click", analyzeSettings);
settingsInput.addEventListener("input", analyzeSettings);
fileKind.addEventListener("change", analyzeSettings);

render({
  findings: [finding("low", "Paste a Claude Code JSON file", "Use the textarea to check settings.json or plugin hooks JSON.", "input")],
  events: 0,
  groups: 0,
  handlers: 0,
  matchers: 0,
  score: null
});
