// 로직 없음(정적 파일 서버)이라던 Extension 서버 설명과 달리, 이 파일은 브라우저에서 실행되는
// Extension 자체의 로직이다: 대시보드 컨텍스트/AllowedRegions 수집, 채팅 UI, 백엔드 호출.

const BACKEND_URL = 'http://localhost:8766/query/group-rls';
const ALLOWED_REGIONS_WORKSHEET_NAME = 'AllowedRegions';

const statusPillEl = document.getElementById('status-pill');
const statusTextEl = document.getElementById('status-text');
const messagesEl = document.getElementById('messages');
const emptyStateEl = document.getElementById('empty-state');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const sendEl = document.getElementById('chat-send');

let dashboardContext = {};
let permissions = {}; // { 필드명: 허용된 값 목록 } — AllowedRegions 워크시트 컬럼마다 하나씩

function setStatus(text, state) {
  statusTextEl.textContent = text;
  statusPillEl.className = `status-pill status-pill--${state}`;
}

const AVATAR_LABEL = { user: '나', assistant: '✦', error: '!' };

// 답변 중 ```chart{...}``` 펜스 블록만 따로 뽑아내고 나머지는 일반 텍스트로 취급한다.
function splitChartBlocks(text) {
  const regex = /```chart\s*\n([\s\S]*?)```/g;
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    try {
      segments.push({ type: 'chart', data: JSON.parse(match[1]), raw: match[0] });
    } catch (error) {
      segments.push({ type: 'chart', data: null, raw: match[0] });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }
  return segments;
}

// 스트리밍 도중엔 아직 안 닫힌 ``` 펜스가 있을 수 있어서, 그 부분만 잘라내고 보여준다.
// (펜스가 닫히는 순간 다음 렌더에서 자연스럽게 나타남 — 원본 데이터를 버리는 게 아니라 화면 표시만 지연)
function hideUnclosedFence(text) {
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    return text.slice(0, text.lastIndexOf('```'));
  }
  return text;
}

// 마크다운을 안전하게 HTML로 변환한다: 원문을 먼저 escape한 뒤 제한된 패턴만 태그로 치환하므로,
// LLM 응답에 <script> 같은 원시 HTML/JS가 섞여 있어도 절대 실행되지 않는다.
function renderMarkdownSafely(markdown) {
  const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  let html = String(markdown).replace(/[&<>"']/g, (ch) => escapeMap[ch]);

  html = html.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  const paragraphs = html
    .split(/\n{2,}/)
    .map((block) => (block.startsWith('<pre>') ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`));
  return paragraphs.join('');
}

// 텍스트(+차트 블록)를 bubble 안에 실제로 그려 넣는다. appendMessage와 스트리밍 마무리 단계가
// 공유하는 렌더링 경로 — 사용자/에러 메시지는 차트가 없을 뿐 같은 경로를 타도 무해하다.
function renderMessageContent(bubble, text) {
  bubble.replaceChildren();
  let hasChart = false;
  for (const segment of splitChartBlocks(text)) {
    if (segment.type === 'chart') {
      const chartNode = segment.data && window.renderDataChart ? window.renderDataChart(segment.data) : null;
      if (chartNode) {
        bubble.appendChild(chartNode);
        hasChart = true;
        continue;
      }
      const fallback = document.createElement('div');
      fallback.innerHTML = renderMarkdownSafely(segment.raw);
      bubble.appendChild(fallback);
    } else if (segment.text.trim()) {
      const textNode = document.createElement('div');
      textNode.innerHTML = renderMarkdownSafely(segment.text);
      bubble.appendChild(textNode);
    }
  }
  bubble.classList.toggle('has-chart', hasChart);
}

function appendMessage(role, text) {
  emptyStateEl.style.display = 'none';

  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.textContent = AVATAR_LABEL[role] ?? '';

  const bubble = document.createElement('div');
  bubble.className = `message ${role}`;
  renderMessageContent(bubble, text);

  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

// 응답이 오는 동안 진행 상황(status)과 답변 텍스트(chunk)를 실시간으로 보여주는 말풍선.
function createLiveAssistantMessage() {
  emptyStateEl.style.display = 'none';

  const row = document.createElement('div');
  row.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'avatar assistant';
  avatar.textContent = '✦';

  const bubble = document.createElement('div');
  bubble.className = 'message assistant';

  const statusLine = document.createElement('div');
  statusLine.className = 'live-status';
  statusLine.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  bubble.appendChild(statusLine);

  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  let hasText = false;

  return {
    setStatus(message) {
      if (hasText) return; // 텍스트가 이미 흐르기 시작했으면 상태 문구는 그만 갱신(텍스트 자체가 진행 표시)
      statusLine.innerHTML = `<span class="typing"><span></span><span></span><span></span></span><span>${escapeText(message)}</span>`;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
    setChunkText(fullText) {
      hasText = true;
      const bubbleText = document.createElement('div');
      bubbleText.innerHTML = renderMarkdownSafely(hideUnclosedFence(fullText));
      bubble.replaceChildren(bubbleText);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
    finalize(fullText) {
      renderMessageContent(bubble, fullText || '답변을 생성하지 못했습니다.');
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
    remove() {
      row.remove();
    },
  };
}

function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function collectDashboardContext() {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  const worksheets = dashboard.worksheets.filter((ws) => ws.name !== ALLOWED_REGIONS_WORKSHEET_NAME);

  const context = {};
  if (worksheets.length > 0) {
    context.worksheetName = worksheets.map((ws) => ws.name).join(', ');
    const dataSources = await worksheets[0].getDataSourcesAsync();
    if (dataSources.length > 0) {
      context.datasourceName = dataSources.map((ds) => ds.name).join(', ');
    }
  }
  return context;
}

// AllowedRegions 워크시트의 컬럼마다 하나의 권한 기준이 된다 (지역, 사업부 등 몇 개든 상관없음).
// 각 컬럼의 고유값 목록을 그 컬럼명(fieldName)에 매핑해서 { 필드명: [값...] } 형태로 돌려준다.
// 대시보드마다 다른 필드명/개수를 그대로 지원하기 위해, 필드명을 코드에 고정하지 않는다.
async function collectPermissions() {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  const allNames = dashboard.worksheets.map((ws) => ws.name);
  const worksheet = dashboard.worksheets.find((ws) => ws.name === ALLOWED_REGIONS_WORKSHEET_NAME);
  if (!worksheet) {
    throw new Error(
      `"${ALLOWED_REGIONS_WORKSHEET_NAME}" 워크시트를 대시보드에서 못 찾음. 실제 워크시트 목록: [${allNames.join(', ')}]`,
    );
  }

  const reader = await worksheet.getSummaryDataReaderAsync();
  try {
    const dataTable = await reader.getAllPagesAsync();
    if (dataTable.columns.length === 0) {
      throw new Error(`"${ALLOWED_REGIONS_WORKSHEET_NAME}" 워크시트에 컬럼이 없음.`);
    }
    if (dataTable.data.length === 0) {
      const columnNames = dataTable.columns.map((c) => c.fieldName).join(', ');
      throw new Error(
        `"${ALLOWED_REGIONS_WORKSHEET_NAME}" 워크시트는 찾았지만 데이터 행이 0개. 컬럼: [${columnNames}]`,
      );
    }

    const result = {};
    dataTable.columns.forEach((column, colIndex) => {
      const values = dataTable.data.map((row) => String(row[colIndex].value));
      result[column.fieldName] = Array.from(new Set(values));
    });
    return result;
  } finally {
    await reader.releaseAsync();
  }
}

// 백엔드가 줄바꿈으로 구분된 JSON 이벤트를 스트리밍으로 보내준다. 여기서는 fetch의
// ReadableStream을 그대로 읽어서 한 줄씩 파싱하고, 이벤트 종류별로 콜백을 호출한다.
async function askBackend(question, { onStatus, onChunk } = {}) {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context: dashboardContext, permissions }),
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `백엔드 오류 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let errorMessage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.type === 'status') {
        onStatus?.(event.message);
      } else if (event.type === 'answer_chunk') {
        fullText += event.text;
        onChunk?.(fullText);
      } else if (event.type === 'error') {
        errorMessage = event.message;
      }
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  return fullText;
}

function autoResizeInput() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`;
}

inputEl.addEventListener('input', autoResizeInput);

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = inputEl.value.trim();
  if (!question) return;

  inputEl.value = '';
  autoResizeInput();
  appendMessage('user', question);

  inputEl.disabled = true;
  sendEl.disabled = true;

  const live = createLiveAssistantMessage();
  try {
    const fullText = await askBackend(question, {
      onStatus: (message) => live.setStatus(message),
      onChunk: (text) => live.setChunkText(text),
    });
    live.finalize(fullText);
  } catch (error) {
    live.remove();
    appendMessage('error', `오류가 발생했습니다: ${error.message}`);
  } finally {
    inputEl.disabled = false;
    sendEl.disabled = false;
    inputEl.focus();
  }
});

async function main() {
  await tableau.extensions.initializeAsync();

  setStatus('대시보드 컨텍스트 수집 중...', 'connecting');
  dashboardContext = await collectDashboardContext();

  setStatus('권한 범위 확인 중...', 'connecting');
  try {
    permissions = await collectPermissions();
    const summary = Object.entries(permissions)
      .map(([field, values]) => `${field}(${values.length})`)
      .join(', ');
    setStatus(`권한 범위: ${summary}`, 'ready');
  } catch (error) {
    // 권한 범위를 못 읽으면 안전하게 빈 값으로 처리(= 데이터 접근 불가)하되,
    // 원인은 상태 표시줄에 그대로 노출해서 디버깅할 수 있게 한다.
    permissions = {};
    setStatus(`권한 범위 확인 실패: ${error.message}`, 'error');
  }

  inputEl.disabled = false;
  sendEl.disabled = false;
  inputEl.focus();
}

main().catch((error) => {
  console.error(error);
  setStatus(`초기화 실패: ${error.message}`, 'error');
});
