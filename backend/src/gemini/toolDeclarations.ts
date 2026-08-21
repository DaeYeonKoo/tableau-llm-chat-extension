import { FunctionDeclaration } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// tableau-mcp가 노출하는 도구 목록(INCLUDE_TOOLS로 이미 화이트리스트된 것들)을
// Gemini function-calling 선언으로 그대로 변환한다. inputSchema가 표준 JSON Schema라서
// parametersJsonSchema에 바로 꽂아 쓸 수 있다.
//
// allowedNames를 넘기면 tableau-mcp의 INCLUDE_TOOLS와 별개로 이 오케스트레이터가 실제로
// Gemini에게 노출할 도구를 한 번 더 좁힌다(심층 방어). 예: get-view-data는 우리 필터 주입
// 로직이 미치지 않는 도구라서, RLS를 강제해야 하는 경로에서는 아예 안 보여줘야 한다.
export async function listGeminiToolDeclarations(
  client: Client,
  allowedNames?: readonly string[],
): Promise<FunctionDeclaration[]> {
  const { tools } = await client.listTools();
  const filtered = allowedNames ? tools.filter((tool) => allowedNames.includes(tool.name)) : tools;
  return filtered.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.inputSchema,
  }));
}
