export interface DashboardContext {
  worksheetName?: string;
  datasourceName?: string;
}

// 권한 기준 필드명 -> 그 사용자에게 허용된 값 목록. AllowedRegions 워크시트의 컬럼마다 하나씩 생긴다.
// 예: { "지역": ["서울", "경기"], "사업부": ["리테일"] }
export type Permissions = Record<string, string[]>;

export interface GroupRlsRequest {
  question: string;
  context?: DashboardContext;
  permissions: Permissions;
}

export interface GroupRlsResponse {
  answer: string;
}
