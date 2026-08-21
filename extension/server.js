import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// 로직 없음: public/ 아래 정적 파일(HTML/JS/CSS + Tableau Extensions API 라이브러리)만 서빙한다.
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT ?? 8765;
app.listen(PORT, () => {
  console.log(`Extension 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
