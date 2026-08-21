// 최소한의 자체 SVG 차트 렌더러. 외부 라이브러리/CDN 없음.
// Gemini 응답에 포함된 ```chart{...}``` 블록(JSON)을 렌더링하는 데 쓰인다.
// 지원 타입: bar, line, pie. 데이터가 1개뿐이면 항상 stat tile로 대체.

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 검증된 카테고리 팔레트(고정 순서) — dataviz 스킬의 참조 팔레트에서 가져옴
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
  const OTHER_COLOR = '#9ca3af';
  const INK = {
    primary: '#1a1d23',
    secondary: '#52514e',
    muted: '#898781',
    grid: '#e5e7eb',
    baseline: '#c3c2b7',
  };

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      node.setAttribute(key, value);
    }
    return node;
  }

  function htmlEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatCompact(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n);
    const abs = Math.abs(num);
    if (abs >= 100000000) return `${(num / 100000000).toFixed(1)}억`;
    if (abs >= 10000) return `${(num / 10000).toFixed(1)}만`;
    return num.toLocaleString('ko-KR');
  }

  // ---------- 공용 툴팁 (하나 재사용) ----------
  let tooltipEl = null;
  function getTooltip() {
    if (!tooltipEl) {
      tooltipEl = htmlEl('div', 'chart-tooltip');
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }
  function showTooltip(event, rows) {
    const tip = getTooltip();
    tip.replaceChildren();
    for (const row of rows) {
      const line = htmlEl('div', 'chart-tooltip-row');
      const swatch = htmlEl('span', 'chart-tooltip-swatch');
      swatch.style.background = row.color;
      const label = htmlEl('span', 'chart-tooltip-label', row.label);
      const value = htmlEl('span', 'chart-tooltip-value', row.value);
      line.append(swatch, label, value);
      tip.appendChild(line);
    }
    tip.style.display = 'block';
    positionTooltip(event);
  }
  function positionTooltip(event) {
    const tip = getTooltip();
    const offset = 12;
    let x = event.pageX + offset;
    let y = event.pageY + offset;
    const rect = tip.getBoundingClientRect();
    if (x + rect.width > window.scrollX + window.innerWidth) x = event.pageX - rect.width - offset;
    if (y + rect.height > window.scrollY + window.innerHeight) y = event.pageY - rect.height - offset;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  // ---------- 데이터 정규화 ----------
  function normalizeSpec(rawSpec) {
    if (!rawSpec || typeof rawSpec !== 'object') return null;
    const labels = Array.isArray(rawSpec.labels) ? rawSpec.labels.map(String) : [];
    const seriesInput = Array.isArray(rawSpec.series) ? rawSpec.series : [];
    if (labels.length === 0 || seriesInput.length === 0) return null;

    const series = seriesInput
      .slice(0, PALETTE.length)
      .map((s) => ({
        name: String(s?.name ?? ''),
        data: labels.map((_, i) => {
          const v = Array.isArray(s?.data) ? Number(s.data[i]) : NaN;
          return Number.isFinite(v) ? v : 0;
        }),
      }))
      .filter((s) => s.data.length > 0);

    if (series.length === 0) return null;

    return {
      type: rawSpec.type === 'line' || rawSpec.type === 'pie' ? rawSpec.type : 'bar',
      title: rawSpec.title ? String(rawSpec.title) : '',
      unit: rawSpec.unit ? String(rawSpec.unit) : '',
      labels,
      series,
    };
  }

  // ---------- Stat tile (데이터가 1개뿐일 때) ----------
  function renderStatTile(spec) {
    const wrap = htmlEl('div', 'chart-stat-tile');
    if (spec.title) wrap.appendChild(htmlEl('div', 'chart-stat-label', spec.title));
    else wrap.appendChild(htmlEl('div', 'chart-stat-label', spec.series[0].name || spec.labels[0]));
    const value = spec.series[0].data[0];
    wrap.appendChild(htmlEl('div', 'chart-stat-value', `${formatCompact(value)}${spec.unit}`));
    if (spec.labels[0]) wrap.appendChild(htmlEl('div', 'chart-stat-sub', spec.labels[0]));
    return wrap;
  }

  // ---------- 범례 ----------
  function renderLegend(entries) {
    const legend = htmlEl('div', 'chart-legend');
    for (const entry of entries) {
      const item = htmlEl('span', 'chart-legend-item');
      const swatch = htmlEl('span', 'chart-legend-swatch');
      swatch.style.background = entry.color;
      item.appendChild(swatch);
      item.appendChild(htmlEl('span', null, entry.label));
      legend.appendChild(item);
    }
    return legend;
  }

  // ---------- 표로 보기 토글 ----------
  function renderTableToggle(spec) {
    const details = htmlEl('details', 'chart-table-toggle');
    const summary = htmlEl('summary', null, '표로 보기');
    details.appendChild(summary);

    const table = document.createElement('table');
    table.className = 'chart-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(htmlEl('th', null, ''));
    for (const s of spec.series) headRow.appendChild(htmlEl('th', null, s.name || ''));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    spec.labels.forEach((label, i) => {
      const row = document.createElement('tr');
      row.appendChild(htmlEl('td', null, label));
      for (const s of spec.series) row.appendChild(htmlEl('td', null, formatCompact(s.data[i])));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    details.appendChild(table);
    return details;
  }

  // ---------- 막대 차트 ----------
  function renderBarChart(spec) {
    const W = 320;
    const H = 190;
    const padL = 36;
    const padR = 10;
    const padT = 14;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const multiSeries = spec.series.length > 1;
    const maxValue = Math.max(1, ...spec.series.flatMap((s) => s.data));
    const niceMax = niceCeiling(maxValue);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg' });

    // 그리드라인 + y축 눈금 (0 포함 3단계)
    const ticks = 3;
    for (let t = 0; t <= ticks; t++) {
      const value = (niceMax / ticks) * t;
      const y = padT + plotH - (value / niceMax) * plotH;
      svg.appendChild(
        svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: INK.grid, 'stroke-width': 1 }),
      );
      const label = svgEl('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', class: 'chart-axis-label' });
      label.textContent = formatCompact(value);
      svg.appendChild(label);
    }

    const groupWidth = plotW / spec.labels.length;
    const barGap = 2;
    const barSlot = Math.min(24, (groupWidth - barGap * (spec.series.length + 1)) / spec.series.length);
    const showDirectLabels = spec.labels.length <= 6;

    spec.labels.forEach((label, i) => {
      const groupX = padL + i * groupWidth;
      spec.series.forEach((s, si) => {
        const value = s.data[i];
        const barH = (value / niceMax) * plotH;
        const barX =
          groupX + (groupWidth - spec.series.length * barSlot - (spec.series.length - 1) * barGap) / 2 +
          si * (barSlot + barGap);
        const barY = padT + plotH - barH;
        const color = spec.series.length > 1 ? PALETTE[si % PALETTE.length] : PALETTE[0];

        const rect = svgEl('rect', {
          x: barX,
          y: barY,
          width: barSlot,
          height: Math.max(barH, 0.5),
          rx: 4,
          fill: color,
          class: 'chart-bar',
        });
        rect.addEventListener('pointerenter', (e) => {
          rect.style.opacity = '0.85';
          showTooltip(e, [{ color, label: s.name || label, value: `${formatCompact(value)}${spec.unit}` }]);
        });
        rect.addEventListener('pointermove', positionTooltip);
        rect.addEventListener('pointerleave', () => {
          rect.style.opacity = '1';
          hideTooltip();
        });
        svg.appendChild(rect);

        if (showDirectLabels && !multiSeries) {
          const valueLabel = svgEl('text', {
            x: barX + barSlot / 2,
            y: barY - 4,
            'text-anchor': 'middle',
            class: 'chart-value-label',
          });
          valueLabel.textContent = formatCompact(value);
          svg.appendChild(valueLabel);
        }
      });

      const catLabel = svgEl('text', {
        x: groupX + groupWidth / 2,
        y: H - 8,
        'text-anchor': 'middle',
        class: 'chart-axis-label',
      });
      catLabel.textContent = truncateLabel(label, spec.labels.length);
      svg.appendChild(catLabel);
    });

    svg.appendChild(
      svgEl('line', {
        x1: padL,
        x2: W - padR,
        y1: padT + plotH,
        y2: padT + plotH,
        stroke: INK.baseline,
        'stroke-width': 1,
      }),
    );

    return svg;
  }

  // ---------- 선 차트 ----------
  function renderLineChart(spec) {
    const W = 320;
    const H = 190;
    const padL = 36;
    const padR = 10;
    const padT = 14;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxValue = Math.max(1, ...spec.series.flatMap((s) => s.data));
    const niceMax = niceCeiling(maxValue);
    const stepX = spec.labels.length > 1 ? plotW / (spec.labels.length - 1) : 0;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg' });

    const ticks = 3;
    for (let t = 0; t <= ticks; t++) {
      const value = (niceMax / ticks) * t;
      const y = padT + plotH - (value / niceMax) * plotH;
      svg.appendChild(
        svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: INK.grid, 'stroke-width': 1 }),
      );
      const label = svgEl('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', class: 'chart-axis-label' });
      label.textContent = formatCompact(value);
      svg.appendChild(label);
    }

    const xOf = (i) => padL + i * stepX;
    const yOf = (v) => padT + plotH - (v / niceMax) * plotH;

    // 시리즈마다 hover 시 값을 보여줄 세로 히트 컬럼 (crosshair 대용, 좌표 변환 없이 event 좌표 그대로 사용)
    spec.labels.forEach((_, i) => {
      const hit = svgEl('rect', {
        x: xOf(i) - stepX / 2,
        y: padT,
        width: Math.max(stepX, 12),
        height: plotH,
        fill: 'transparent',
      });
      hit.addEventListener('pointerenter', (e) => {
        crosshair.setAttribute('x1', xOf(i));
        crosshair.setAttribute('x2', xOf(i));
        crosshair.style.opacity = '1';
        showTooltip(
          e,
          spec.series.map((s, si) => ({
            color: spec.series.length > 1 ? PALETTE[si % PALETTE.length] : PALETTE[0],
            label: s.name || spec.labels[i],
            value: `${formatCompact(s.data[i])}${spec.unit}`,
          })),
        );
      });
      hit.addEventListener('pointermove', positionTooltip);
      hit.addEventListener('pointerleave', () => {
        crosshair.style.opacity = '0';
        hideTooltip();
      });
      svg.appendChild(hit);
    });

    const crosshair = svgEl('line', {
      x1: 0,
      x2: 0,
      y1: padT,
      y2: padT + plotH,
      stroke: INK.baseline,
      'stroke-width': 1,
      style: 'opacity:0; pointer-events:none;',
    });

    spec.series.forEach((s, si) => {
      const color = spec.series.length > 1 ? PALETTE[si % PALETTE.length] : PALETTE[0];
      const points = s.data.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');
      svg.appendChild(
        svgEl('polyline', {
          points,
          fill: 'none',
          stroke: color,
          'stroke-width': 2,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }),
      );
      s.data.forEach((v, i) => {
        svg.appendChild(
          svgEl('circle', { cx: xOf(i), cy: yOf(v), r: 4, fill: color, stroke: '#fff', 'stroke-width': 2 }),
        );
      });
    });

    svg.appendChild(crosshair);

    spec.labels.forEach((label, i) => {
      const catLabel = svgEl('text', {
        x: xOf(i),
        y: H - 8,
        'text-anchor': 'middle',
        class: 'chart-axis-label',
      });
      catLabel.textContent = truncateLabel(label, spec.labels.length);
      svg.appendChild(catLabel);
    });

    svg.appendChild(
      svgEl('line', {
        x1: padL,
        x2: W - padR,
        y1: padT + plotH,
        y2: padT + plotH,
        stroke: INK.baseline,
        'stroke-width': 1,
      }),
    );

    return svg;
  }

  // ---------- 파이(도넛) 차트 ----------
  function renderPieChart(spec) {
    // 2조각 파이는 금지(anti-pattern) — 막대로 대체
    if (spec.labels.length === 2) {
      return renderBarChart({ ...spec, type: 'bar' });
    }

    const values = spec.labels.map((label, i) => ({ label, value: spec.series[0].data[i] }));
    values.sort((a, b) => b.value - a.value);

    let slices = values;
    if (slices.length > 6) {
      const head = slices.slice(0, 6);
      const restSum = slices.slice(6).reduce((sum, s) => sum + s.value, 0);
      slices = [...head, { label: '기타', value: restSum }];
    }

    const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
    const size = 190;
    const cx = size / 2;
    const cy = size / 2;
    const r = 70;
    const innerR = 40;

    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'chart-svg' });

    let angleStart = -Math.PI / 2;
    slices.forEach((slice, i) => {
      const fraction = slice.value / total;
      const angleEnd = angleStart + fraction * Math.PI * 2;
      const color = slice.label === '기타' ? OTHER_COLOR : PALETTE[i % PALETTE.length];

      const path = svgEl('path', {
        d: donutSlicePath(cx, cy, r, innerR, angleStart, angleEnd),
        fill: color,
        class: 'chart-pie-slice',
      });
      path.addEventListener('pointerenter', (e) => {
        path.style.opacity = '0.85';
        showTooltip(e, [
          {
            color,
            label: slice.label,
            value: `${formatCompact(slice.value)}${spec.unit} (${(fraction * 100).toFixed(1)}%)`,
          },
        ]);
      });
      path.addEventListener('pointermove', positionTooltip);
      path.addEventListener('pointerleave', () => {
        path.style.opacity = '1';
        hideTooltip();
      });
      svg.appendChild(path);

      if (fraction >= 0.1) {
        const midAngle = (angleStart + angleEnd) / 2;
        const labelR = (r + innerR) / 2;
        const lx = cx + Math.cos(midAngle) * labelR;
        const ly = cy + Math.sin(midAngle) * labelR;
        const pctLabel = svgEl('text', {
          x: lx,
          y: ly + 3,
          'text-anchor': 'middle',
          class: 'chart-pie-pct-label',
        });
        pctLabel.textContent = `${Math.round(fraction * 100)}%`;
        svg.appendChild(pctLabel);
      }

      angleStart = angleEnd;
    });

    const totalLabel = svgEl('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'chart-donut-total' });
    totalLabel.textContent = formatCompact(total);
    svg.appendChild(totalLabel);
    const totalSub = svgEl('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', class: 'chart-donut-sub' });
    totalSub.textContent = '합계';
    svg.appendChild(totalSub);

    const wrap = htmlEl('div', 'chart-pie-wrap');
    wrap.appendChild(svg);
    wrap.appendChild(
      renderLegend(
        slices.map((s, i) => ({
          color: s.label === '기타' ? OTHER_COLOR : PALETTE[i % PALETTE.length],
          label: `${s.label} (${Math.round((s.value / total) * 100)}%)`,
        })),
      ),
    );
    return wrap;
  }

  function donutSlicePath(cx, cy, r, innerR, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const p1 = [cx + r * Math.cos(startAngle), cy + r * Math.sin(startAngle)];
    const p2 = [cx + r * Math.cos(endAngle), cy + r * Math.sin(endAngle)];
    const p3 = [cx + innerR * Math.cos(endAngle), cy + innerR * Math.sin(endAngle)];
    const p4 = [cx + innerR * Math.cos(startAngle), cy + innerR * Math.sin(startAngle)];
    return [
      `M ${p1[0]} ${p1[1]}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${p2[0]} ${p2[1]}`,
      `L ${p3[0]} ${p3[1]}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${p4[0]} ${p4[1]}`,
      'Z',
    ].join(' ');
  }

  function niceCeiling(value) {
    if (value <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const normalized = value / magnitude;
    let niceNormalized;
    if (normalized <= 1) niceNormalized = 1;
    else if (normalized <= 2) niceNormalized = 2;
    else if (normalized <= 5) niceNormalized = 5;
    else niceNormalized = 10;
    return niceNormalized * magnitude;
  }

  function truncateLabel(label, count) {
    const maxLen = count > 8 ? 4 : count > 5 ? 6 : 10;
    return label.length > maxLen ? `${label.slice(0, maxLen - 1)}…` : label;
  }

  // ---------- 진입점 ----------
  window.renderDataChart = function (rawSpec) {
    const spec = normalizeSpec(rawSpec);
    if (!spec) return null;

    const totalPoints = spec.labels.length;
    const wrap = htmlEl('div', 'chart-wrap');

    if (spec.title) wrap.appendChild(htmlEl('div', 'chart-title', spec.title));

    // 데이터 포인트가 1개뿐이면 항상 stat tile (1-bar 차트/2-slice 파이 금지 원칙과 동일한 이유)
    if (totalPoints === 1 && spec.series.length === 1) {
      wrap.appendChild(renderStatTile(spec));
      return wrap;
    }

    if (spec.type === 'pie') {
      wrap.appendChild(renderPieChart(spec));
    } else if (spec.type === 'line') {
      wrap.appendChild(renderLineChart(spec));
      if (spec.series.length > 1) {
        wrap.appendChild(
          renderLegend(spec.series.map((s, i) => ({ color: PALETTE[i % PALETTE.length], label: s.name }))),
        );
      }
    } else {
      wrap.appendChild(renderBarChart(spec));
      if (spec.series.length > 1) {
        wrap.appendChild(
          renderLegend(spec.series.map((s, i) => ({ color: PALETTE[i % PALETTE.length], label: s.name }))),
        );
      }
    }

    wrap.appendChild(renderTableToggle(spec));
    return wrap;
  };
})();
