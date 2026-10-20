(() => {
  'use strict';

  let COLS = 21;
  let ROWS = 13;
  let TOTAL = COLS * ROWS;
  const WEIGHT = 5;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const $grid = $('#grid');
  const $run = $('#runButton');
  const $pause = $('#pauseButton');
  const $step = $('#stepButton');
  const $status = $('#runStatus');
  const $message = $('#resultMessage');
  const $comparison = $('#comparisonTable');
  const algorithms = {
    bfs: { name: 'BFS', description: 'Идёт по клеткам волной и находит маршрут с минимумом шагов. Цена рельефа не учитывается.' },
    dijkstra: { name: 'Дейкстра', description: 'Проверяет сначала клетки с самой низкой суммарной ценой пути.' },
    astar: { name: 'A*', description: 'Оценивает цену уже пройденного пути и расстояние до финиша.' }
  };

  let board = starterBoard();
  let algorithm = 'dijkstra';
  let diagonal = false;
  let tool = 'wall';
  let search = null;
  let eventIndex = 0;
  let timer = 0;
  let pointerAction = null;
  let activeCell = board.start;
  const undoStack = [];
  const visual = { frontier: new Set(), visited: new Set(), path: new Set() };
  let toastTimer;

  function cellId(x, y) { return y * COLS + x; }
  function xy(id) { return { x: id % COLS, y: Math.floor(id / COLS) }; }
  function starterBoard() {
    const start = cellId(1, 6);
    const end = cellId(19, 6);
    const walls = new Set();
    const mud = new Set();
    const addWall = (x, y) => { const id = cellId(x, y); if (id !== start && id !== end) walls.add(id); };
    for (let y = 0; y <= 10; y += 1) if (y !== 2 && y !== 9) addWall(5, y);
    for (let y = 2; y < ROWS; y += 1) if (y !== 5 && y !== 10) addWall(10, y);
    for (let y = 0; y <= 9; y += 1) if (y !== 3 && y !== 7) addWall(15, y);
    for (let x = 6; x < 10; x += 1) if (x !== 8) addWall(x, 9);
    for (let x = 11; x < 15; x += 1) if (x !== 13) addWall(x, 3);
    [[2,3],[3,3],[7,4],[8,4],[8,5],[12,7],[13,7],[17,8],[18,8],[18,9],[3,10],[4,10],[12,11],[13,11],[17,2],[18,2],[8,1],[9,1]].forEach(([x,y]) => mud.add(cellId(x,y)));
    return { start, end, walls, mud, goals: new Set() };
  }

  function saveUndo() {
    undoStack.push({ start: board.start, end: board.end, walls: new Set(board.walls), mud: new Set(board.mud), goals: new Set(board.goals || []) });
    if (undoStack.length > 40) undoStack.shift();
  }
  function undo() {
    const previous = undoStack.pop();
    if (!previous) { showToast('Отменять пока нечего.'); return; }
    stopTimer();
    board = previous;
    clearSearch();
    renderGrid();
    showToast('Последнее изменение отменено.');
  }
  function clearSearch() {
    stopTimer();
    search = null;
    $('#exportRouteButton').disabled = true;
    $('#exportReportButton').disabled = true;
    eventIndex = 0;
    visual.frontier.clear(); visual.visited.clear(); visual.path.clear();
    setStatus('ready');
    updateMetrics(null);
    $comparison.hidden = true;
    $comparison.replaceChildren();
    $('#runProgress').style.width = '0%';
    $pause.hidden = true;
    $run.hidden = false;
    $run.classList.remove('is-running');
    $run.innerHTML = '<span class="play-symbol" aria-hidden="true">▶</span><span>Проверить уровень</span>';
    $message.textContent = 'Поле готово. Запусти проверку или покажи один шаг.';
    setQaSummary('idle', 'Проверка ещё не запускалась', 'Проверь путь к выходу и отметь обязательные цели уровня, например точки сохранения или ключевые комнаты.');
  }
  function setQaSummary(state, verdict, summary) {
    const $verdict = $('#qaVerdict');
    $verdict.dataset.state = state;
    $verdict.textContent = verdict;
    $('#qaSummary').textContent = summary;
  }
  function stopTimer() { if (timer) clearTimeout(timer); timer = 0; }
  function setStatus(name) {
    const labels = { ready: 'ГОТОВ', running: 'ПОИСК ИДЁТ', paused: 'ПАУЗА', done: 'ПРОВЕРЕНО', error: 'НУЖНА ПРАВКА' };
    $status.className = `run-status${name === 'running' || name === 'done' ? ` is-${name}` : name === 'error' ? ' is-error' : ''}`;
    $status.innerHTML = `<i></i>${labels[name]}`;
  }
  function showToast(text) {
    const toast = $('#toast'); toast.textContent = text; toast.classList.add('is-visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2300);
  }
  function setTool(next) {
    tool = next;
    $grid.dataset.tool = tool;
    $$('.tool-button').forEach(button => {
      const selected = button.dataset.tool === tool;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const hints = { wall: 'Нажми и веди, чтобы рисовать', mud: 'Эти клетки стоят в 5 раз дороже', erase: 'Веди по клеткам, чтобы убрать', start: 'Нажми на клетку для старта', end: 'Нажми на клетку для выхода', goal: 'Отметь до 4 обязательных комнат или точек' };
    $('#drawHint').textContent = hints[tool];
  }

  function cellLabel(id) {
    const { x, y } = xy(id);
    if (id === board.start) return `Старт, столбец ${x + 1}, строка ${y + 1}`;
    if (id === board.end) return `Выход, столбец ${x + 1}, строка ${y + 1}`;
    if (board.goals?.has(id)) return `Цель ${[...board.goals].indexOf(id) + 1}, столбец ${x + 1}, строка ${y + 1}`;
    if (board.walls.has(id)) return `Стена, столбец ${x + 1}, строка ${y + 1}`;
    if (board.mud.has(id)) return `Рельеф, цена ${WEIGHT}, столбец ${x + 1}, строка ${y + 1}`;
    return `Клетка, столбец ${x + 1}, строка ${y + 1}`;
  }
  function renderGrid() {
    $grid.replaceChildren();
    $grid.style.gridTemplateColumns = `repeat(${COLS}, minmax(0, 1fr))`;
    $grid.setAttribute('aria-rowcount', String(ROWS));
    $grid.setAttribute('aria-colcount', String(COLS));
    $('#boardDimensions').textContent = `${COLS} × ${ROWS}`;
    $('#gridEndCoordinate').textContent = String(COLS).padStart(2, '0');
    $grid.dataset.tool = tool;
    for (let id = 0; id < TOTAL; id += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.id = String(id);
      cell.setAttribute('role', 'gridcell');
      if (board.walls.has(id)) cell.classList.add('is-wall');
      else if (visual.path.has(id)) cell.classList.add('is-path');
      else if (visual.frontier.has(id)) cell.classList.add('is-frontier');
      else if (visual.visited.has(id)) cell.classList.add('is-visited');
      else if (board.mud.has(id)) cell.classList.add('is-mud');
      if (id === board.start) { cell.classList.add('is-start'); cell.textContent = 'S'; }
      else if (id === board.end) { cell.classList.add('is-end'); cell.textContent = 'E'; }
      else if (board.goals?.has(id)) { cell.classList.add('is-goal'); cell.textContent = String([...board.goals].indexOf(id) + 1); }
      if (id === activeCell) cell.classList.add('is-active-cell');
      cell.setAttribute('aria-label', cellLabel(id));
      if (id === activeCell) cell.setAttribute('aria-selected', 'true');
      $grid.append(cell);
    }
  }
  function updateMetrics(result) {
    const complete = result?.complete && result.found;
    $('#visitedCount').textContent = String(visual.visited.size);
    $('#pathLength').textContent = complete ? Math.max(0, result.path.length - 1) : '—';
    $('#pathCost').textContent = complete ? formatCost(result.cost) : '—';
    $('#pathMetricLabel').textContent = 'шагов';
  }
  function formatCost(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }

  class MinHeap {
    constructor() { this.items = []; }
    push(value) { this.items.push(value); let i = this.items.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (this.items[parent].priority <= value.priority) break; this.items[i] = this.items[parent]; i = parent; } this.items[i] = value; }
    pop() { if (!this.items.length) return null; const root = this.items[0]; const tail = this.items.pop(); if (this.items.length) { let i = 0; while (true) { let child = i * 2 + 1; if (child >= this.items.length) break; if (child + 1 < this.items.length && this.items[child + 1].priority < this.items[child].priority) child += 1; if (this.items[child].priority >= tail.priority) break; this.items[i] = this.items[child]; i = child; } this.items[i] = tail; } return root; }
    get length() { return this.items.length; }
  }

  function neighbors(id) {
    const { x, y } = xy(id);
    const directions = [[0,-1],[1,0],[0,1],[-1,0]];
    if (diagonal) directions.push([1,-1],[1,1],[-1,1],[-1,-1]);
    const result = [];
    for (const [dx,dy] of directions) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const next = cellId(nx,ny);
      if (board.walls.has(next)) continue;
      const isDiagonal = dx !== 0 && dy !== 0;
      if (isDiagonal && (board.walls.has(cellId(x + dx,y)) || board.walls.has(cellId(x,y + dy)))) continue;
      result.push({ id: next, diagonal: isDiagonal });
    }
    return result;
  }
  function heuristic(id, target = board.end) {
    const a = xy(id); const b = xy(target); const dx = Math.abs(a.x - b.x); const dy = Math.abs(a.y - b.y);
    return diagonal ? Math.max(dx,dy) + (Math.SQRT2 - 1) * Math.min(dx,dy) : dx + dy;
  }

  function solve(algorithmName, target = board.end) {
    const events = [];
    const parent = new Map();
    const costTo = new Map([[board.start, 0]]);
    const closed = new Set();
    let expanded = 0;
    let found = false;
    if (algorithmName === 'bfs') {
      const queue = [board.start]; const queued = new Set([board.start]); let head = 0;
      while (head < queue.length) {
        const current = queue[head++];
        if (closed.has(current)) continue;
        closed.add(current); expanded += 1; events.push({ type: 'visit', id: current });
        if (current === target) { found = true; break; }
        for (const next of neighbors(current)) {
          if (queued.has(next.id)) continue;
          queued.add(next.id); parent.set(next.id, current); costTo.set(next.id, costTo.get(current) + 1);
          queue.push(next.id); events.push({ type: 'frontier', id: next.id });
        }
      }
    } else {
      const heap = new MinHeap();
      heap.push({ id: board.start, cost: 0, priority: algorithmName === 'astar' ? heuristic(board.start, target) : 0 });
      while (heap.length) {
        const entry = heap.pop(); const current = entry.id;
        if (closed.has(current) || entry.cost > costTo.get(current)) continue;
        closed.add(current); expanded += 1; events.push({ type: 'visit', id: current });
        if (current === target) { found = true; break; }
        for (const next of neighbors(current)) {
          const stepCost = (board.mud.has(next.id) ? WEIGHT : 1) * (next.diagonal ? Math.SQRT2 : 1);
          const nextCost = costTo.get(current) + stepCost;
          if (nextCost >= (costTo.get(next.id) ?? Infinity)) continue;
          parent.set(next.id, current); costTo.set(next.id, nextCost);
          const estimate = nextCost + (algorithmName === 'astar' ? heuristic(next.id, target) : 0);
          heap.push({ id: next.id, cost: nextCost, priority: estimate });
          events.push({ type: 'frontier', id: next.id });
        }
      }
    }

    let path = [];
    if (found) {
      let cursor = target;
      path = [cursor];
      while (cursor !== board.start) {
        cursor = parent.get(cursor);
        if (cursor === undefined) { path = []; found = false; break; }
        path.push(cursor);
      }
      path.reverse();
      events.push({ type: 'path', ids: path.slice(1, -1) });
    }
    const routeCost = found ? path.slice(1).reduce((total, id, index) => {
      const previous = xy(path[index]);
      const current = xy(id);
      const isDiagonal = previous.x !== current.x && previous.y !== current.y;
      return total + (board.mud.has(id) ? WEIGHT : 1) * (isDiagonal ? Math.SQRT2 : 1);
    }, 0) : Infinity;
    return { events, path, expanded, cost: routeCost, found };
  }

  function prepareSearch() {
    if (board.start === board.end) { showToast('Старт и финиш должны быть разными клетками.'); return false; }
    clearSearch();
    search = solve(algorithm);
    visual.frontier.add(board.start);
    $message.textContent = `${algorithms[algorithm].name} исследует поле…`;
    setQaSummary('checking', 'Проверяем связность…', `${algorithms[algorithm].name} проходит карту. Итог и отчёт появятся после завершения проверки.`);
    setStatus('ready');
    updateMetrics(null);
    renderGrid();
    return true;
  }
  function applyNextEvent() {
    if (!search || eventIndex >= search.events.length) return false;
    const event = search.events[eventIndex++];
    if (event.type === 'frontier') { if (!visual.visited.has(event.id)) visual.frontier.add(event.id); }
    else if (event.type === 'visit') { visual.frontier.delete(event.id); visual.visited.add(event.id); }
    else if (event.type === 'path') event.ids.forEach(id => visual.path.add(id));
    $('#runProgress').style.width = `${Math.min(100, eventIndex / Math.max(search.events.length,1) * 100)}%`;
    updateMetrics(search);
    renderGrid();
    if (eventIndex >= search.events.length) finishSearch();
    return true;
  }
  function finishSearch() {
    stopTimer(); $pause.hidden = true; $run.hidden = false; $run.classList.remove('is-running');
    $run.innerHTML = '<span class="play-symbol" aria-hidden="true">↻</span><span>Проверить ещё раз</span>';
    search.complete = true;
    search.goalChecks = [...(board.goals || [])].map(id => ({ id, ...solve(algorithm, id) }));
    const missedGoals = search.goalChecks.filter(goal => !goal.found);
    const levelPasses = search.found && missedGoals.length === 0;
    updateMetrics(search);
    setStatus(levelPasses ? 'done' : 'error');
    if (search?.found) $message.textContent = `${algorithms[algorithm].name}: выход достижим, маршрут ${search.path.length - 1} шагов · цена ${formatCost(search.cost)}.${search.goalChecks.length ? ` Цели: ${search.goalChecks.length - missedGoals.length}/${search.goalChecks.length} доступны.` : ''}`;
    else $message.textContent = 'Маршрут не найден. Измени карту и попробуй снова.';
    const walkable = TOTAL - board.walls.size;
    const unreachable = Math.max(0, walkable - search.expanded);
    setQaSummary(
      levelPasses ? 'pass' : 'fail',
      !search.found ? 'Выход отрезан от старта' : missedGoals.length ? 'Есть недостижимые цели' : 'Маршрут и цели доступны',
      !search.found
        ? `Выход не достижим. Недостижимых проходимых клеток: ${unreachable} из ${walkable}. Проверь стены и соединения между зонами.`
        : missedGoals.length
          ? `Выход достижим, но цели ${missedGoals.map(goal => [...board.goals].indexOf(goal.id) + 1).join(', ')} отрезаны от старта. Проверь переходы между зонами.`
          : `Выход${search.goalChecks.length ? ` и все ${search.goalChecks.length} цели` : ''} достижимы. Маршрут: ${search.path.length - 1} шагов, цена ${formatCost(search.cost)}. Учтено клеток сложного рельефа: ${board.mud.size}.`
    );
    $('#exportRouteButton').disabled = !search?.found;
    $('#exportReportButton').disabled = !search?.complete;
  }
  function exportRoute() {
    if (!search?.complete || !search.found) return;
    const payload = {
      format: 'pathlab-route-v1',
      grid: { columns: COLS, rows: ROWS, movement: diagonal ? 8 : 4, coordinates: 'top-left origin, zero-based' },
      algorithm,
      start: xy(board.start),
      finish: xy(board.end),
      route: search.path.map(id => xy(id)),
      goals: [...(board.goals || [])].map((id, index) => ({ ...xy(id), reachable: search.goalChecks?.[index]?.found ?? null })),
      obstacles: [...board.walls].map(id => xy(id)),
      costlyTiles: [...board.mud].map(id => ({ ...xy(id), cost: WEIGHT })),
      steps: search.path.length - 1,
      cost: Number.isFinite(search.cost) ? Number(search.cost.toFixed(3)) : null
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pathlab-route.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportValidationReport() {
    if (!search?.complete) return;
    const walkable = COLS * ROWS - board.walls.size;
    const unreachable = search.found ? null : Math.max(0, walkable - search.expanded);
    const route = search.found ? search.path.map(id => {
      const { x, y } = xy(id);
      return `(${x}, ${y})`;
    }).join(' → ') : 'Не найден';
    const lines = [
      '# PATHLAB — отчёт проверки уровня',
      '',
      `**Результат:** ${!search.found ? 'НЕ ПРОХОДИМ — выход недостижим' : search.goalChecks?.some(goal => !goal.found) ? 'НУЖНА ПРАВКА — часть обязательных целей недостижима' : 'ПРОВЕРКА ПРОЙДЕНА — выход и обязательные цели достижимы'}`,
      '',
      '## Условия проверки',
      `- Размер сетки: ${COLS} × ${ROWS} клеток`,
      `- Движение: ${diagonal ? '8 направлений (диагональный шаг стоит √2)' : '4 направления'}`,
      `- Старт: (${xy(board.start).x}, ${xy(board.start).y})`,
      `- Выход: (${xy(board.end).x}, ${xy(board.end).y})`,
      `- Обязательных целей: ${board.goals?.size || 0}`,
      `- Алгоритм проверки: ${algorithms[algorithm].name}`,
      `- Стены: ${board.walls.size}`,
      `- Проходимые клетки: ${walkable}`,
      `- Клетки сложного рельефа: ${board.mud.size} (цена каждой — ${WEIGHT})`,
      '',
      '## Найденный результат',
      `- Проверено клеток: ${search.expanded}`,
      `- Длина маршрута: ${search.found ? `${search.path.length - 1} шагов` : '—'}`,
      `- Стоимость маршрута: ${search.found ? `${formatCost(search.cost)} условных единиц` : '—'}`,
      `- Маршрут: ${route}`,
      '',
      '## Проверка целей уровня',
      ...(search.goalChecks?.length
        ? search.goalChecks.map((goal, index) => `- Цель ${index + 1} (${xy(goal.id).x}, ${xy(goal.id).y}): ${goal.found ? `достижима за ${goal.path.length - 1} шагов` : 'НЕДОСТИЖИМА'}`)
        : ['Цели не отмечены. Проверен только путь от старта к выходу.']),
      ...(unreachable === null ? [] : [`- Доступные клетки, не достижимые от старта: ${unreachable}`]),
      ...(unreachable === null ? [] : [`- Доля недостижимых проходимых клеток: ${walkable ? (unreachable / walkable * 100).toFixed(1) : '0.0'}%`]),
      '',
      '## Карта',
      '- Координаты в отчёте начинаются с нуля; начало сетки — в левом верхнем углу.',
      `- Стены: ${[...board.walls].map(id => { const { x, y } = xy(id); return `(${x}, ${y})`; }).join(', ') || 'нет'}`,
      `- Сложный рельеф: ${[...board.mud].map(id => { const { x, y } = xy(id); return `(${x}, ${y})`; }).join(', ') || 'нет'}`,
      '',
      '> Проверка описывает только связность клеточной карты и выбранную стоимость шага. Она не заменяет тестирование коллизий, навигации и поведения персонажа в игровом движке.'
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pathlab-level-check.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importLevelSeed(file) {
    try {
      const data = JSON.parse(await file.text());
      const columns = Number(data.columns), rows = Number(data.rows);
      if (data.format !== 'levelseed-map-v1' || !Number.isInteger(columns) || !Number.isInteger(rows) || columns < 3 || rows < 3 || columns > 64 || rows > 40) throw new Error('PATHLAB принимает карты LevelSeed размером до 64 × 40 клеток.');
      if (!Array.isArray(data.tiles) || data.tiles.length !== rows || data.tiles.some(row => !Array.isArray(row) || row.length !== columns || row.some(tile => !Number.isFinite(tile) || tile < 0))) throw new Error('Сетка в файле повреждена. Скачай карту заново из LevelSeed.');
      const validPoint = point => point && Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.x < columns && point.y >= 0 && point.y < rows && data.tiles[point.y][point.x] > 0;
      if (!validPoint(data.start) || !validPoint(data.finish) || (data.start.x === data.finish.x && data.start.y === data.finish.y)) throw new Error('В файле не найдены корректные клетки старта и выхода.');

      COLS = columns; ROWS = rows; TOTAL = COLS * ROWS;
      const start = cellId(data.start.x, data.start.y), end = cellId(data.finish.x, data.finish.y);
      const walls = new Set(), mud = new Set();
      data.tiles.forEach((row, y) => row.forEach((tile, x) => { if (tile === 0) walls.add(cellId(x, y)); }));
      (Array.isArray(data.hazards) ? data.hazards : []).forEach(point => {
        if (validPoint(point)) { const id = cellId(point.x, point.y); if (id !== start && id !== end) mud.add(id); }
      });
      walls.delete(start); walls.delete(end); mud.delete(start); mud.delete(end);
      board = { start, end, walls, mud, goals: new Set() };
      undoStack.length = 0;
      clearSearch();
      renderGrid();
      $('#importNote').textContent = `${data.title || 'Карта LevelSeed'} · ${columns} × ${rows} · ловушки отмечены как опасный рельеф ×5. Отметь обязательные цели, если нужно проверить доступность ключевых комнат.`;
      $message.textContent = 'Уровень загружен. Теперь можно проверить его проходимость и сравнить стратегии.';
    } catch (error) {
      $('#importNote').textContent = error instanceof Error ? error.message : 'Не удалось прочитать файл карты.';
    }
  }
  function runTick() {
    const batch = Math.max(1, Math.ceil(Number($('#speedRange').value) / 3));
    for (let i = 0; i < batch && eventIndex < search.events.length; i += 1) applyNextEvent();
    if (eventIndex < search.events.length) timer = setTimeout(runTick, 52);
  }
  function startRun() {
    if (search && eventIndex < search.events.length && $status.classList.contains('is-running')) { pauseRun(); return; }
    if (!search || eventIndex >= search.events.length) {
      if (!prepareSearch()) return;
    }
    $run.hidden = true; $pause.hidden = false; $pause.innerHTML = '<span aria-hidden="true">Ⅱ</span> Пауза';
    setStatus('running'); timer = setTimeout(runTick, 40);
  }
  function pauseRun() {
    stopTimer(); setStatus('paused'); $run.hidden = false; $pause.hidden = true;
    $run.classList.remove('is-running'); $run.innerHTML = '<span class="play-symbol" aria-hidden="true">▶</span><span>Продолжить</span>';
  }
  function singleStep() {
    if (!search || eventIndex >= search.events.length) { if (!prepareSearch()) return; }
    stopTimer(); setStatus('paused'); $run.hidden = false; $pause.hidden = true;
    $run.innerHTML = '<span class="play-symbol" aria-hidden="true">▶</span><span>Продолжить</span>';
    applyNextEvent();
    if (eventIndex < search.events.length) $message.textContent = `Шаг ${eventIndex} из ${search.events.length}. Нажми «Найти путь», чтобы продолжить.`;
  }

  function compareAlgorithms() {
    const results = Object.keys(algorithms).map(key => ({ key, ...solve(key) }));
    const reachable = results.filter(result => result.found);
    const bestCost = reachable.length ? Math.min(...reachable.map(result => result.cost)) : Infinity;
    $comparison.replaceChildren();
    const headings = document.createElement('div'); headings.className = 'compare-row header';
    headings.innerHTML = '<span>АЛГОРИТМ</span><span>КЛЕТКИ</span><span>ШАГИ</span><span>ЦЕНА</span>'; $comparison.append(headings);
    results.forEach(result => {
      const row = document.createElement('div'); row.className = `compare-row${result.found && Math.abs(result.cost - bestCost) < .001 ? ' is-best' : ''}`;
      row.innerHTML = `<strong>${algorithms[result.key].name}</strong><span>${result.found ? result.expanded : '—'}</span><span>${result.found ? result.path.length - 1 : '—'}</span><span>${result.found ? formatCost(result.cost) : '—'}</span>`;
      $comparison.append(row);
    });
    $comparison.hidden = false;
    showToast(reachable.length ? 'Сравнение рассчитано для текущего поля.' : 'На текущем поле маршрута нет ни у одного алгоритма.');
  }

  function isMarker(id) { return id === board.start || id === board.end || board.goals?.has(id); }
  function applyTool(id, value = true) {
    if (id < 0 || id >= TOTAL || id === board.start || id === board.end) return false;
    let changed = false;
    if (tool === 'wall') {
      if (value && !board.walls.has(id)) { board.walls.add(id); board.mud.delete(id); changed = true; }
      if (!value && board.walls.has(id)) { board.walls.delete(id); changed = true; }
    } else if (tool === 'mud') {
      if (value && !board.mud.has(id)) { board.mud.add(id); board.walls.delete(id); changed = true; }
      if (!value && board.mud.has(id)) { board.mud.delete(id); changed = true; }
    } else if (tool === 'erase') {
      changed = board.walls.delete(id) || board.mud.delete(id) || board.goals.delete(id);
    } else if (tool === 'start' || tool === 'end') {
      if (!board.walls.has(id)) {
        if (tool === 'start' && board.start !== id) { board.goals.delete(id); board.start = id; changed = true; }
        if (tool === 'end' && board.end !== id) { board.goals.delete(id); board.end = id; changed = true; }
      }
    } else if (tool === 'goal') {
      if (value && board.goals.has(id)) return false;
      if (value && board.goals.size >= 4) { showToast('Для проверки отметь не больше четырёх обязательных целей.'); return false; }
      if (value) { board.goals.add(id); changed = true; }
      else changed = board.goals.delete(id);
    }
    if (changed) { clearSearch(); renderGrid(); }
    return changed;
  }
  function pointerDown(event) {
    const cell = event.target.closest('.cell'); if (!cell) return;
    event.preventDefault(); const id = Number(cell.dataset.id);
    activeCell = id;
    saveUndo();
    if (id === board.start) pointerAction = { mode: 'start' };
    else if (id === board.end) pointerAction = { mode: 'end' };
    else if (tool === 'start' || tool === 'end') pointerAction = { mode: tool };
    else {
      const on = tool === 'wall' ? !board.walls.has(id) : tool === 'mud' ? !board.mud.has(id) : tool === 'goal' ? !board.goals.has(id) : false;
      pointerAction = { mode: 'paint', on };
      if (tool === 'erase') applyTool(id);
      else applyTool(id, on);
    }
    if (pointerAction.mode === 'start' || pointerAction.mode === 'end') applyTool(id);
    $grid.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event) {
    if (!pointerAction) return;
    const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('.cell');
    if (!target) return;
    const id = Number(target.dataset.id);
    if (pointerAction.mode === 'paint' && id !== board.start && id !== board.end) applyTool(id,pointerAction.on);
    else if ((pointerAction.mode === 'start' || pointerAction.mode === 'end') && !board.walls.has(id) && !isMarker(id)) {
      board[pointerAction.mode] = id; activeCell = id; clearSearch(); renderGrid();
    }
  }
  function pointerUp() { pointerAction = null; }
  function keyboardGrid(event) {
    const { x, y } = xy(activeCell); let nx = x; let ny = y;
    if (event.key === 'ArrowUp') ny -= 1;
    else if (event.key === 'ArrowDown') ny += 1;
    else if (event.key === 'ArrowLeft') nx -= 1;
    else if (event.key === 'ArrowRight') nx += 1;
    else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); saveUndo();
      const on = tool === 'wall' ? !board.walls.has(activeCell) : tool === 'mud' ? !board.mud.has(activeCell) : tool === 'goal' ? !board.goals.has(activeCell) : true;
      applyTool(activeCell, on); return;
    }
    else return;
    event.preventDefault(); nx = Math.max(0,Math.min(COLS-1,nx)); ny = Math.max(0,Math.min(ROWS-1,ny)); activeCell = cellId(nx,ny); renderGrid();
  }
  function randomBoard() {
    saveUndo(); const start = cellId(1,6); const end = cellId(19,6); const walls = new Set(); const mud = new Set();
    for (let id = 0; id < TOTAL; id += 1) {
      const { x,y } = xy(id); if (id === start || id === end || y === 6) continue;
      const roll = Math.random(); if (roll < .24) walls.add(id); else if (roll < .3) mud.add(id);
    }
    board = { start,end,walls,mud,goals: new Set() }; activeCell = start; clearSearch(); renderGrid(); showToast('Создано новое поле. Центральный коридор оставлен открытым.');
  }
  function clearBoard() {
    saveUndo(); board.walls.clear(); board.mud.clear(); board.goals.clear(); clearSearch(); renderGrid(); showToast('Препятствия, цели и рельеф убраны.');
  }

  $grid.addEventListener('pointerdown',pointerDown);
  $grid.addEventListener('pointermove',pointerMove);
  $grid.addEventListener('pointerup',pointerUp);
  $grid.addEventListener('pointercancel',pointerUp);
  window.addEventListener('pointerup',pointerUp);
  $grid.addEventListener('keydown',keyboardGrid);
  $('#importLevelButton').addEventListener('click',() => $('#levelSeedFile').click());
  $('#levelSeedFile').addEventListener('change',event => {
    const [file] = event.target.files || [];
    if (file) importLevelSeed(file);
    event.target.value = '';
  });
  $$('.tool-button').forEach(button => button.addEventListener('click',() => setTool(button.dataset.tool)));
  $$('.algorithm-option').forEach(button => button.addEventListener('click',() => {
    algorithm = button.dataset.algorithm;
    $$('.algorithm-option').forEach(item => { const selected = item === button; item.classList.toggle('is-selected',selected); item.setAttribute('aria-pressed',String(selected)); });
    $('#algorithmDescription').textContent = algorithms[algorithm].description;
    clearSearch(); renderGrid();
  }));
  $('#diagonalToggle').addEventListener('change',event => {
    diagonal = event.target.checked;
    $('#neighborMode').textContent = diagonal ? '8 направлений' : '4 направления';
    $('#diagonalHint').textContent = diagonal ? 'Шаг по диагонали стоит √2' : 'Движение по 4 соседям';
    clearSearch(); renderGrid();
  });
  $('#speedRange').addEventListener('input',event => { $('#speedValue').value = `×${event.target.value}`; $('#speedValue').textContent = `×${event.target.value}`; });
  $run.addEventListener('click',startRun);
  $pause.addEventListener('click',pauseRun);
  $step.addEventListener('click',singleStep);
  $('#compareButton').addEventListener('click',compareAlgorithms);
  $('#exportRouteButton').addEventListener('click',exportRoute);
  $('#exportReportButton').addEventListener('click',exportValidationReport);
  $('#clearBoard').addEventListener('click',clearBoard);
  $('#resetBoard').addEventListener('click',randomBoard);
  window.addEventListener('keydown',event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
  });

  setTool('wall');
  $('#algorithmDescription').textContent = algorithms[algorithm].description;
  renderGrid();
  updateMetrics(null);
})();
