"use client";

import type { CSSProperties, ReactNode } from "react";
import type { GitRefTag, GitRefTagKind } from "@/lib/git-graph-refs";

// Ref decoration chips share the lane color of the commit they decorate, so a
// tag visually reads as sitting on its branch line. HEAD is solid; the other
// kinds are tinted outlines of the same lane color. Shared by the git-graph
// tab and the @comment: menu's commit rows.

function refChipStyle(kind: GitRefTagKind, laneColor: string): CSSProperties {
  if (kind === "head") {
    return { background: laneColor, color: "var(--bg)" };
  }
  return {
    color: laneColor,
    borderColor: `color-mix(in srgb, ${laneColor} 40%, transparent)`,
    background: `color-mix(in srgb, ${laneColor} 10%, transparent)`,
  };
}

function RefChip({ tag, laneColor }: { tag: GitRefTag; laneColor: string }) {
  return (
    <span
      title={tag.ref}
      style={{ display: "inline-flex", alignItems: "center", minWidth: 0, maxWidth: 180, height: 17, padding: "0 6px", borderRadius: 4, border: "1px solid transparent", fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap", flexShrink: 0, ...refChipStyle(tag.kind, laneColor) }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tag.label}</span>
    </span>
  );
}

// "HEAD -> main" parses as two adjacent tags (solid HEAD + outlined branch);
// they render fused into one pill so the decoration reads as a single tag.
// Each segment keeps its original treatment and the shared lane color.
function FusedRefChip({ head, branch, laneColor }: { head: GitRefTag; branch: GitRefTag; laneColor: string }) {
  return (
    <span
      title={branch.ref}
      style={{ display: "inline-flex", alignItems: "center", height: 17, borderRadius: 4, border: `1px solid color-mix(in srgb, ${laneColor} 40%, transparent)`, background: `color-mix(in srgb, ${laneColor} 10%, transparent)`, fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap", flexShrink: 0, overflow: "hidden" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", height: "100%", padding: "0 6px", background: laneColor, color: "var(--bg)" }}>
        {head.label}
      </span>
      <span style={{ minWidth: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", padding: "0 6px", color: laneColor }}>
        {branch.label}
      </span>
    </span>
  );
}

export function RefTagList({ tags, laneColor }: { tags: GitRefTag[]; laneColor: string }) {
  const items: ReactNode[] = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    const next = tags[index + 1];
    const key = `${tag.kind}:${tag.ref}:${index}`;
    if (tag.kind === "head" && next?.kind === "branch" && next.ref.startsWith("HEAD -> ")) {
      items.push(<FusedRefChip key={key} head={tag} branch={next} laneColor={laneColor} />);
      index += 1;
    } else {
      items.push(<RefChip key={key} tag={tag} laneColor={laneColor} />);
    }
  }
  return <>{items}</>;
}
