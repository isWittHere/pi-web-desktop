/**
 * The single model decision point for a session.
 *
 * Historically "which model is this session using?" was derived independently in
 * four places (the session-reader display projection, startRpcSession's restore,
 * the SDK's own createAgentSession restore, and the set_model command), while the
 * environment — the model registry — could invalidate the recorded model without
 * anyone noticing. This module is the one place that answers the question, so the
 * answer can carry an explicit state (active / missing+reason+suggestion) instead
 * of silently diverging between the display and the runtime.
 *
 * Pure by construction: it imports types only and never touches SDK runtime code,
 * which keeps it fully unit-testable.
 */

interface ModelRef {
  provider: string;
  modelId: string;
}

/** Minimal structural view of a ModelRuntime (no SDK runtime dependency). */
interface SessionModelRuntimeView {
  getModel(provider: string, modelId: string): { provider: string; id: string } | undefined;
  hasConfiguredAuth(provider: string): boolean;
}

interface SessionModelScopedEntry {
  model: { provider: string; id: string };
  thinkingLevel?: string;
}

/** Minimal structural view of `resolveVisibleModels`' result. */
interface SessionModelScopeView {
  visible: readonly { provider: string; id: string }[];
  scopedModels: readonly SessionModelScopedEntry[];
}

type SessionModelMissingReason =
  | "deleted"         // the registry no longer has this provider/modelId
  | "no-auth"         // the model exists but its provider has no configured auth
  | "out-of-scope"    // resolvable, but excluded by the enabledModels scope
  | "none-available"; // no model exists at all

type SessionModelSource =
  | "session"          // restored from the session file's latest model_change
  | "user-request"     // explicit pick in the new-session composer
  | "settings-default" // settings.json defaultProvider/defaultModel
  | "scope-first";     // first model of the enabledModels scope

export type SessionModelState =
  | {
      status: "active";
      model: ModelRef;
      source: SessionModelSource;
      /** Thinking-level pin from a scopedModels entry (never for `session`). */
      thinkingLevel?: string;
    }
  | {
      status: "missing";
      recorded: ModelRef | null;
      reason: SessionModelMissingReason;
      /** Explicit fallback target, or null when nothing is available. */
      suggestion: ModelRef | null;
    };

interface ResolveSessionModelInput {
  /** Latest `model_change` recorded in the session file (the user's intent). */
  recorded?: ModelRef | null;
  /** Explicit model chosen by the user (new-session composer / initialModel). */
  requested?: ModelRef | null;
  runtime: SessionModelRuntimeView;
  scope: SessionModelScopeView;
  /** settings.json default provider/model, when configured. */
  settingsDefault?: ModelRef | null;
}

export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.modelId === b.modelId;
}

function toRef(model: { provider: string; id: string }): ModelRef {
  return { provider: model.provider, modelId: model.id };
}

function findVisible(scope: SessionModelScopeView, ref: ModelRef) {
  return scope.visible.find((model) => model.provider === ref.provider && model.id === ref.modelId);
}

function scopedEntryFor(scope: SessionModelScopeView, ref: ModelRef): SessionModelScopedEntry | undefined {
  return scope.scopedModels.find(
    (entry) => entry.model.provider === ref.provider && entry.model.id === ref.modelId,
  );
}

function classifyMissing(runtime: SessionModelRuntimeView, ref: ModelRef): SessionModelMissingReason {
  const model = runtime.getModel(ref.provider, ref.modelId);
  if (!model) return "deleted";
  if (!runtime.hasConfiguredAuth(model.provider)) return "no-auth";
  return "out-of-scope";
}

interface Suggestion {
  model: ModelRef;
  source: SessionModelSource;
  thinkingLevel?: string;
}

/**
 * Pick the explicit fallback target for a missing recorded model. Priority
 * mirrors pi's own initial-scope selection: settings default (in scope) →
 * first scoped model → first visible model. A model outside the scope is never
 * suggested — enabledModels is a deliberate user constraint, and a no-auth
 * model fails loudly at prompt time anyway.
 */
function resolveSuggestion(
  scope: SessionModelScopeView,
  settingsDefault: ModelRef | null | undefined,
): Suggestion | null {
  if (settingsDefault) {
    const visible = findVisible(scope, settingsDefault);
    if (visible) {
      const entry = scopedEntryFor(scope, settingsDefault);
      return {
        model: toRef(visible),
        source: "settings-default",
        ...(entry?.thinkingLevel ? { thinkingLevel: entry.thinkingLevel } : {}),
      };
    }
  }
  const firstScoped = scope.scopedModels[0];
  if (firstScoped) {
    return {
      model: toRef(firstScoped.model),
      source: "scope-first",
      ...(firstScoped.thinkingLevel ? { thinkingLevel: firstScoped.thinkingLevel } : {}),
    };
  }
  const firstVisible = scope.visible[0];
  if (firstVisible) return { model: toRef(firstVisible), source: "scope-first" };
  return null;
}

export function resolveSessionModel(input: ResolveSessionModelInput): SessionModelState {
  const { runtime, scope, settingsDefault } = input;
  const requested = input.requested ?? null;
  const recorded = input.recorded ?? null;

  // 1. An explicit user request always decides first (new-session composer).
  if (requested) {
    const visible = findVisible(scope, requested);
    if (visible) {
      const entry = scopedEntryFor(scope, requested);
      return {
        status: "active",
        model: toRef(visible),
        source: "user-request",
        ...(entry?.thinkingLevel ? { thinkingLevel: entry.thinkingLevel } : {}),
      };
    }
    return {
      status: "missing",
      recorded: requested,
      reason: classifyMissing(runtime, requested),
      suggestion: resolveSuggestion(scope, settingsDefault)?.model ?? null,
    };
  }

  // 2. Restore the recorded model when it is still resolvable in scope + auth.
  if (recorded) {
    const visible = findVisible(scope, recorded);
    if (visible && runtime.hasConfiguredAuth(visible.provider)) {
      return { status: "active", model: toRef(visible), source: "session" };
    }
    return {
      status: "missing",
      recorded,
      reason: classifyMissing(runtime, recorded),
      suggestion: resolveSuggestion(scope, settingsDefault)?.model ?? null,
    };
  }

  // 3. Fresh session with no explicit request: use the default/scope model.
  const suggestion = resolveSuggestion(scope, settingsDefault);
  if (suggestion) {
    return {
      status: "active",
      model: suggestion.model,
      source: suggestion.source,
      ...(suggestion.thinkingLevel ? { thinkingLevel: suggestion.thinkingLevel } : {}),
    };
  }

  // 4. No model exists anywhere.
  return { status: "missing", recorded: null, reason: "none-available", suggestion: null };
}

interface DisplayModelInput {
  /** A model the user switched to in this browser session. */
  override?: ModelRef | null;
  /** The live runtime model from `get_state` (authoritative). */
  live?: ModelRef | null;
  /** The session file's latest `model_change` (placeholder before materialization). */
  recorded?: ModelRef | null;
  /** A model picked before the session was materialized. */
  pending?: ModelRef | null;
}

/**
 * The one display priority: an explicit switch in this browser session wins,
 * then the live runtime model (authoritative), then the recorded file value
 * (only a placeholder before the session is materialized), then a pending pick.
 */
export function selectDisplayModel(input: DisplayModelInput): ModelRef | null {
  return input.override ?? input.live ?? input.recorded ?? input.pending ?? null;
}
