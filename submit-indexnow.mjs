#!/usr/bin/env node

const siteUrlArg = process.argv.find((arg) => arg.startsWith("--site-url="));
const siteUrl = (siteUrlArg ? siteUrlArg.split("=")[1] : "https://claude-code-hooks-settings-checker.vercel.app").replace(/\/$/, "");
const key = "c36194fa25bbdb804fa6dd4795243173";
const urls = [`${siteUrl}/`, `${siteUrl}/llms.txt`, `${siteUrl}/sitemap.xml`];

const body = {
  host: new URL(siteUrl).host,
  key,
  keyLocation: `${siteUrl}/${key}.txt`,
  urlList: urls
};

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: {
    "content-type": "application/json; charset=utf-8"
  },
  body: JSON.stringify(body)
});

console.log(JSON.stringify({ status: response.status, submitted: urls.length }, null, 2));

if (!response.ok && response.status !== 202) {
  process.exitCode = 1;
}
