# Security Policy

## Supported versions

Only the latest minor release of `llmknows` receives security fixes. Please upgrade to the newest
version before reporting.

| Version               | Supported |
| --------------------- | --------- |
| Latest minor (x.Y.z)  | Yes       |
| Anything older        | No        |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately through GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/uemrey0/llmknows/security/advisories/new).

Include a description of the issue, steps to reproduce, affected versions and the potential impact.
You can expect an initial response within 7 days. Once a fix is released, the advisory will be
published and you will be credited unless you prefer otherwise.

## Scope

llmknows sends prompts to LLM providers using API keys you supply and typechecks the generated code
locally. It never executes generated code. Issues of particular interest include API key leakage
(logs, reports, badges), unintended code execution and path traversal when resolving package types.
