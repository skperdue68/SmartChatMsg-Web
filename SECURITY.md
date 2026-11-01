# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**. (Repository owners: this needs *Private vulnerability reporting* enabled under Settings → Code security.)

Include what you found, how to reproduce it, and which version or commit you tested.

## Scope and design notes

- The editor itself runs in the browser. Lua files are parsed as restricted data and are never executed.
- The optional **shared server library** has no logins by design: anyone who can reach it can list, download and (subject to the overwrite password) replace entries. Do not upload anything you would not want public.
- Limits for that library (storage quota, concurrent uploads, password-guess throttling) are documented in the README. Request rate limiting should be added at your reverse proxy.

## Supported versions

Only the latest commit on `main` is supported.
