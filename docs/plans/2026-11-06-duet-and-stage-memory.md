# Add a separate duet and repair cross-act private continuity

> **For implementer:** Test first; do not replace the existing four scripts or relax private-channel permissions.

**Goal:** Add a fifth original male/female love story for exactly two roles (one or two humans), and keep private promises intelligible when crossing acts.

**Architecture:** Add a server-only `one-more-stop` content edition using the installed capability-2 room renderer. Derive evidence thresholds from the current script, not a fixed four. Preserve all existing game definitions. Build a bounded, speaker-labelled continuity packet from the room's durable visible messages and the actor's own completed choices; rank only after privacy filtering. No new provider call or database migration is needed for memory.

## Design

- 《再陪我一站》: 苏棠 (27, female lighting designer) and 江远 (28, male recording engineer), together for three years, discussing six months of long-distance work. Three acts, two evidence items per act, one private decision per person per act. No detective password is forced into the romance.
- Empty seat is filled by one AI. A third human is rejected without claiming any identity. Final mutual continuation, mutual goodbye, and unilateral refusal have distinct authored outcomes; a public closing-scene vote does not override a refusal.
- New memories use exact historical excerpts with speaker/channel/act provenance, not invented AI summaries. Preserve private/public and participant boundaries, include the AI actor's past personal decisions, and distinguish unanswered proposals from mutual commitments.
- Backfill act labels for old saved messages from authoritative DM act-opening markers. New messages include their current act; committed AI replies reference the triggering message.
- Entry-card statements such as “not yet confirmed” describe the beginning of the story. Visible in-game conversation can update relationship knowledge; fixed past events, clue ownership and final state remain authoritative.
- Existing native client has hardcoded “four stories / four characters” copy. Correct those source strings to dynamic/generic wording for the next consolidated upload; this task does not upload a client. Old clients still play two-seat rooms, but their old detail caption remains inaccurate. Unknown script IDs use the existing basic visual fallback and inline scene images, without a new custom theme.

## Steps

1. Reproduce a saved private promise disappearing beyond the 35-message/16-reply windows after an act transition.
2. Add and test `scriptRoomMemory.js`; test old-message stage inference, restart, quote ownership, private-to-public non-leakage, other-pair exclusion, private choices and bounded payload size.
3. Author and register `scriptDuetRomance.js`; test original-four hashes, exact two-seat capacity, two-clue advancement, 1-human/2-human complete journeys, all final-choice combinations and image capability compatibility.
4. Test actual API generation uses the continuity packet. Run all script/Tavern regressions and frozen capability-2 renderers. Correct only the numeric client copy, keeping layout and interactions unchanged.
5. Deploy a pinned minimal backend artifact after exact-target resource/rollback gates. Verify old room continuity, new duet creation/join/three acts/ending, and bounded real AI recall from a prior act. No real account/private transcript inspection; use synthetic identities.

## References

[Writing with ink](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md): explicit state and choices. [SillyTavern Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/): character background versus conversational context. All story prose is original; no new dependency is introduced.
