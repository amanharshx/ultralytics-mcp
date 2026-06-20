export type NormalizedToolResult = {
  summary: string;
  data: unknown;
};

export function toMcpTextResult(result: NormalizedToolResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result),
      },
    ],
  };
}
