# Agent PR workflow

Owner clarification, October 26, 2026 (America/Los_Angeles).

Earlier reviewed checkpoints went directly to main. They have commit history, not pull-request history. Do not invent retrospective PRs or describe ticket evidence as GitHub reviews. AI role names are not separate authenticated GitHub accounts.

Skeleton/generator PRs belong in sauravcn/forma-skeleton; application/tracker PRs belong in sauravcn/forma-kernel-care-center. Codex serializes Git operations and prepares scoped engineering branches/worktrees. Each subsequent PR identifies its FORMA ticket, owner role, actual peer findings, behavior, tests and limitations. Dependent agent changes target the continuing integration feature branch; the complete reviewed/tested integration then targets main. Temporary worker branches do not create competing product directions. Do not merge broken dependencies to manufacture PR counts.

A shared credential cannot provide native independent approval of its own PR. Record actual same-task AI review in ticket evidence/PR descriptions; never fabricate separate GitHub accounts or native approvals.

Current confirmed blocker: an unauthenticated HTTPS probe to api.github.com fails at the proxy CONNECT tunnel with HTTP403 (Envoy), before reaching GitHub. gh reports its token invalid, but that warning is not evidence of bad credentials while the network route is denied. Git transport pushes work separately. No PR was created. Continue authorized feature backups and implementation; hold the new main integration for PR workflow while access is unresolved. The setup draft now preserves all existing custom network entries and adds only api.github.com; saving succeeded with requires_publish=true. Review/save and publish in environment settings, then retest existing injected credentials and actual PR permission before requesting any new credential. Never put secrets in Git/chat. A repository administrator may alternatively create a real PR through GitHub UI from a verified remote branch. A compare link alone is not a PR.


## Required identity and review sequence

Owner explicitly accepts the shared sauravcn GitHub identity and requires one PR per agent work item. PR title format is `FORMA-NNNN [Aarav|Saurya|Shreesh|Codex] Concrete change`. The role label identifies the contributing AI engineer; it is not a forged Git author/account. Each PR body names the implementer and peer reviewer, links its numbered ticket, records actual review findings/fixes and relevant test evidence, and links prerequisites. Sequence: agent implementation → actual peer source review → review findings recorded on that PR → Codex integration merge after checks. A self-approval cannot stand in for peer review; shared-account limitations do not waive the review trail. Use ordinary PR comments for attributed AI review when native independent approval is unavailable.

Current unmerged combined commits are a recovery backup. Preserve that backup when preparing scoped agent branches/PRs; do not rewrite pushed history, manufacture empty retrospective PRs or claim older main commits had PR review. Native PR creation currently remains blocked by the confirmed network prerequisite.
