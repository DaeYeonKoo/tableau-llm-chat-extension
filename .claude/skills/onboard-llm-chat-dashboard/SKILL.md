---
name: onboard-llm-chat-dashboard
description: Use when adding the LLM chat extension to a new Tableau dashboard/datasource, when a new team wants to reuse this system, or when troubleshooting why an existing setup stopped working (field mismatch, connection refused, stale MCP connection). Covers the one-time prerequisites, the per-dashboard checklist, and known failure modes with fixes.
---

# LLM 챗봇 Extension을 새 대시보드에 연결하기

## 개요

이 저장소(`extension/`, `backend/`, `tableau-mcp/`)는 **하나의 배포로 같은 Tableau Server/사이트
안의 모든 대시보드를 서빙할 수 있는 범용 제품**입니다. 데이터소스명, RLS 필드명, 워크북명 등
어떤 것도 코드에 하드코딩되어 있지 않습니다 — Gemini가 `list-datasources`/`get-datasource-metadata`로
스키마를 그때그때 탐색하고, 권한 필터는 대시보드의 "AllowedRegions" 워크시트에서 매 요청마다
동적으로 읽어옵니다.

**핵심 원칙: 새 대시보드를 붙일 때 backend/tableau-mcp 코드나 .env를 건드릴 필요가 없습니다.**
같은 Tableau Server 안이라면 대시보드 쪽 설정(아래 체크리스트)만으로 끝나야 합니다. 코드를
고쳐야만 되는 상황이 생겼다면, 그건 이 스킬이 놓친 새로운 일반화 지점이니 SKILL.md를
업데이트하세요.

## 언제 이 스킬을 쓰나

- 새 대시보드/새 데이터소스에 이 챗봇을 붙여달라는 요청을 받았을 때
- "다른 데이터소스에서도 똑같이 되나?" 같은 재사용성 질문을 받았을 때
- 기존에 잘 되던 게 갑자기 안 될 때 (아래 "자주 겪는 문제" 참고)

## 한 배포로 여러 대시보드를 서빙하는 원리

`extension/`, `backend/`, `tableau-mcp/` 세 서버는 **딱 한 번만 띄워두면** 됩니다. 이유:

- Extension(`app.js`)은 `tableau.extensions.initializeAsync()`로 매번 "지금 열려있는" 대시보드를
  런타임에 읽습니다. 어떤 워크북에 심어도 같은 정적 파일이 그대로 동작합니다.
- 백엔드는 질문마다 Gemini에게 도구 탐색을 시키지, 특정 데이터소스를 코드에 미리 알고 있지 않습니다.
- 권한 필터 필드명/값은 요청 바디의 `permissions` 객체로 매번 동적으로 옵니다(백엔드 `.env`에는
  더 이상 필드명을 안 씀).

**단, tableau-mcp 하나는 `SERVER`+`SITE_NAME`+`PAT` 하나에 고정됩니다.** 새 대시보드가:
- **같은 Tableau Server, 같은 사이트**에 있다면 → 지금 떠있는 tableau-mcp/backend를 그대로 재사용.
- **다른 Tableau Server 또는 다른 사이트**에 있다면 → tableau-mcp를 하나 더 띄우거나(포트 다르게),
  기존 `.env`의 `SERVER`/`SITE_NAME`/`PAT_*`를 바꿔야 함(이 경우 기존 대시보드는 못 씀).

## 사전 준비물 (환경당 한 번만)

- [ ] Tableau Server **2025.1 이상** (VizQL Data Service 요구사항 — 우측 상단 `?` → "Tableau Server 정보"에서 버전 확인)
- [ ] 서비스 계정의 **PAT**(Personal Access Token) — 계정 설정 > Personal Access Tokens
- [ ] `DANGEROUSLY_DISABLE_OAUTH=true`로 HTTP 모드 (고정 서비스 계정 하나만 쓰는 내부용 구조라 안전 — 3927 포트는 외부 노출 금지)
- [ ] Gemini API 키 ([Google AI Studio](https://aistudio.google.com/apikey))
- [ ] `tableau-mcp/.env`의 `INCLUDE_TOOLS`에 **`get-view-data`가 없는지 확인** — 이 도구는 우리 RLS
      강제 필터를 우회할 수 있음(datasourceLuid 없이 뷰 데이터를 그대로 반환하고,
      `injectPermissionFilters`는 `query-datasource`만 가로채기 때문). `backend/src/gemini/orchestrator.ts`의
      `ALLOWED_TOOLS`가 이걸 코드 레벨에서도 한 번 더 막아두긴 하지만, tableau-mcp 쪽에서도
      기본값으로 빼두는 게 안전(심층 방어).

## 워크북에 내장(embedded)된 데이터소스도 지원됩니다

처음엔 "게시된(published) 데이터소스만 된다"고 생각했는데, 실제로는 **`list-workbooks` 응답의
각 워크북에 `upstreamDatasources: [{luid, name}]` 필드가 있고, 여기서 찾은 luid를 그대로
`get-datasource-metadata`/`query-datasource`의 `datasourceLuid`로 쓸 수 있습니다.** 즉 워크북에
패키징된 내장 데이터소스도 별도 게시 없이 완전히 동일하게 작동합니다(RLS 강제 필터 포함) —
`backend/src/gemini/orchestrator.ts`의 시스템 프롬프트에 "list-datasources에 없으면
list-workbooks의 upstreamDatasources를 확인하라"는 지침이 이미 들어있어서, Gemini가 알아서
찾습니다.

- **증상(원인 파악 전)**: `list-datasources` 결과에 해당 워크북의 데이터소스가 안 보여서 데이터를
  못 찾는 것처럼 보임 — 이건 버그가 아니라 애초에 `list-datasources`는 내장 데이터소스를 안 보여줌.
  `list-workbooks`를 대신 확인하면 됨.
- 검증 방법: `list-workbooks`로 워크북을 찾아 `upstreamDatasources[].luid`를 얻은 뒤, 그 luid로
  `get-datasource-metadata`를 직접 호출해서 필드 목록이 나오는지 확인.
- `get-view-data`(워크북의 특정 뷰가 "현재 보여주는 그대로"의 데이터를 반환)로 우회하는 방법도
  검토했었지만, 이제 필요 없음 — 자유로운 쿼리(query-datasource)가 그대로 되고 RLS도 그대로
  강제되므로 이쪽이 훨씬 낫습니다. `get-view-data`는 화이트리스트에서 계속 빼두세요.

### ⚠️ 예외: 라이브로 연결된 순수 .hyper 파일은 지원 안 함 (정책적으로 범위 제외)

내장 데이터소스가 다 되는 건 아닙니다 — **연결 방식(connectionType)에 따라 Tableau의 콘텐츠
카탈로그(Metadata API)에 아예 등록이 안 되는 경우가 있고, 이 경우 REST API/VDS 어떤 경로로도
도달할 방법이 없습니다.** `search-content`로 직접 검증해본 결과:

- 정상 작동하는 임베디드 데이터소스는 `connectionType: "excel-direct"`처럼 카탈로그에
  `isConnectable: true`로 잡힘.
- **라이브로 연결된 순수 `.hyper` 파일**은 워크북/뷰는 검색에 잡히지만 데이터소스 자체가 카탈로그
  검색 결과에 전혀 안 나타남 — `list-workbooks`의 `upstreamDatasources`, `get-workbook`,
  `search-content` 전부 확인해봤지만 방법이 없었음.
- 다른 임베디드 데이터소스 중에도 `connectionType: "sqlproxy"`이면서 `isConnectable: false`인
  사본들이 있었음 — 같은 데이터소스라도 프록시/참조용 사본은 조회 불가능하고, 진짜 연결
  가능한 사본만 `isConnectable: true`로 잡힘.

**현재 정책: 이런 케이스는 지원 범위에서 제외한다.** 데이터소스를 라이브 `.hyper` 파일 직접
연결 대신 **추출(Extract)로 전환하거나 카탈로그에 정상 등록되는 연결 방식으로 재게시**하도록
안내하세요. (원한다면 나중에 다른 방법을 더 찾아볼 수도 있지만, 지금은 작업량 대비 효용이
낮다고 판단해 보류함.)

새 대시보드를 붙이기 전에 **워크북의 모든 데이터소스가 `search-content`(filter:
`{contentTypes:['datasource']}`)로 검색됐을 때 `isConnectable: true`로 나오는지 먼저 확인**하는
걸 체크리스트에 추가하는 게 안전합니다.

## 새 대시보드 붙이기 체크리스트

1. **AllowedRegions 워크시트 만들기** (대시보드 안, 숨김 처리)
   - 이름은 정확히 `AllowedRegions` (대소문자까지 일치) — `extension/public/app.js`의
     `ALLOWED_REGIONS_WORKSHEET_NAME` 상수와 매칭됨
   - 권한 기준마다 컬럼 하나씩 (예: 지역 하나면 1컬럼, 지역+사업부 둘 다면 2컬럼)
   - RLS(예: `ISMEMBEROF()`)가 이미 걸려서, 로그인한 사용자가 실제로 접근 가능한 값만 내려오게 함
   - **컬럼명이 곧 실제 데이터소스의 필드명(fieldCaption)과 정확히 일치해야 함** — 안 그러면
     "알 수 없는 필드" 에러 (아래 트러블슈팅 참고)
   - 이 워크시트를 대시보드 캔버스에 올려야 함(0 크기나 다른 오브젝트 뒤에 숨겨도 됨) — 워크북에만
     존재하고 이 대시보드에 안 올라가 있으면 Extension이 못 찾음
2. **서비스 계정 권한 확인**: 대상 데이터소스에 서비스 계정(또는 소속 그룹)의 **API Access + Full
   Data Query/Connect** 권한이 있는지 (데이터소스 우클릭 → Permissions)
3. **Extension을 대시보드에 추가**: Extension 개체 드래그 → 내 Extensions → `extension/manifest.trex`
   선택 (지금은 Vercel 배포 주소가 이미 들어있음 — 배포 주소가 바뀌면 이 파일의
   `source-location`도 같이 갱신해야 함)
4. **테스트**: 챗봇 상태 표시줄에 "권한 범위: <필드명>(<개수>), ..."가 뜨는지 확인 → 실제 데이터
   질문을 던져서 허용 범위 밖 데이터가 안 나오는지 확인

## 검증 방법 (배포 없이 백엔드만으로)

```bash
curl -s -N -X POST http://localhost:8766/query/group-rls \
  -H "Content-Type: application/json" \
  -d '{"question":"<질문>","permissions":{"<필드명>":["<값1>","<값2>"]}}'
```
NDJSON 스트림(`status`/`answer_chunk`/`done`)이 정상적으로 오면 백엔드는 문제 없음 — Extension
쪽 이슈인지 백엔드 쪽 이슈인지 빠르게 구분할 수 있음.

## 자주 겪는 문제

### "알 수 없는 필드: X" / 답변이 12회 반복 끝에 실패

AllowedRegions 워크시트의 컬럼명이 실제 데이터소스 필드명과 다름. 데이터소스에 실제로 존재하는
필드 caption을 `get-datasource-metadata`로 확인해서 워크시트 컬럼명을 맞추세요. (한글/영문 필드명
혼용 시 특히 자주 남 — 예: 워크시트 컬럼은 "지역"인데 데이터소스 필드는 "Region")

## 배포 구조 (2026-08-21부터)

- **Extension**: Vercel에 정적 배포됨 (`extension/public` 폴더만, HTTPS 확보). 다시 배포하려면
  `cd extension/public && npx vercel --prod --yes`. 배포 후 `extension/manifest.trex`의
  `source-location` URL이 실제 배포 주소와 일치하는지 확인.
- **백엔드 + tableau-mcp**: 이 PC에서 `pm2`로 상시 구동 (`ecosystem.config.js`). Windows 로그인 시
  자동으로 `pm2 resurrect`가 실행되도록 `pm2-windows-startup`이 레지스트리 Run 키에 등록되어 있음
  — 단, PC가 로그인 화면에 멈춰있는 동안은(아무도 로그인 안 하면) 안 뜸. 완전 무인 기동이 필요하면
  Windows 자동 로그인 설정을 추가해야 함.

### Extension 화면에 "localhost에서 연결을 거부했습니다"

Vercel에 배포된 걸 쓰는 중이면 이 에러는 안 남(HTTPS 고정 주소라서). 아직 로컬(`localhost:8765`)로
테스트하는 중이면 `extension/` 서버가 안 떠있는 것 — `cd extension && npm start`.

### 백엔드/tableau-mcp가 죽었거나 응답이 없음

`pm2 status`로 상태 확인. `pm2 restart backend` / `pm2 restart tableau-mcp` / `pm2 logs`로 로그 확인.
둘 다 통째로 다시 올리려면 `pm2 restart all`.

### 백엔드가 "답변을 생성하는 중 오류가 발생했습니다"만 반환

십중팔구 tableau-mcp를 재시작했는데 백엔드는 그대로 둔 경우. 백엔드는 tableau-mcp와의 MCP
연결을 프로세스 시작 시 한 번만 맺고 계속 재사용하기 때문에, **tableau-mcp를 재시작했다면
백엔드도 반드시 같이 재시작**해야 함 (`pm2 restart tableau-mcp backend` 한 번에).

### `.env`를 고쳤는데 반영이 안 됨

pm2로 띄운 프로세스는 `.env` 변경을 자동으로 감지하지 않음. `.env`를 고친 뒤엔 항상
`pm2 restart <이름>`으로 수동 재시작해야 함. (예전 방식인 `Get-NetTCPConnection -LocalPort <port>`로
프로세스 찾아서 `Stop-Process`하는 방법은 pm2 도입 후엔 안 씀 — pm2가 바로 다시 살려버림.)

### 검증 curl에 한글 필드명/값을 넣었더니 "알 수 없는 필드: ." 같은 이상한 에러

`curl -d '{"permissions":{"지역":[...]}}'`처럼 한글을 셸에 인라인으로 넘기면 환경에 따라 인코딩이
깨져서 필드명이 빈 문자열로 들어갈 수 있음(실제로 한 번 겪음 — 코드 버그인 줄 알았는데 아니었음).
한글이 섞인 페이로드는 UTF-8로 저장한 JSON 파일을 만들어서 `curl --data-binary "@payload.json"`으로
보내면 안전함.

### Gemini가 여러 조회를 하나씩 순서대로 해서 느림

`backend/src/gemini/orchestrator.ts`의 시스템 프롬프트에 "도구 호출 배치 규칙"이 이미 들어있음.
그래도 재발하면(모델 비결정성) 프롬프트를 더 구체적으로 강화하거나, 특정 질문 패턴을 예시로
추가하는 걸 고려.

## 알려진 한계 (아직 일반화 안 된 부분)

- **tableau-mcp 하나당 Tableau Server 하나**: 완전히 다른 서버의 대시보드를 붙이려면 별도 배포 필요.
- **PAT 기반 인증은 다중 동시 사용자에 취약**함 (tableau-mcp 공식 문서 경고). 전사 단위로 동시
  사용자가 많아지면 사용자별 OAuth 전환을 검토해야 함 — 이 경우 Tableau 네이티브 RLS가 자동
  적용되므로 AllowedRegions 워크시트 트릭 자체가 불필요해짐. 규모가 커지기 전에 별도로 설계할 것.
- **RLS 값이 명단(discrete set)인 경우만 지원**: SET 필터만 강제 주입함. 범위/날짜 기반 권한
  (QUANTITATIVE_NUMERICAL, DATE 필터 등)은 아직 지원 안 함 — 필요해지면
  `backend/src/mcp/filterInjection.ts`를 확장해야 함.
