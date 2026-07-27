import type { StepTone, DocumentChangeKind, ToolIdentity } from "./step-categorizer";
import {
  classifyToolTone,
  classifyDocumentChangeKind,
  extractToolTarget,
  basenameResourcePath,
} from "./step-categorizer";

export interface StepVisualDescriptor {
  iconName: StepIconName;
  labelKey: StepLabelKey;
  defaultLabel: string;
}

export type StepLabelKey =
  | "processStepThinking"
  | "processStepFileRead"
  | "processStepFileCreate"
  | "processStepFileEdit"
  | "processStepFileDelete"
  | "processStepSearch"
  | "processStepFind"
  | "processStepList"
  | "processStepRead"
  | "processStepFetch"
  | "processStepDelete"
  | "processStepCopy"
  | "processStepCommand"
  | "processStepTool"
  | "processStepTodo"
  | "processStepArtifact"
  | "processStepCompaction"
  | "processStepError";

export type StepIconName =
  | "brain"
  | "magnifyingGlass"
  | "bookOpen"
  | "pencilSimpleLine"
  | "filePlus"
  | "trash"
  | "terminal"
  | "toolbox"
  | "image"
  | "listBullets"
  | "checklist"
  | "folder"
  | "download"
  | "copy"
  | "warning"
  | "circleX";

export interface StepDisplayInfo {
  iconName: StepIconName;
  typeLabel: string;
  displayLabel: string;
  target?: string;
  tone?: StepTone;
}

function describeDocumentChange(kind: DocumentChangeKind): StepVisualDescriptor {
  switch (kind) {
    case "create":
      return { iconName: "filePlus", labelKey: "processStepFileCreate", defaultLabel: "Create" };
    case "delete":
      return { iconName: "trash", labelKey: "processStepFileDelete", defaultLabel: "Delete" };
    case "edit":
    default:
      return { iconName: "pencilSimpleLine", labelKey: "processStepFileEdit", defaultLabel: "Edit" };
  }
}

function descriptorForTone(tone: StepTone | undefined, changeKind?: DocumentChangeKind): StepVisualDescriptor {
  switch (tone) {
    case "document_change":
      return describeDocumentChange(changeKind ?? "edit");
    case "document_read":
      return { iconName: "bookOpen", labelKey: "processStepFileRead", defaultLabel: "Read" };
    case "document_search":
      return { iconName: "magnifyingGlass", labelKey: "processStepSearch", defaultLabel: "Search" };
    case "directory_list":
      return { iconName: "folder", labelKey: "processStepList", defaultLabel: "List" };
    case "file_find":
      return { iconName: "magnifyingGlass", labelKey: "processStepFind", defaultLabel: "Find" };
    case "command_execution":
      return { iconName: "terminal", labelKey: "processStepCommand", defaultLabel: "Run" };
    case "todo_update":
      return { iconName: "checklist", labelKey: "processStepTodo", defaultLabel: "Todo" };
    case "artifact_output":
      return { iconName: "image", labelKey: "processStepArtifact", defaultLabel: "Artifact" };
    case "approval_rejected":
      return { iconName: "circleX", labelKey: "processStepError", defaultLabel: "Denied" };
    default:
      return { iconName: "toolbox", labelKey: "processStepTool", defaultLabel: "Tool" };
  }
}

export interface BuildDisplayInfoInput {
  toolName: string;
  label?: string;
  title?: string;
  args?: Record<string, unknown>;
  result?: string;
  metadata?: Record<string, unknown>;
  failed?: boolean;
  typeLabel: string;
  fallbackLabel: string;
}

export function buildToolStepDisplayInfo(input: BuildDisplayInfoInput): StepDisplayInfo {
  const tool: ToolIdentity = {
    toolName: input.toolName,
    label: input.label,
    title: input.title,
    args: input.args,
    result: input.result,
    metadata: input.metadata,
  };

  const tone = input.failed ? undefined : classifyToolTone(tool);
  const changeKind = tone === "document_change" ? classifyDocumentChangeKind(tool) : undefined;
  const descriptor = descriptorForTone(tone, changeKind);

  if (tone === "document_change" || tone === "document_read") {
    const target = extractToolTarget(tool);
    if (target) {
      const displayLabel = `${input.typeLabel} ${basenameResourcePath(target)}`;
      return { iconName: descriptor.iconName, typeLabel: input.typeLabel, displayLabel, target, tone };
    }
  }

  return {
    iconName: descriptor.iconName,
    typeLabel: input.typeLabel,
    displayLabel: input.fallbackLabel || input.typeLabel,
    tone,
  };
}

export function thinkingStepDescriptor(): StepVisualDescriptor {
  return { iconName: "brain", labelKey: "processStepThinking", defaultLabel: "Thinking" };
}

export function compactionStepDescriptor(): StepVisualDescriptor {
  return { iconName: "listBullets", labelKey: "processStepCompaction", defaultLabel: "Compaction" };
}

export function resolveTypeLabel(
  descriptor: StepVisualDescriptor,
  t: (key: string) => string,
): string {
  return t(descriptor.labelKey) || descriptor.defaultLabel;
}
