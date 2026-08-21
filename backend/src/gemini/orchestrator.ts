import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Content, FunctionCall, GoogleGenAI, Part } from '@google/genai';

import { config } from '../config.js';
import { getMcpClient } from '../mcp/client.js';
import { compactToolResult } from '../mcp/compactToolResult.js';
import { injectPermissionFilters } from '../mcp/filterInjection.js';
import { DashboardContext, Permissions } from '../types.js';
import { listGeminiToolDeclarations } from './toolDeclarations.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const SYSTEM_INSTRUCTION = `당신은 Tableau 대시보드에 임베드된 데이터 분석 챗봇입니다.
사용자는 하나 이상의 권한 기준(RLS)이 적용된 상태로 질문합니다. 어떤 필드로 권한을 나누는지는
대시보드마다 다를 수 있습니다(지역, 사업부, 고객사 등). 그 필터는 백엔드가 자동으로 강제 적용하므로
당신이 별도로 신경 쓸 필요는 없습니다. 도구를 사용해 필요한 데이터를 조회한 뒤,
한국어로 간결하고 정확하게 답변하세요. 데이터에 근거하지 않은 추측은 하지 마세요.

## 데이터소스를 못 찾았을 때
list-datasources에 필요한 데이터소스가 안 보이면, 그 워크북에 **내장된(embedded)** 데이터소스일
수 있습니다 — list-workbooks 결과의 각 워크북에 있는 \`upstreamDatasources\` 필드에 그 워크북이
쓰는 데이터소스의 luid/name이 들어있으니, 여기서 찾은 luid를 datasourceLuid로 그대로
get-datasource-metadata/query-datasource에 사용하세요. list-datasources 결과에 없다고 포기하지
말고 반드시 list-workbooks도 확인하세요.

## 도구 호출 배치 규칙
서로 결과가 독립적인 조회가 여러 개 필요하면(예: 데이터소스 3개의 메타데이터를 각각 확인해야
할 때), 한 번씩 순서대로 요청하지 말고 **같은 응답 안에서 필요한 도구 호출을 한꺼번에** 요청하세요.
왕복 횟수가 늘어날수록 사용자가 기다리는 시간이 길어지니, 다음에 뭘 조회할지 이미 알고 있다면
바로 그 요청들을 전부 포함시키세요.

## 차트 첨부 규칙
답변에 여러 항목(카테고리 2개 이상, 또는 기간 2개 이상)의 수치 비교가 포함된다면, 답변 텍스트
맨 끝에 아래 형식의 코드블록을 정확히 하나만 추가하세요. 블록 안은 다른 설명 없이 유효한 JSON만
담습니다(주석, trailing comma 금지):

\`\`\`chart
{"type":"bar","title":"제목(선택)","unit":"단위 접미사(선택, 예: '원')","labels":["A","B"],"series":[{"name":"시리즈명","data":[123,456]}]}
\`\`\`

- type: 카테고리 간 크기 비교는 "bar", 시간/기간 흐름은 "line", 전체 대비 비중(3~6개 항목)은 "pie"만 사용.
  2개 항목 비교에는 "pie"를 쓰지 말고 "bar"를 쓰세요.
- labels 배열과 각 series.data 배열의 길이는 반드시 같아야 합니다.
- 같은 단위의 지표를 비교하는 게 아니라면 series를 여러 개 넣지 마세요(축이 다른 지표를 한 차트에
  섞지 마세요).
- 값이 딱 하나뿐인 답변(단일 숫자)에는 차트를 붙이지 말고 텍스트로만 답하세요.
- 차트로 표현할 데이터가 없으면 이 블록을 아예 넣지 마세요.`;

const TOOL_STATUS_LABELS: Record<string, string> = {
  'list-datasources': '데이터소스 목록을 조회하고 있어요...',
  'list-workbooks': '워크북 목록을 조회하고 있어요...',
  'list-projects': '프로젝트 목록을 조회하고 있어요...',
  'list-views': '뷰 목록을 조회하고 있어요...',
  'get-datasource-metadata': '데이터소스 필드 정보를 확인하고 있어요...',
  'query-datasource': '데이터를 조회하고 있어요...',
  'get-view-data': '뷰 데이터를 가져오고 있어요...',
};

export type OrchestratorEvent =
  | { type: 'status'; message: string }
  | { type: 'answer_chunk'; text: string };

// query-datasource 기반 경로에서 실제로 안전하게 노출할 도구. get-view-data는 일부러 뺐다 —
// injectPermissionFilters가 query-datasource만 가로채기 때문에, get-view-data가 섞여 들어오면
// RLS를 우회해서 서비스 계정이 볼 수 있는 전체 데이터를 가져올 수 있다. tableau-mcp의
// INCLUDE_TOOLS 설정과 별개로 여기서 한 번 더 좁혀서(심층 방어) 실수로 새는 걸 막는다.
const ALLOWED_TOOLS = [
  'list-datasources',
  'list-workbooks',
  'list-projects',
  'list-views',
  'get-datasource-metadata',
  'query-datasource',
] as const;

function describePermissions(permissions: Permissions): string {
  const fields = Object.keys(permissions);
  if (fields.length === 0) return '(없음)';
  return fields.map((field) => `${field}: ${permissions[field].join(', ') || '(없음)'}`).join(' / ');
}

function buildInitialPrompt(
  question: string,
  context: DashboardContext | undefined,
  permissions: Permissions,
): string {
  const lines = [
    `질문: ${question}`,
    context?.worksheetName ? `현재 워크시트: ${context.worksheetName}` : undefined,
    context?.datasourceName ? `현재 데이터소스: ${context.datasourceName}` : undefined,
    `허용된 권한 범위: ${describePermissions(permissions)}`,
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

function statusForTools(names: string[]): string {
  const unique = Array.from(new Set(names));
  const labels = unique.map((name) => TOOL_STATUS_LABELS[name] ?? `${name} 실행 중...`);
  return labels[0] ?? '조회 중...';
}

export async function answerQuestion(
  question: string,
  context: DashboardContext | undefined,
  permissions: Permissions,
  onEvent: (event: OrchestratorEvent) => void,
): Promise<string> {
  const mcpClient = await getMcpClient();
  const functionDeclarations = await listGeminiToolDeclarations(mcpClient, ALLOWED_TOOLS);

  const contents: Content[] = [
    {
      role: 'user',
      parts: [{ text: buildInitialPrompt(question, context, permissions) }],
    },
  ];

  onEvent({ type: 'status', message: '질문을 분석하고 있어요...' });

  const t0 = Date.now();
  for (let iteration = 0; iteration < config.maxToolLoops; iteration++) {
    const { parts, functionCalls, text } = await streamOneTurn(contents, functionDeclarations, onEvent);

    if (parts.length > 0) {
      contents.push({ role: 'model', parts });
    }

    if (functionCalls.length === 0) {
      console.log(`[group-rls] iterations=${iteration + 1} totalMs=${Date.now() - t0}`);
      if (!text) {
        // generateContentStream이 텍스트 파트를 하나도 안 보내준 예외적인 경우 —
        // 스트리밍으로는 아무 것도 전달되지 않았으니 폴백 메시지를 이벤트로 직접 흘려보낸다.
        const fallback = '답변을 생성하지 못했습니다.';
        onEvent({ type: 'answer_chunk', text: fallback });
        return fallback;
      }
      return text;
    }

    onEvent({ type: 'status', message: statusForTools(functionCalls.map((c) => c.name ?? '')) });

    const responseParts = await Promise.all(
      functionCalls.map((call) => executeFunctionCall(mcpClient, call, permissions)),
    );
    contents.push({ role: 'user', parts: responseParts });

    if (iteration < config.maxToolLoops - 1) {
      onEvent({ type: 'status', message: '결과를 바탕으로 답변을 작성하고 있어요...' });
    }
  }

  const maxLoopsFallback =
    '질문에 답하기 위해 너무 많은 조회가 필요했습니다. 질문을 더 구체적으로 나눠서 다시 시도해주세요.';
  onEvent({ type: 'answer_chunk', text: maxLoopsFallback });
  return maxLoopsFallback;
}

// generateContentStream으로 한 턴을 처리한다. 텍스트 파트가 도착하는 즉시 onEvent로 흘려보내서
// (주로 최종 답변 턴에서) 사용자가 완성될 때까지 기다리지 않고 바로 읽기 시작할 수 있게 한다.
// 함수 호출 파트는 스트리밍해도 의미가 없으니 모아뒀다가 한 번에 반환한다.
async function streamOneTurn(
  contents: Content[],
  functionDeclarations: Awaited<ReturnType<typeof listGeminiToolDeclarations>>,
  onEvent: (event: OrchestratorEvent) => void,
): Promise<{ parts: Part[]; functionCalls: FunctionCall[]; text: string }> {
  const stream = await ai.models.generateContentStream({
    model: config.geminiModel,
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations }],
    },
  });

  const parts: Part[] = [];
  const functionCalls: FunctionCall[] = [];
  let text = '';

  for await (const chunk of stream) {
    const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of chunkParts) {
      parts.push(part);
      if (part.text) {
        text += part.text;
        onEvent({ type: 'answer_chunk', text: part.text });
      }
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }
  }

  return { parts, functionCalls, text };
}

async function executeFunctionCall(
  mcpClient: Client,
  call: FunctionCall,
  permissions: Permissions,
): Promise<{
  functionResponse: { id?: string; name: string; response: Record<string, unknown> };
}> {
  const name = call.name ?? '';
  try {
    const args = injectPermissionFilters(name, call.args ?? {}, permissions);
    const result = await mcpClient.callTool({ name, arguments: args });
    return {
      functionResponse: {
        id: call.id,
        name,
        response: { output: compactToolResult(name, result.content) },
      },
    };
  } catch (error) {
    return {
      functionResponse: {
        id: call.id,
        name,
        response: { error: error instanceof Error ? error.message : String(error) },
      },
    };
  }
}
