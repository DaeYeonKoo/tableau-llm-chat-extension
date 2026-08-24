# 백엔드 환경변수 설정

이 폴더 안에 `.env` 파일을 직접 만들고(git에 커밋되지 않음) 아래 내용을 채워 넣으세요.

```
PORT=8766

# Google AI Studio에서 발급받은 Gemini API 키
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash

# tableau-mcp HTTP 서버 엔드포인트 (기본값 그대로면 생략 가능)
TABLEAU_MCP_URL=http://127.0.0.1:3927/tableau-mcp

# 권한 필터 필드명은 더 이상 여기서 설정하지 않습니다 — Extension이 AllowedRegions
# 워크시트의 컬럼명을 그대로 요청에 실어 보내므로, 대시보드마다 다른 필드명(지역/사업부/
# 고객사 등)을 코드/설정 변경 없이 그대로 지원합니다.

# Gemini <-> tableau-mcp 왕복 최대 횟수
MAX_TOOL_LOOPS=12

# Extension이 서빙되는 origin (CORS 허용 목록) — 콤마로 여러 개 등록 가능
# 로컬 테스트용 localhost와 Vercel에 올린 프로덕션 URL을 동시에 넣어두면 편함
EXTENSION_ORIGINS=http://localhost:8765,https://public-xi-jade.vercel.app
```
