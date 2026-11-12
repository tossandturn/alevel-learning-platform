# Private-plan dialogue: forward correction after B acceptance

## Scope and evidence

This is a new forward patch, not a rewrite of release A/B, an old room, a canonical script edition, or the accepted editorial source. Runtime changes are limited to `server/roleVoices.js` and `server/scriptConversation.js`. No database schema, secret visibility, game-state transition, catalog flag, image routing, client or provider configuration changes are included.

Root's actual B HTTPS run completed seven journeys, eleven real actor replies and seven DM guides. Its functional PASS is **not** a dialogue-style PASS. The original synthetic evidence remains untouched at task `qa/editorial-production-afterB-20261113.json`, SHA256 `5ad1d7416b506b5cd758dfa34273c882d330ab33f0a06486b11c3153acff580f`.

Observed failures include the comma-suffixed memory acknowledgment, an invented definite nine-o'clock availability, unsolicited case timestamps, and narrating compliance with the user's request to recall an invitation. The Venice reply additionally invented a two-word past slip of the player's tongue. These are not excused as good characterization.

## Root causes and bounded correction

1. The memory-ack regex matched the start of a sentence, but not “门边，青色便签，我记下了”. The guard now covers clause-boundary acknowledgments without blocking “我记得…” or actually writing an address in a notebook.
2. The voice guard covered deciding/choosing on someone's behalf, but missed “应下/答应” and statements about merely repeating instructions. Those narrow output patterns are now rejected; ordinary denials, refusal, uncertainty and requests to repeat an actual recording remain valid.
3. The personal-dialogue classifier missed ordinary meeting proposals, recall of private arrangements, “先不谈工作/路线”, and direct questions about how someone feels. Those turns now use the existing personal projection: no active evidence list or automatic investigative objective. An initial pause phrase is stripped before checking the remainder: “先不谈案子，还是解释21:01的门禁记录” is a real investigation request, not a personal-context bypass. The original secret/fact guards remain intact.
4. A new narrow schedule guard distinguishes an ungrounded definite availability/work schedule from an explicitly proposed meeting time. Actual visible prior availability may ground the response; an unrelated case timestamp may not. This is not a general ban on mentioning times or initiating an invitation.
5. A narrow addressed-past-quote guard covers short quoted words attributed to what the other player said yesterday/previously, including the observed “把咖啡说成马飞” wording without quotation marks. Dialogue provenance is restricted to the current addressed sender's **own** saved utterances, identified by real `actor` / `speaker` IDs (name fallback only where no ID exists). An AI's previous fabrication and a different player's allegation do not prove that the sender said it. Authored canonical facts and verified evidence remain valid sources. A conflicting ID cannot be legitimized by borrowing the sender's display name. The guard complements, rather than replaces, the existing longer recollection-quote guard; it is not claimed to be a full semantic hallucination detector.
6. Prompt wording instructs actors to respond to the concrete place, object, feeling or their own wish, not narrate instruction-following. It explicitly separates an unspecified later meeting from a fabricated known schedule and prevents using invented player anecdotes as a conversation starter.

No generated string is silently rewritten into a canned response. The existing API allows one bounded repair. If the second draft is still invalid, the job fails without persisting the invalid line or changing story state. This can expose remaining generation failures rather than pretending stylistic success; the next real provider run must demonstrate the improved first/repair drafts.

## Verification

- `node scripts/test-script-private-plan-voice.mjs`: RED on the actual missed comma-ack, then GREEN; additional RED/GREEN for unrelated case time grounding and the unsupported short player quote. Tests preserve normal negation/refusal, “我记得”, concrete notebook writing, known schedules and explicitly suggested times.
- Root-review regressions additionally cover prior-AI self-corroboration, another player's attribution, real sender self-report via message/anchor metadata, conflicting ID versus name, unquoted slips, verified evidence, and an explicit investigation request following an initial pause phrase. Actual work/route pause followed by a caring question stays personal.
- Actual local room/API tests exercise 陈砚 and 周泊舟: one rejected draft followed by a valid natural response is persisted once; two invalid drafts produce a failed job, no invalid memory, no evidence disclosure and no stage change. All seven current canonical data hashes remain unchanged within the exercise.
- Existing role voice, short conversation, conversation API, case timeline/guidance, recollection API, Iceland performance and signed room API regressions pass, including fixed older canonical hashes and private-memory behavior.
- `git diff --check` passes.
- Private audit `ops/audit-script-live-style-forward-20261113.mjs` checks every one of the original eleven actor outputs. Six now trigger repair; five are preserved by these narrow guards. Its result is task `qa/script-live-style-forward-20261113.json`. The observatory reply's unsolicited return to task material remains explicitly noted for human/live product review; passing a narrow language guard does not certify every artistic choice.

No production mutation or real model request was made by this patch's local tests. Forward deployment, live rechecking of the observed turns and native-device experience remain root's release gates. Original B evidence and its style failures are retained.
