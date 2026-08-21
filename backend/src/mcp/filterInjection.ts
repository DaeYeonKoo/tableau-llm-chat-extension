import { Permissions } from '../types.js';

interface SetFilter {
  field: { fieldCaption: string };
  filterType: 'SET';
  values: string[];
  exclude?: boolean;
}

/**
 * query-datasource 호출의 query.filters에 permissions의 각 필드마다 SET 필터를 강제로 끼워 넣는다.
 * 같은 필드에 대해 Gemini가 이미 필터를 넣었더라도 무조건 덮어써서, LLM이 필터를 빼거나
 * 바꿔서 허용 범위 밖의 데이터를 요청할 수 없게 한다. query-datasource가 아닌 도구는 그대로 통과.
 * 필드명은 대시보드마다 다를 수 있어(지역/사업부/고객사 등) 특정 필드명을 코드에 고정하지 않고,
 * 요청마다 permissions로 넘어온 필드명을 그대로 사용한다.
 */
export function injectPermissionFilters(
  toolName: string,
  args: Record<string, unknown>,
  permissions: Permissions,
): Record<string, unknown> {
  if (toolName !== 'query-datasource') {
    return args;
  }

  const permissionFields = Object.keys(permissions);
  if (permissionFields.length === 0) {
    return args;
  }

  const query = (args.query as Record<string, unknown> | undefined) ?? {};
  const existingFilters = Array.isArray(query.filters)
    ? (query.filters as Record<string, unknown>[])
    : [];

  const otherFilters = existingFilters.filter((filter) => {
    const field = filter.field as { fieldCaption?: string } | undefined;
    return !field?.fieldCaption || !permissionFields.includes(field.fieldCaption);
  });

  const forcedFilters: SetFilter[] = permissionFields.map((fieldCaption) => ({
    field: { fieldCaption },
    filterType: 'SET',
    values: permissions[fieldCaption],
    exclude: false,
  }));

  return {
    ...args,
    query: {
      ...query,
      filters: [...otherFilters, ...forcedFilters],
    },
  };
}
