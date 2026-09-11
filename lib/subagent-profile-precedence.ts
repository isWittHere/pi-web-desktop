import type { SubagentProfile, SubagentScope } from "./subagents";

const SUBAGENT_SCOPE_PRIORITY: Record<SubagentScope, number> = {
  builtin: 0,
  global: 1,
  workspace: 2,
  project: 3,
};

export function isSubagentProfileOverridden(
  profile: Pick<SubagentProfile, "name" | "scope">,
  profiles: readonly Pick<SubagentProfile, "name" | "scope">[],
): boolean {
  const name = profile.name.toLowerCase();
  const priority = SUBAGENT_SCOPE_PRIORITY[profile.scope];
  return profiles.some((candidate) =>
    candidate.name.toLowerCase() === name
    && SUBAGENT_SCOPE_PRIORITY[candidate.scope] > priority
  );
}

/**
 * Counts behind the agents settings badge: how many profiles win their scope
 * (shadowed sources excluded) and how many of those can actually run. Built-in
 * subagents are gated by the master switch, so it zeroes the enabled count.
 */
export function countEffectiveSubagentProfiles(
  profiles: readonly SubagentProfile[],
  masterEnabled: boolean,
): { enabled: number; total: number } {
  const effective = profiles.filter((profile) => !isSubagentProfileOverridden(profile, profiles));
  return {
    enabled: masterEnabled ? effective.filter((profile) => profile.enabled).length : 0,
    total: effective.length,
  };
}
