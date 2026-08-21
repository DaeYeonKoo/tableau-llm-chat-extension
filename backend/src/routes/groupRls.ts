import { Router } from 'express';

import { answerQuestion, OrchestratorEvent } from '../gemini/orchestrator.js';
import { GroupRlsRequest } from '../types.js';

export const groupRlsRouter = Router();

function isValidRequest(body: unknown): body is GroupRlsRequest {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.question !== 'string' || b.question.trim().length === 0) return false;
  if (typeof b.permissions !== 'object' || b.permissions === null || Array.isArray(b.permissions)) {
    return false;
  }
  return Object.values(b.permissions).every(
    (values) => Array.isArray(values) && values.every((v) => typeof v === 'string'),
  );
}

// 응답 전체를 한 번에 만들어서 돌려주는 대신, 줄바꿈으로 구분된 JSON 이벤트를 스트리밍한다
// (status: 진행 상황, answer_chunk: 답변 텍스트 조각, error/done: 종료).
// 브라우저는 이걸 fetch()의 ReadableStream으로 그대로 읽으면 된다 — SSE 프레이밍이 필요 없는
// 가장 단순한 스트리밍 방식이라 골랐다.
groupRlsRouter.post('/', async (req, res) => {
  if (!isValidRequest(req.body)) {
    res.status(400).json({ error: 'question(string)과 permissions(Record<string, string[]>)는 필수입니다.' });
    return;
  }

  const { question, context, permissions } = req.body;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event: OrchestratorEvent | { type: 'error' | 'done'; message?: string }): void => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    await answerQuestion(question, context, permissions, send);
    send({ type: 'done' });
  } catch (error) {
    console.error('[group-rls] 처리 중 오류:', error);
    send({ type: 'error', message: '답변을 생성하는 중 오류가 발생했습니다.' });
  } finally {
    res.end();
  }
});
