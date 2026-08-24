// pm2로 백엔드 + tableau-mcp를 관리한다 (Extension은 Vercel에 있어서 여기 없음).
// 사용법:
//   pm2 start ecosystem.config.js   # 시작
//   pm2 save                        # 지금 목록을 저장 (재부팅 후 복원용)
//   pm2 status / pm2 logs           # 상태/로그 확인
//   pm2 restart tableau-mcp         # .env 고친 뒤 재시작 (tableau-mcp만)
//   pm2 restart backend             # .env 고친 뒤 재시작 (backend만) — tableau-mcp 재시작했으면 이것도 같이!
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'tableau-mcp',
      cwd: path.join(__dirname, 'tableau-mcp'),
      script: 'node',
      args: 'build/index.js',
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: 'backend',
      cwd: path.join(__dirname, 'backend'),
      script: 'node',
      args: 'dist/index.js',
      autorestart: true,
      max_restarts: 20,
    },
  ],
};
