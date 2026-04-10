# Create Email Style Skill — Setup Prompt

One-time setup prompt that a user runs in Claude Code (or Cowork) to
generate a personal email-writing-style skill based on their actual sent
mail. The prompt uses the Superhuman MCP as a READ-ONLY data source to
learn their voice, then writes a Claude skill to `~/.claude/skills/` so
that every future drafting request auto-applies their style.

## Why this is a skill, not an MCP config file

The Superhuman MCP (this repo) provides tools — `superhuman_reply`,
`superhuman_reply_all`, `superhuman_forward`, etc. Tools are *hands*:
they execute actions.

Writing style is not an action. It's judgement about how to phrase
something. That's the job of a Claude skill: a prompt fragment that
Claude's skill matcher auto-injects into context whenever the user's
intent matches the skill's `description`. By the time any draft tool is
called, Claude has already shaped the body using the skill.

Consequences of this split:

1. The MCP does not need to know the skill exists. Zero code changes
   here. Zero risk of breaking the drafting flow when the style changes.
2. The skill works even when the user isn't using the Superhuman MCP —
   if they ask Claude to draft an email for Gmail, or to draft a message
   they'll paste somewhere, the same voice comes through.
3. Each coworker has their own personal skill. No shared state, no
   merge conflicts, no need to version-control personal style in this
   repo.

## When to run this prompt

- First-time setup after installing the Superhuman MCP.
- Any time the user feels their drafts are drifting away from their
  voice and wants to retrain on more recent sent mail. (Rerun
  overwrites the existing skill.)

## The prompt

```
I want you to analyze my email writing style and turn it into a Claude
skill that will automatically shape every draft you ever write for me —
replies, forwards, new messages, regardless of which MCP or tool actually
sends them. The skill file goes in ~/.claude/skills/ and Claude's skill
matcher will auto-trigger it whenever I ask you to draft anything
email-shaped. The Superhuman MCP is being used only as a read-only data
source to learn my voice; it is NOT the runtime consumer of the skill.

Follow these steps in order.

=== STEP 1 — FIGURE OUT WHO I AM ===

Call superhuman_accounts to confirm which account is active. Note my
email address — you'll use it in Step 2. If there is no active account,
stop and tell me to run 'superhuman account auth' first.

=== STEP 2 — PULL MY SENT EMAILS ===

Call superhuman_search with query "from:<my email>" and includeDone: true
and includeProcessed: true. (includeProcessed is important — the MCP
hides already-processed threads by default, which is wrong for this
learning task where I want to see everything I've ever sent.)

Pull at least 50 threads across a wide time range. I want variety:
internal emails, external emails, quick replies, longer messages,
different recipients, different topics. If you find fewer than 50,
widen the search by removing filters or going further back. If my
volume is high, grab up to 100.

Then call superhuman_read on 30–40 of those threads to see the full
text of my messages. Pick a DIVERSE set — don't just grab the most
recent. Mix older threads, different recipients, different topics.
Read in batches of 5–8 to stay under the tool timeout.

=== STEP 3 — ANALYZE MY WRITING DNA ===

Go through every email you read and extract patterns across the
dimensions below. Be specific — pull actual phrases and fragments from
my real emails as evidence. Don't just say "tends to be casual"; show
me what casual looks like in my voice with a direct quote.

Structure & format:
- How do I open emails? ("Hi [name],", "Hey", "Morning", or just dive in?)
- How do I close them? Sign-off style, do I use my name, initials, or nothing?
- Bullet points, numbered lists, or prose?
- Typical paragraph length and email length — terse or thorough?
- Line breaks liberally or dense blocks?

Tone & register:
- How does my tone shift between internal team emails vs. external/client?
- Formal, conversational, in between? Does it depend on context?
- Do I use humor, exclamation marks, ellipses, em dashes?
- Do I hedge ("I think maybe…") or assert ("Let's do X")?

Vocabulary & phrasing:
- Words and phrases I reach for repeatedly (my verbal fingerprint).
- Industry jargon or shorthand I use naturally.
- Things I NEVER say (overly formal phrases, corporate-speak, AI-isms).
- How I make asks — direct, softened, framed as questions?

Email-type patterns:
- Quick reply vs. substantive response.
- Follow-up / nudge.
- Bad news or pushing back.
- Cold outreach or intro.

Show me the full analysis before proceeding to Step 4. I want to read
it and confirm you've got me right. Do NOT write any files yet.

=== STEP 4 — CREATE THE SKILL ===

Once I confirm the analysis, create the skill directory and file:

  mkdir -p ~/.claude/skills/email-style
  write ~/.claude/skills/email-style/SKILL.md

The file MUST start with frontmatter that makes the skill auto-trigger
on any email-drafting intent. Use EXACTLY this structure (replace
<MY FIRST NAME> and <MY EMAIL>):

---
name: email-style
description: Personal email writing style for <MY FIRST NAME> (<MY EMAIL>). Use this skill whenever drafting, composing, or writing emails — including replies, forwards, and new messages. Triggers on any email drafting, composing, or reply task. ALWAYS use this when the user asks to draft, write, compose, reply to, or forward an email, regardless of which MCP or tool will send it.
---

# Email Style Guide for <MY FIRST NAME>

## 1. Style profile

Write this section as a list of DIRECT COMMANDS to an AI, not
suggestions. Every bullet should be something the model can check its
draft against. Examples of the right shape:

- Open casual internal emails with "Hey [name]" — never "Dear" or "Hello".
- Keep replies under 3 sentences when a quick acknowledgment is all that is needed.
- Close with just my first name on internal emails, full name on external.
- Use em dashes, never semicolons.

Pull at least 10–15 concrete rules from the analysis in Step 3.

## 2. Anti-patterns (NEVER do these)

List every AI-ism that does NOT match my voice. Be specific and
aggressive. Examples of the right shape:

- Never write "I hope this email finds you well" or any variant.
- Never start a sentence with "Additionally" or "Furthermore".
- Never use the phrase "circle back", "touch base", or "at your earliest convenience".
- Never use semicolons.
- Never sign off with "Best regards" or "Warm regards".

If the Step 3 analysis surfaced specific corporate-speak I avoid, put
it here. Err on the side of MORE entries, not fewer — this section is
what prevents AI-sounding drafts.

## 3. Calibrated examples

6–10 real snippets from my emails, anonymized (replace names, company
identifiers, and sensitive numbers with [placeholders]). Organize by
email type:

- Quick internal reply
- Substantive internal email
- External / client email
- Follow-up or nudge
- Pushing back or saying no
- Cold outreach or intro (if any examples exist in the sample)

For each snippet, include a one-line note on what makes it
characteristically me — so the model understands WHY to imitate it,
not just copy it verbatim.

## 4. Context-switching rules

Explicit rules for how the tone and formality should shift based on
recipient and email type. Cover at minimum:

- Internal teammate vs. external client vs. cold recipient.
- One-line acknowledgment vs. multi-paragraph substantive reply.
- When to use lists vs. prose.
- When to open with a greeting vs. dive straight in.

Keep the ENTIRE SKILL.md under 400 lines. Be opinionated — a strong
narrow skill is more useful than a wishy-washy broad one.

=== STEP 5 — VERIFY THE SKILL INSTALLED ===

After writing the file:

1. Confirm the file exists at ~/.claude/skills/email-style/SKILL.md.
2. Print the first 20 lines so I can see the frontmatter rendered correctly.
3. Give me a short summary (under 150 words) of the voice you captured:
   opening style, sign-off style, tone, 3 signature phrases, top 3
   anti-patterns.
4. Tell me to start a fresh Claude session (the skill matcher loads
   skills at session start) and try asking "draft a reply to [someone]
   saying [X]" as a smoke test. If the draft still sounds generic,
   re-run this whole prompt and make the anti-patterns section more
   aggressive.

Do NOT modify any files under /Users/<me>/superhuman-cli or
~/.config/superhuman-cli. This skill is scoped to ~/.claude/skills/
only.
```

## Notes for future refinement

- **The `description` field is load-bearing.** If drafts start going out
  in a generic voice, 90% of the time the fix is not the body of
  SKILL.md — it's that the description isn't matching the user's actual
  phrasing ("write an email", "send a note", "shoot them a message",
  etc.). Add more trigger phrases to the description rather than
  rewriting the style rules.
- **Keep the skill under 400 lines.** Claude reads the full body on
  every trigger; overlong skills waste context and dilute the strongest
  rules.
- **Rerunning overwrites.** The prompt does not merge with an existing
  skill. If a coworker accumulates custom edits over time, they lose
  them on rerun. For now that is acceptable; if it becomes a problem,
  add a Step 4a that reads the existing file and preserves a
  "// user-added" section.
- **Coworker rollout.** Each coworker runs this prompt once after
  installing the Superhuman MCP. Consider adding a hint to the MCP
  install script (`INSTALL_SUPERHUMAN_MCP_SIMPLE.command`) pointing at
  this doc as a recommended follow-up.
