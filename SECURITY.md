# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through GitHub: [Report a vulnerability](https://github.com/ryderdinh/rydspine-mcp/security/advisories/new). Include what you found, how to reproduce it and what an attacker could do with it. You should get a reply within a week.

Only the latest version on `main` is supported; fixes are not backported.

## What rydspine trusts

rydspine is a local tool. Knowing its boundaries helps judge what counts as a vulnerability:

- **The MCP client is trusted.** The server runs over stdio on your machine with your permissions. Tools read the files the client names (PSDs, PNGs, Spine exports) write projects under the workspace folder (`RYDSPINE_WORKSPACES`, by default `workspaces/` or `~/.rydspine/workspaces`), and `export` writes to the folder the client asks for. A client that can call tools can read any file you can.
- **Input files are not trusted.** Malformed or hostile PSD, PNG, JSON, `.skel` or atlas files should fail with an error, not crash the host, exhaust memory or write outside the workspace. PSD import, for example, rejects oversized documents and layers before decoding them. Bugs here are in scope.
- **The studio is local only.** `npm run ui` listens on `127.0.0.1` and serves the workspaces read-only. Anything that exposes it to other machines, or lets a web page change projects, is in scope.
- **No secrets are stored.** rydspine never reads or stores Spine license keys. The acceptance scripts read `SPINE_ACTIVATION_CODE` from the environment only, to activate the Spine Editor, and must never print or save it.
- **The installers** download the source from GitHub over HTTPS and run `npm install`. They are plain scripts you can read before running.
