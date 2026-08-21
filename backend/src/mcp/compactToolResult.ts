// tableau-mcp 도구 결과를 Gemini에게 돌려주기 전에 불필요한 필드를 잘라낸다.
// 실측 결과, 매 반복마다 이전 도구 결과 전체가 대화 컨텍스트에 계속 쌓이기 때문에
// (특히 get-datasource-metadata의 장황한 필드 메타데이터) 마지막 답변 생성 호출이
// 컨텍스트 크기에 비례해 크게 느려진다. 이 파일은 그 컨텍스트 크기를 줄이는 역할만 한다 —
// 실제 Tableau 응답 자체를 건드리지 않고, Gemini에게 넘기는 사본만 축소한다.

const MAX_QUERY_ROWS = 100;
const MAX_LIST_ITEMS = 50;

interface ContentItem {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export function compactToolResult(toolName: string, content: unknown): unknown {
  if (!Array.isArray(content)) return content;

  return (content as ContentItem[]).map((item) => {
    if (!item || item.type !== 'text' || typeof item.text !== 'string') return item;

    let parsed: unknown;
    try {
      parsed = JSON.parse(item.text);
    } catch {
      return item;
    }

    const compacted = compactByToolName(toolName, parsed);
    return { ...item, text: JSON.stringify(compacted) };
  });
}

function compactByToolName(toolName: string, data: unknown): unknown {
  switch (toolName) {
    case 'get-datasource-metadata':
      return compactDatasourceMetadata(data);
    case 'list-workbooks':
      return compactWorkbookList(data);
    case 'list-datasources':
    case 'list-projects':
    case 'list-views':
      return compactList(data);
    case 'query-datasource':
      return compactQueryResult(data);
    default:
      return data;
  }
}

function compactDatasourceMetadata(data: unknown): unknown {
  const d = data as {
    datasourceModel?: { logicalTables?: { logicalTableId: string; caption: string }[] };
    fieldGroups?: { logicalTableId: string; fields: Record<string, unknown>[] }[];
  };
  if (!d?.fieldGroups) return data;

  const tableNameById = new Map(
    (d.datasourceModel?.logicalTables ?? []).map((t) => [t.logicalTableId, t.caption]),
  );

  const fields = d.fieldGroups.flatMap((group) =>
    group.fields.map((f) => ({
      table: tableNameById.get(group.logicalTableId) ?? group.logicalTableId,
      name: f.name,
      dataType: f.dataType,
      role: f.role,
      ...(f.defaultAggregation ? { defaultAggregation: f.defaultAggregation } : {}),
    })),
  );

  return { fields };
}

// list-workbooks는 일반 목록 압축과 별도로 처리한다: upstreamDatasources를 보존해야
// 워크북에 "내장된" 데이터소스(list-datasources에는 안 잡히는 것들)의 LUID를 Gemini가
// 찾을 수 있다. 이게 없으면 게시되지 않은 데이터소스는 영영 조회할 방법이 없어진다.
function compactWorkbookList(data: unknown): unknown {
  const d = data as { data?: Record<string, unknown>[] };
  if (!Array.isArray(d?.data)) return data;

  const truncated = d.data.length > MAX_LIST_ITEMS;
  const items = d.data.slice(0, MAX_LIST_ITEMS).map((item) => ({
    id: item.id,
    name: item.name,
    project: (item.project as { name?: string } | undefined)?.name,
    upstreamDatasources: Array.isArray(item.upstreamDatasources)
      ? (item.upstreamDatasources as { luid?: string; name?: string }[]).map((ds) => ({
          luid: ds.luid,
          name: ds.name,
        }))
      : undefined,
  }));

  return truncated
    ? { data: items, note: `총 ${d.data!.length}개 중 ${MAX_LIST_ITEMS}개만 표시됨` }
    : { data: items };
}

function compactList(data: unknown): unknown {
  const d = data as { data?: Record<string, unknown>[] };
  if (!Array.isArray(d?.data)) return data;

  const truncated = d.data.length > MAX_LIST_ITEMS;
  const items = d.data.slice(0, MAX_LIST_ITEMS).map((item) => ({
    id: item.id,
    name: item.name,
    project: (item.project as { name?: string } | undefined)?.name,
  }));

  return truncated
    ? { data: items, note: `총 ${d.data!.length}개 중 ${MAX_LIST_ITEMS}개만 표시됨` }
    : { data: items };
}

function compactQueryResult(data: unknown): unknown {
  const d = data as { data?: Record<string, unknown>[] };
  if (!Array.isArray(d?.data) || d.data.length <= MAX_QUERY_ROWS) return data;

  return {
    data: d.data.slice(0, MAX_QUERY_ROWS),
    note: `총 ${d.data.length}행 중 상위 ${MAX_QUERY_ROWS}행만 표시됨. 전체 합계 등이 필요하면 쿼리에 집계 함수를 사용하세요.`,
  };
}
