import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { config } from '../config.js';

let clientPromise: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(config.tableauMcpUrl));
  const client = new Client({ name: 'llm-chat-backend', version: '0.1.0' });
  await client.connect(transport);
  return client;
}

// tableau-mcp에 대한 연결을 프로세스 생애주기 동안 하나만 유지하고 재사용한다.
// 연결이 끊기면(예: tableau-mcp 재시작) 다음 호출에서 자동으로 재연결을 시도한다.
export async function getMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}
