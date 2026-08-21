# Tableau LLM 챗봇 Extension

Tableau 대시보드에 임베드되는 LLM 챗봇. 구조와 흐름은 [개요.MD](개요.MD) 참고.
**새 대시보드에 연결하는 방법은 [`.claude/skills/onboard-llm-chat-dashboard/SKILL.md`](.claude/skills/onboard-llm-chat-dashboard/SKILL.md) 참고** —
이 시스템은 한 배포로 같은 Tableau Server의 여러 대시보드/데이터소스를 서빙하도록 설계되어 있음.

## 구성

```
extension/     Extension 서버 (8765) — 정적 파일 서빙만, 로직 없음(브라우저에서 실행되는 app.js가 로직)
backend/       백엔드 서버 (8766) — Gemini ↔ tableau-mcp 오케스트레이션, 필터 강제 주입
tableau-mcp/   Tableau 공식 오픈소스 MCP 서버 (3927) — Tableau Server와 실제 통신
```

## 사전 준비물 (환경당 한 번만)

- [ ] Tableau Server **2025.1 이상** (VizQL Data Service 요구사항)
- [ ] Tableau Server 서비스 계정의 **PAT(Personal Access Token)** 발급
- [ ] Tableau Server 주소(`SERVER`), 사이트명(`SITE_NAME`) 확인
- [ ] **Gemini API 키** 발급 ([Google AI Studio](https://aistudio.google.com/apikey))
- [ ] 대상 데이터소스에 서비스 계정의 **API Access** 권한 부여 (관리자 문의)

대시보드/데이터소스별로 필요한 건 `.claude/skills/onboard-llm-chat-dashboard/SKILL.md`의
체크리스트뿐 — 여기 세 서버는 그대로 재사용.

## 로컬 실행 순서

### 1) tableau-mcp (HTTP 서버, 포트 3927)

```
cd tableau-mcp
tableau-mcp/SETUP-ENV.md 참고해서 .env 파일 생성 (SERVER, SITE_NAME, PAT_NAME, PAT_VALUE 채우기)
npm install   # (완료됨)
npm run build # (완료됨, 코드 수정 시 재실행)
npm run start:http
```

### 2) 백엔드 (포트 8766)

```
cd backend
backend/SETUP-ENV.md 참고해서 .env 파일 생성 (GEMINI_API_KEY 채우기)
npm install   # (완료됨)
npm run dev
```

### 3) Extension 서버 (포트 8765)

```
cd extension
npm install   # (완료됨)
npm start
```

`.env`를 고쳤을 때나 tableau-mcp를 재시작했을 때는 **백엔드도 같이 재시작**해야 함
(tsx watch가 `.env` 변경을 감지 못 하고, 백엔드는 tableau-mcp와의 MCP 연결을 캐싱하기 때문).

### 4) Tableau에 Extension 추가

새 대시보드에 처음 연결할 때는 `.claude/skills/onboard-llm-chat-dashboard/SKILL.md`의 체크리스트를
따라가세요 (AllowedRegions 워크시트 만들기, manifest.trex 추가 등).

## 아직 다루지 않은 것 (다음 단계)

- **전사 확장 시 PAT vs OAuth 결정** — PAT 기반 인증은 다중 동시 사용자에 취약하다고 tableau-mcp
  공식 문서가 경고함. 규모가 커지기 전에 별도로 설계 필요 (SKILL.md "알려진 한계" 참고)
- SET 필터 외 범위/날짜 기반 RLS(QUANTITATIVE_NUMERICAL, DATE) 지원
- HTTPS / 사내 배포 시 Extension 신뢰 설정
- 도구 화이트리스트가 실제로 안전한지 재검토 (`tableau-mcp/.env`의 `INCLUDE_TOOLS`)
