<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Code Generation (Ponytail)

Before writing any code, stop at the first rung that holds:

1. Does this need to exist? (YAGNI — skip it)
2. Already in this codebase? → reuse the helper, util, or pattern
3. Does the stdlib do it? → use it
4. Native platform feature? → use it
5. Installed dependency covers it? → use it
6. Can it be one line? → make it one line
7. Only then: write the minimum code that works

Rules: no abstractions not explicitly requested · no new dependency if avoidable · deletion over addition · boring over clever · fewest files possible · shortest working diff wins.

Not lazy about: input validation at trust boundaries · error handling that prevents data loss · security · accessibility.

Mark intentional simplifications with a `// ponytail:` comment naming the known ceiling and upgrade path.
