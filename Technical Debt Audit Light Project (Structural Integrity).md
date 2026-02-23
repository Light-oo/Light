# Technical Debt Audit Light Project (Structural Integrity)

## 1) Snapshot Metadata
- Snapshot branch: `main`
- Snapshot commit: `0a9a1d7`
- Audit mode: Repo-only evidence
- Audit date: 2026-02-18
- Scope: Structural integrity and long-term cost of change (not feature fit)

## 2) Method and Evidence Scope
- Source of truth was restricted to repository artifacts only.
- No live DB/RLS/RPC introspection was used.
- DB-level guarantees were only considered proven when explicit DDL/migration evidence exists in repo.
- Where DB enforcement could not be proven from repo artifacts, findings are marked with DB proof gap and `Enforcement layer: Unknown` when the claim is DB-level.

## 3) Severity and Difficulty Rubric
### Severity
- `Critical`: credible current data-integrity or security failure path.
- `High`: major scalability, architecture, or enforcement weakness likely to block roadmap velocity.
- `Medium`: meaningful maintainability/coupling issue with bounded immediate runtime risk.
- `Low`: refactor opportunity with limited current operational risk.

### Refactor Difficulty
- `Low`: localized change, low coupling.
- `Medium`: multi-file or cross-layer change with moderate regression risk.
- `High`: cross-layer redesign, migration, or contract-sensitive change.

## 4) Debt Register

### Architecture

#### TD-01
- Category: Architecture
- Severity: High
- Description: Business rules are concentrated in route handlers with limited domain-service abstraction.
- Why it is technical debt: Rules are not encapsulated in a reusable domain layer.
- Risk if ignored: Increasing change collision and regression risk as flows expand.
- Refactor difficulty: Medium
- Evidence: `src/routes/listingsRoutes.ts` (`POST /listings`), `src/routes/contactAccessRoutes.ts` (`POST /contact-access`), `src/routes/searchRoutes.ts` (`GET /search/listings`)
- Enforcement layer: App

#### TD-02
- Category: Architecture
- Severity: High
- Description: Frontend directly reads domain tables/views via Supabase REST instead of backend-only domain APIs.
- Why it is technical debt: Duplicates data-access logic and creates hidden coupling to DB/view shape.
- Risk if ignored: Backend changes can break frontend without contract changes.
- Refactor difficulty: High
- Evidence: `frontend/src/lib/supabaseData.ts` (`fetchMarketOptions`, `fetchProfile`, `fetchMyListings`, `fetchActiveListingPrices`)
- Enforcement layer: App

#### TD-03
- Category: Architecture
- Severity: Medium
- Description: HTTP transport logic and domain decision logic are mixed in single handlers.
- Why it is technical debt: Validation, role upgrade, writes, and response mapping are intertwined.
- Risk if ignored: Reduced testability and high blast radius of route changes.
- Refactor difficulty: Medium
- Evidence: `src/routes/listingsRoutes.ts` (`POST /listings`)
- Enforcement layer: App

### Database Integrity

#### TD-04
- Category: Database Integrity
- Severity: Critical
- Description: SELL-DUP-1 is enforced by application query-check path; repo does not prove DB unique constraint for active seller-signature.
- Why it is technical debt: App-only uniqueness checks are race-prone without DB uniqueness.
- Risk if ignored: Duplicate active listings under concurrent publish requests.
- Refactor difficulty: High
- Evidence: `src/routes/listingsRoutes.ts` duplicate check on `item_specs` + `listings`; no corresponding constraint in `db/migrations/20260217_pilot_user_verification.sql`
- Enforcement layer: App (DB proof gap: Unknown)

#### TD-05
- Category: Database Integrity
- Severity: High
- Description: Publish flow performs multiple inserts without explicit transaction boundary in route.
- Why it is technical debt: Partial writes can occur if later steps fail.
- Risk if ignored: Inconsistent listing state across `listings`, `item_specs`, `pricing`, `listing_locations`.
- Refactor difficulty: Medium
- Evidence: `src/routes/listingsRoutes.ts` sequential inserts
- Enforcement layer: App

#### TD-06
- Category: Database Integrity
- Severity: Critical
- Description: Reveal/token atomicity depends on RPC behavior not present in repo.
- Why it is technical debt: Core financial/integrity invariant is external and unversioned in repo.
- Risk if ignored: Unverifiable guarantees for one-time token decrement and reveal idempotency.
- Refactor difficulty: High
- Evidence: `src/routes/contactAccessRoutes.ts` call to `consume_token_and_get_whatsapp`; no RPC definition in repo
- Enforcement layer: Unknown

#### TD-07
- Category: Database Integrity
- Severity: High
- Description: FK/cascade integrity for core tables is not fully evidenced in repo migrations.
- Why it is technical debt: Data integrity relies on unseen DB schema state.
- Risk if ignored: Orphan rows and undefined delete/update behavior.
- Refactor difficulty: High
- Evidence: only `db/migrations/20260217_pilot_user_verification.sql` present for pilot verification columns/indexes
- Enforcement layer: Unknown

#### TD-08
- Category: Database Integrity
- Severity: High
- Description: Role auto-upgrade and listing creation are separate write steps.
- Why it is technical debt: No atomic boundary between authorization state mutation and business write.
- Risk if ignored: Edge-case divergence under concurrent failures/interleavings.
- Refactor difficulty: Medium
- Evidence: `src/routes/listingsRoutes.ts` role update before listing inserts
- Enforcement layer: App

### Concurrency

#### TD-09
- Category: Concurrency
- Severity: Critical
- Description: Concurrent publish requests can bypass app-level duplicate checks.
- Why it is technical debt: Check-then-insert pattern without DB unique constraint is non-atomic.
- Risk if ignored: Multiple active listings for one seller-signature.
- Refactor difficulty: High
- Evidence: `src/routes/listingsRoutes.ts` duplicate check then insert
- Enforcement layer: App (DB proof gap: Unknown)

#### TD-10
- Category: Concurrency
- Severity: High
- Description: Role upgrade and publish writes can interleave under concurrency.
- Why it is technical debt: State transition and business write are decoupled.
- Risk if ignored: Hard-to-reproduce authorization-state inconsistencies.
- Refactor difficulty: Medium
- Evidence: `src/routes/listingsRoutes.ts` profile role update + later inserts
- Enforcement layer: App

#### TD-11
- Category: Concurrency
- Severity: Medium
- Description: Rate-limit buckets are in-memory `Map` state.
- Why it is technical debt: Per-process limits do not coordinate across instances.
- Risk if ignored: Limits can be bypassed by horizontal scaling or restarts.
- Refactor difficulty: Medium
- Evidence: `src/lib/rateLimit.ts`, `src/routes/authRoutes.ts`, `src/services/profileStatus.ts`
- Enforcement layer: App

#### TD-12
- Category: Concurrency
- Severity: High
- Description: No-match demand idempotency relies on handling `23505` against unseen DB uniqueness definition.
- Why it is technical debt: Correctness depends on external DB invariant not versioned in repo.
- Risk if ignored: Unexpected duplicates or 500s if DB constraint differs from assumptions.
- Refactor difficulty: Medium
- Evidence: `src/routes/searchRoutes.ts` `isDemandOpenDuplicate` logic and fallback select
- Enforcement layer: App (DB proof gap: Unknown)

### Security

#### TD-13
- Category: Security
- Severity: High
- Description: CORS is globally permissive.
- Why it is technical debt: Broad origin allowance increases exposure surface.
- Risk if ignored: Unintended browser clients can call protected endpoints.
- Refactor difficulty: Low
- Evidence: `src/app.ts` (`app.use(cors())`)
- Enforcement layer: App

#### TD-14
- Category: Security
- Severity: High
- Description: Service-role client is used in application runtime for profile flows.
- Why it is technical debt: Privileged key in app logic increases blast radius of runtime compromise.
- Risk if ignored: Elevated data access impact if process boundary is breached.
- Refactor difficulty: High
- Evidence: `src/services/profileStatus.ts` (`createSupabaseServiceRole` usage)
- Enforcement layer: App

#### TD-15
- Category: Security
- Severity: High
- Description: Signup and verify-code throttles are in-memory only.
- Why it is technical debt: Not robust against multi-node and restart scenarios.
- Risk if ignored: Abuse resilience degrades under real deployment.
- Refactor difficulty: Medium
- Evidence: `src/routes/authRoutes.ts`, `src/services/profileStatus.ts`, `src/lib/rateLimit.ts`
- Enforcement layer: App

#### TD-16
- Category: Security
- Severity: High
- Description: Verification-code response exposure depends on env flag correctness.
- Why it is technical debt: Operational misconfiguration can leak codes in production.
- Risk if ignored: Verification bypass opportunities and privacy/security incidents.
- Refactor difficulty: Low
- Evidence: `src/routes/profileRoutes.ts` (`shouldExposeVerifyCode`), `src/config/env.ts`
- Enforcement layer: App

#### TD-17
- Category: Security
- Severity: Medium
- Description: Authorization semantics are not uniform (`403` vs `404`) across owner-related flows.
- Why it is technical debt: Inconsistent semantics increase client and policy complexity.
- Risk if ignored: Policy drift and accidental information leakage patterns over time.
- Refactor difficulty: Medium
- Evidence: `src/routes/listingsRoutes.ts` (`PATCH /listings/:listingId/status`), `src/routes/meRoutes.ts` (`DELETE /api/me/buy-demands/:id`)
- Enforcement layer: App

### Token Model

#### TD-18
- Category: Token Model
- Severity: High
- Description: Token accounting relies on mutable counter model (`profiles.tokens`).
- Why it is technical debt: Counter models are weaker for reconciliation/audit than append-only ledgers.
- Risk if ignored: Difficult forensic reconstruction and accounting disputes at scale.
- Refactor difficulty: High
- Evidence: `src/services/profileStatus.ts` reads `tokens`; no ledger schema artifact in repo
- Enforcement layer: Unknown

#### TD-19
- Category: Token Model
- Severity: High
- Description: Token consumption audit trail cannot be proven from repo artifacts.
- Why it is technical debt: Core monetary-like behavior depends on external DB/RPC state not versioned here.
- Risk if ignored: Integrity assertions cannot be independently verified in codebase.
- Refactor difficulty: High
- Evidence: `src/routes/contactAccessRoutes.ts` RPC dependency without in-repo function DDL
- Enforcement layer: Unknown

#### TD-20
- Category: Token Model
- Severity: High
- Description: Current model raises future migration cost to ledger/auditable accounting.
- Why it is technical debt: Future design shift requires cross-layer rework and migration coordination.
- Risk if ignored: High-cost, high-risk migration when monetization/auditing is introduced.
- Refactor difficulty: High
- Evidence: absence of ledger artifacts in `db/`; counter reliance in `src/services/profileStatus.ts`
- Enforcement layer: Unknown

### Search Layer

#### TD-21
- Category: Search Layer
- Severity: Medium
- Description: BUY `total` is derived from `results.length` rather than guaranteed full-count semantics.
- Why it is technical debt: Pagination metadata can diverge from actual match cardinality.
- Risk if ignored: Client paging UX and analytics accuracy degrade.
- Refactor difficulty: Medium
- Evidence: `src/routes/searchRoutes.ts` BUY response `total: results.length`
- Enforcement layer: App

#### TD-22
- Category: Search Layer
- Severity: Medium
- Description: Frontend overfetch risk from broad market option pull (`limit=1000`).
- Why it is technical debt: Pulling large view slices for option derivation does not scale well.
- Risk if ignored: Latency and bandwidth growth as dataset grows.
- Refactor difficulty: Medium
- Evidence: `frontend/src/lib/supabaseData.ts` (`fetchMarketOptions`)
- Enforcement layer: App

#### TD-23
- Category: Search Layer
- Severity: High
- Description: Search correctness depends on external RPC/view contracts not versioned in repo.
- Why it is technical debt: Contract drift is difficult to detect during code review.
- Risk if ignored: Silent breaking changes in search output/filters.
- Refactor difficulty: High
- Evidence: `src/routes/searchRoutes.ts` (`get_sell_cards`), `src/routes/contactAccessRoutes.ts` (`market_sell_cards_view`)
- Enforcement layer: Unknown

#### TD-24
- Category: Search Layer
- Severity: High
- Description: Index adequacy for search filters is not evidenced in migration artifacts.
- Why it is technical debt: Performance profile depends on unseen DB indexing strategy.
- Risk if ignored: Full scans and degraded response times under growth.
- Refactor difficulty: High
- Evidence: limited migration coverage in `db/migrations/20260217_pilot_user_verification.sql`
- Enforcement layer: Unknown

### Catalog Governance

#### TD-25
- Category: Catalog Governance
- Severity: Medium
- Description: Canonical governance rules for catalog lifecycle are not codified in repo.
- Why it is technical debt: Domain behavior for deactivation/deletion remains implicit.
- Risk if ignored: Inconsistent handling across backend/frontend and operational workflows.
- Refactor difficulty: Medium
- Evidence: no catalog lifecycle policy artifacts; catalog access in `src/routes/catalogRoutes.ts`
- Enforcement layer: Unknown

#### TD-26
- Category: Catalog Governance
- Severity: Medium
- Description: Frontend filter options depend on current market view content.
- Why it is technical debt: Option availability is coupled to listing presence, not canonical catalog sources.
- Risk if ignored: UX inconsistency when supply is sparse or filtered.
- Refactor difficulty: Medium
- Evidence: `frontend/src/lib/supabaseData.ts` (`fetchMarketOptions`), `frontend/src/lib/marketOptions.ts`
- Enforcement layer: App

### Deletion Strategy

#### TD-27
- Category: Deletion Strategy
- Severity: Medium
- Description: No explicit backend deletion lifecycle invariant beyond status toggle.
- Why it is technical debt: Lifecycle expectations are not formalized as enforceable invariants.
- Risk if ignored: Future deletion features can conflict with existing references and analytics needs.
- Refactor difficulty: Medium
- Evidence: status toggle only in `src/routes/listingsRoutes.ts`; no deletion policy artifact
- Enforcement layer: App

#### TD-28
- Category: Deletion Strategy
- Severity: High
- Description: Orphan/audit-loss risk cannot be ruled out due to incomplete FK/cascade evidence.
- Why it is technical debt: Referential behavior is partially unknown in repo snapshot.
- Risk if ignored: Potential integrity regressions when deletion paths expand.
- Refactor difficulty: High
- Evidence: only verification migration present in `db/migrations/20260217_pilot_user_verification.sql`
- Enforcement layer: Unknown

### Deployment & Runtime

#### TD-29
- Category: Deployment & Runtime
- Severity: High
- Description: Observability is minimal (no metrics/tracing, limited operational telemetry strategy).
- Why it is technical debt: Diagnosing production regressions and performance bottlenecks remains costly.
- Risk if ignored: Longer incident resolution and lower confidence in runtime behavior.
- Refactor difficulty: High
- Evidence: logging utility only in `src/lib/logger.ts`; no metrics/tracing modules in repo
- Enforcement layer: App

#### TD-30
- Category: Deployment & Runtime
- Severity: High
- Description: Security-critical runtime behavior depends on env correctness without startup hardening checks.
- Why it is technical debt: Insecure runtime combinations can pass startup.
- Risk if ignored: Misconfiguration-driven exposure in production.
- Refactor difficulty: Medium
- Evidence: `src/config/env.ts`, `src/routes/profileRoutes.ts`
- Enforcement layer: App

#### TD-31
- Category: Deployment & Runtime
- Severity: High
- Description: No centralized production hardening profile (origin allowlist, structured log levels, op-mode policies).
- Why it is technical debt: Environment hardening is implicit and inconsistent.
- Risk if ignored: Drift between environments and unpredictable security posture.
- Refactor difficulty: Medium
- Evidence: `src/app.ts` CORS defaults, generic console logging paths across routes
- Enforcement layer: App

### API Contract

#### TD-32
- Category: API Contract
- Severity: Medium
- Description: No versioned API namespace.
- Why it is technical debt: Backward compatibility management becomes harder as contracts evolve.
- Risk if ignored: Higher risk of client breakage during endpoint evolution.
- Refactor difficulty: Medium
- Evidence: route registration in `src/app.ts` without `/v1` prefix
- Enforcement layer: App

#### TD-33
- Category: API Contract
- Severity: Medium
- Description: Success envelope styles are mixed across endpoints.
- Why it is technical debt: Client implementations require endpoint-specific envelope logic.
- Risk if ignored: Increased frontend coupling and contract regression risk.
- Refactor difficulty: Medium
- Evidence: `src/routes/searchRoutes.ts` (flat `results/page/total`) vs `src/routes/profileRoutes.ts` (`data` envelope) vs `src/routes/meRoutes.ts`
- Enforcement layer: App

#### TD-34
- Category: API Contract
- Severity: Medium
- Description: In-repo contract documentation is stale relative to current implementation.
- Why it is technical debt: Documentation drift increases onboarding and integration error rates.
- Risk if ignored: Teams implement against incorrect assumptions.
- Refactor difficulty: Low
- Evidence: `API_CONTRACT.md` references outdated branch and contract notes inconsistent with current `main`
- Enforcement layer: App

## 5) Evidence Gap Section (Repo-Only Limitations)
- DB uniqueness/constraints for SELL-DUP-1: not proven in repo artifacts.
- RPC definitions and DB-side token/reveal atomic logic: not present in repo.
- Full FK/cascade map for listings/demands/contact tables: not present in repo migrations.
- Search/index strategy for performance-sensitive paths: not evidenced in repo migrations.
- RLS policy completeness across all tables/functions: not evidenced in repo artifacts.

## 6) Business-Critical Invariant Enforcement Map
- SELL duplicate control:
  - App: yes (`src/routes/listingsRoutes.ts` query-check)
  - DB: unknown (no repo-evidenced unique active-seller-signature constraint)
  - Effective mapping: `App + Unknown`
- Reveal uniqueness/token decrement:
  - App: route delegates to RPC (`src/routes/contactAccessRoutes.ts`)
  - DB/RPC: unknown in repo
  - Effective mapping: `Unknown`
- profileComplete gating for publish/reveal:
  - App: yes (`src/routes/listingsRoutes.ts`, `src/routes/contactAccessRoutes.ts`)
  - DB: not required for gate logic itself
  - Effective mapping: `App`
- Active-only reveal visibility:
  - App: yes (`market_sell_cards_view` check in route)
  - DB/view contract details: unknown in repo
  - Effective mapping: `App + Unknown`

## 7) Audit Validation Scenarios Coverage
- Every required layer has at least one debt item: covered.
- Every item contains severity + difficulty + evidence + enforcement layer: covered.
- DB-level claims marked with proof gap and `Unknown` enforcement when not proven: covered.
- Business-critical invariants mapped to enforcement layer: covered.
- No feature proposals/redesign prescriptions included: covered.

## 8) Priority Summary
- Critical: 3
- High: 20
- Medium: 11
- Low: 0

## 9) Refactor Cost Summary
- High difficulty: 14
- Medium difficulty: 17
- Low difficulty: 3
