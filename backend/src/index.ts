import cors from 'cors';
import express from 'express';

import { config } from './config.js';
import { groupRlsRouter } from './routes/groupRls.js';

const app = express();

app.use(cors({ origin: config.extensionOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/query/group-rls', groupRlsRouter);

app.listen(config.port, () => {
  console.log(`백엔드 서버가 http://localhost:${config.port} 에서 실행 중입니다.`);
});
