import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. backend/SETUP-ENV.md 참고해서 .env 파일을 만들어주세요.`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8766),
  geminiApiKey: required('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
  tableauMcpUrl: process.env.TABLEAU_MCP_URL ?? 'http://127.0.0.1:3927/tableau-mcp',
  maxToolLoops: Number(process.env.MAX_TOOL_LOOPS ?? 12),
  // 콤마로 여러 origin을 등록할 수 있음 (로컬 개발용 localhost + Vercel에 올린 배포본 등 동시 허용)
  extensionOrigins: (process.env.EXTENSION_ORIGINS ?? 'http://localhost:8765')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};
