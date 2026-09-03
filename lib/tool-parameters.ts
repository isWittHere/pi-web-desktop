// Parse a tool's JSON-schema (TypeBox) `parameters` object into display fields.
//
// pi tools declare their parameter schema with TypeBox (e.g. bash uses
// `Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number()) })`).
// TypeBox serializes to a JSON-Schema-compatible object whose shape we parse
// here for the tool-definitions panel:
//
//   { type: "object", properties: {...}, required: [...] }
//
// Property shapes we handle:
//   - scalar            { type: "string" | "number" | "integer" | "boolean" }
//   - optional (absence from `required`, or `required` missing entirely)
//   - default / enum / const annotations
//   - union             { anyOf: [...] } / { oneOf: [...] }
//   - nullable          { type, nullable: true } or anyOf branch `{type: "null"}`
//   - array             { type: "array", items: {...} }
//   - nested object     { type: "object", properties: {...}, required: [...] }
//   - $ref / unresolved — surfaced as "any"

export interface ToolParameterField {
  name: string;
  /** Human-readable type summary, e.g. "string" or "string | null" or "enum<string>". */
  type: string;
  /** True when the property is required (present in the root `required` array). */
  required: boolean;
  /** Property `description`, if any. */
  description?: string;
  /** Property `default`, if any. */
  defaultValue?: unknown;
  /** Property `enum` values, if any. */
  enumValues?: unknown[];
}

/** Render a single JSON schema node (a property schema) to a compact type string. */
function describeSchema(node: Record<string, unknown> | undefined, depth: number): string {
  if (!node || typeof node !== "object") return "any";
  if (depth > 6) return "any";

  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const branches = (Array.isArray(node.anyOf) ? node.anyOf : node.oneOf) as unknown[];
    const parts = branches.map((b) => describeSchema(b as Record<string, unknown>, depth + 1));
    // A single "null" alongside one type collapses to "type?".
    const nulls = parts.filter((p) => p === "null").length;
    if (nulls > 0 && parts.length === 2) {
      const other = parts.find((p) => p !== "null");
      if (other) return `${other}?`;
    }
    return [...new Set(parts)].join(" | ");
  }

  if (node.$ref != null) return "any";

  if (node.enum != null && Array.isArray(node.enum)) return `enum<${node.enum.length}>`;

  if (node.const != null) return JSON.stringify(node.const);

  const type = typeof node.type === "string" ? node.type : "any";
  let result = type;
  if (type === "array" && node.items != null) {
    result = `Array<${describeSchema(node.items as Record<string, unknown>, depth + 1)}>`;
  } else if (type === "object") {
    result = "object";
  }
  if (node.nullable === true) result += "?";
  return result;
}

/** Extract display fields for a tool's parameter schema (the root object). */
export function getToolParameterFields(parameters: unknown): ToolParameterField[] {
  if (!parameters || typeof parameters !== "object") return [];
  const props = parameters as Record<string, unknown>;
  const properties = props.properties as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== "object") return [];

  const requiredSet = new Set<string>(
    Array.isArray(props.required)
      ? (props.required as string[]).filter((k): k is string => typeof k === "string")
      : [],
  );

  return Object.entries(properties).map(([name, raw]) => {
    const schema = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const defaultValue = schema.default;
    return {
      name,
      type: describeSchema(schema, 0),
      required: requiredSet.has(name),
      ...(typeof schema.description === "string" ? { description: schema.description } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(Array.isArray(schema.enum) ? { enumValues: schema.enum as unknown[] } : {}),
    };
  });
}