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
 * Nav-badge count for the agents settings page: how many profiles win their
 * scope. Shadowed sources still show up in the list (marked as overridden), but
 * counting them would inflate the number of distinct agents.
 */
export function countEffectiveSubagentProfiles(profiles: readonly SubagentProfile[]): number {
  return profiles.filter((profile) => !isSubagentProfileOverridden(profile, profiles)).length;
}
