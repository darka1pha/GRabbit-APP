# Security Policy

## Supported Versions

Only the latest release on `main` receives security updates.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.
Instead, report them privately via [GitHub Security Advisories](https://github.com/darka1pha/GRabbit-APP/security/advisories/new).

Include:
- Affected component (`desktop`, `mobile`, `telegram-bot`, `extension`, or shared package)
- Reproduction steps or proof-of-concept
- Potential impact

## Security Architecture Notes

- **Desktop RPC Bridge (`127.0.0.1:31542`)**: Protected by a random per-install `X-GRabbit-Token` stored via OS credential encryption (`safeStorage`) and rate-limited against brute-force attempts. Remote LAN callers are blocked from accessing private/loopback networks (SSRF protection).
- **Extension Cookie Forwarding**: Cookies are only forwarded over loopback (`127.0.0.1` / `localhost`) by default unless `allowRemoteCookies` is explicitly enabled.
- **Release Verification**: Desktop and Mobile auto-updaters verify `SHA256SUMS.txt` before launching installers.
