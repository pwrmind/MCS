/* ============================================================
   MCS v3.0 — Single Page Application
   Плоская агрегация: contracts[], endpoints[], services[], connections[]
   ============================================================ */

const SVGNS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'mcs.architecture.v1';

const CONFIG = {
  SERVICE_HEADER_HEIGHT: 36,
  ENDPOINT_ROW_HEIGHT: 32,
  ENDPOINT_PADDING: 10,
  CONNECTOR_RADIUS: 6,
  CONNECTOR_OFFSET_X: 14,
  MIN_CURVE_DX: 60,
  MAX_LABEL_LENGTH: 26,
  GRID_SIZE: 24,
  DRAG_THRESHOLD_PX: 4,
  AUTOSAVE_DELAY_MS: 500
};

/* ---------- DEFAULT STATE ---------- */
function createDefaultState() {
  return {
    mcs_version: "3.0",
    system_name: "OnlineShop",
    metadata: {
      mode: "draft",
      gui_viewport: { zoom: 1, x: 0, y: 0 }
    },
    contracts: [
      { id: "LoginRequest",  fields: { email: "string", password: "string" } },
      { id: "AuthToken",     fields: { token: "string", expires_at: "datetime" } },
      { id: "ProductList",   fields: { items: "Product[]", total: "integer" } },
      { id: "OrderRequest",  fields: { user_id: "uuid", items: "array", total: "decimal" } },
      { id: "OrderCreated",  fields: { order_id: "uuid", user_id: "uuid", total: "decimal" } },
      { id: "PaymentResult", fields: { transaction_id: "string", status: "enum[OK,DECLINED]" } }
    ],
    endpoints: [
      { $class: "RestEndpoint", id: "ep_login", name: "Вход в систему",
        service_ref: "srv_auth",
        path: "/v1/auth/login", method: "POST",
        response: { status: 200, body_ref: "AuthToken" } },
      { $class: "RestEndpoint", id: "ep_products", name: "Каталог товаров",
        service_ref: "srv_catalog",
        path: "/v1/products", method: "GET",
        response: { status: 200, body_ref: "ProductList" } },
      { $class: "RestEndpoint", id: "ep_checkout", name: "Оформить заказ",
        service_ref: "srv_order",
        path: "/v1/orders", method: "POST",
        response: { status: 201, body_ref: "OrderCreated" } },
      { $class: "GrpcEndpoint", id: "ep_charge", name: "Списать оплату",
        service_ref: "srv_payment",
        package: "shop.payment.v1", service_name: "PaymentService", rpc_method: "Charge",
        response: { body_ref: "PaymentResult" } },
      { $class: "PubSubChannel", id: "ch_order_created", name: "События о заказах",
        service_ref: "srv_notification",
        topic_name: "orders.v1.created", broker_type: "kafka",
        message_schema_ref: "OrderCreated" }
    ],
    services: [
      { id: "srv_gateway",      name: "API Gateway",           gui: { x: 40,   y: 180, width: 240 } },
      { id: "srv_auth",         name: "Auth Service",          gui: { x: 40,   y: 440, width: 240 } },
      { id: "srv_catalog",      name: "Catalog Service",       gui: { x: 400,  y: 60,  width: 240 } },
      { id: "srv_order",        name: "Order Service",         gui: { x: 760,  y: 220, width: 260 } },
      { id: "srv_payment",      name: "Payment Service",       gui: { x: 1120, y: 80,  width: 260 } },
      { id: "srv_notification", name: "Notification Service",  gui: { x: 1120, y: 440, width: 260 } }
    ],
    connections: [
      { $class: "SyncRequestResponse", id: "conn_login", name: "Вход пользователя",
        source_ref: "srv_gateway", target_ref: "srv_auth", endpoint_ref: "ep_login",
        contract_mode: "strict", timeout_ms: 1000,
        retry_policy: { max_attempts: 1, backoff_factor: 1.0 }, gui: {} },
      { $class: "SyncRequestResponse", id: "conn_catalog", name: "Просмотр каталога",
        source_ref: "srv_gateway", target_ref: "srv_catalog", endpoint_ref: "ep_products",
        contract_mode: "strict", timeout_ms: 2000,
        retry_policy: { max_attempts: 3, backoff_factor: 1.5 }, gui: {} },
      { $class: "SyncRequestResponse", id: "conn_checkout", name: "Оформление заказа",
        source_ref: "srv_gateway", target_ref: "srv_order", endpoint_ref: "ep_checkout",
        contract_mode: "strict", timeout_ms: 5000,
        retry_policy: { max_attempts: 2, backoff_factor: 2.0 }, gui: {} },
      { $class: "SyncRequestResponse", id: "conn_payment", name: "Списание средств",
        source_ref: "srv_order", target_ref: "srv_payment", endpoint_ref: "ep_charge",
        contract_mode: "strict", timeout_ms: 10000,
        retry_policy: { max_attempts: 3, backoff_factor: 2.0 }, gui: {} },
      { $class: "AsyncFireAndForget", id: "conn_notify", name: "Уведомление о заказе",
        source_ref: "srv_order", target_ref: "srv_notification", endpoint_ref: "ch_order_created",
        contract_mode: "strict", delivery_guarantee: "at_least_once", gui: {} }
    ]
  };
}

/* ---------- STATE ---------- */
let state = createDefaultState();

/* ---------- SELECTION ---------- */
let selection = { type: null, id: null };

/* ---------- DOM REFS ---------- */
const domRefs = {
  svg: document.getElementById('canvas'),
  canvasWrap: document.getElementById('canvas-wrap'),
  jsonView: document.getElementById('json-view'),
  inspector: document.getElementById('inspector'),
  svcList: document.getElementById('svc-list'),
  connList: document.getElementById('conn-list'),
  contractList: document.getElementById('contract-list')
};

/* ============================================================
   HELPERS
   ============================================================ */

function truncateLabel(text, maxLength) {
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
}
function getEndpointLabel(ep) {
  return ep.path || ep.topic_name || ep.rpc_method || ep.name;
}
function getEndpointBadge(ep) {
  if (ep.$class === 'RestEndpoint') return ep.method;
  if (ep.$class === 'GrpcEndpoint') return 'gRPC';
  if (ep.$class === 'PubSubChannel') return 'PUB';
  return '';
}
function getConnectionBadge(conn) {
  if (conn.$class === 'SyncRequestResponse')  return { text: 'SYNC',   cls: 'sync' };
  if (conn.$class === 'AsyncFireAndForget')   return { text: 'ASYNC',  cls: 'async' };
  if (conn.$class === 'StreamingInteraction') return { text: 'STREAM', cls: 'stream' };
  return { text: 'CONN', cls: 'sync' };
}
function setNested(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function isIdUnique(pool, id, excludeId) {
  return !pool.some(x => x.id === id && x.id !== excludeId);
}
function snapToGrid(v) {
  return Math.round(v / CONFIG.GRID_SIZE) * CONFIG.GRID_SIZE;
}
function getEndpointRefsForService(srvId) {
  return state.endpoints
    .filter(e => e.service_ref === srvId)
    .map(e => e.id);
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Где используется контракт — возвращает массив читаемых ссылок. */
function findContractUsages(contractId) {
  const usages = [];
  state.endpoints.forEach(ep => {
    if (ep.response?.body_ref === contractId) {
      usages.push({ type: 'endpoint', id: ep.id, label: `${ep.id} · response` });
    }
    if (ep.message_schema_ref === contractId) {
      usages.push({ type: 'endpoint', id: ep.id, label: `${ep.id} · message schema` });
    }
  });
  state.connections.forEach(conn => {
    if (conn.response?.body_ref === contractId) {
      usages.push({ type: 'connection', id: conn.id, label: `${conn.id} · override response` });
    }
  });
  return usages;
}

/* ---------- SVG HELPER ---------- */
function createSVGElement(tag, attributes) {
  const element = document.createElementNS(SVGNS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'textContent') {
      element.textContent = value;
    } else {
      element.setAttribute(key, value);
    }
  }
  return element;
}

/* ============================================================
   RENDER: CANVAS
   ============================================================ */
function renderCanvas() {
  domRefs.svg.innerHTML = '';

  const wiresG = createSVGElement('g', { class: 'wires' });
  domRefs.svg.appendChild(wiresG);

  const nodesG = createSVGElement('g', { class: 'nodes' });
  domRefs.svg.appendChild(nodesG);

  state.services.forEach(srv => {
    const eps = state.endpoints.filter(e => e.service_ref === srv.id);
    const headerH = CONFIG.SERVICE_HEADER_HEIGHT;
    const rowH = CONFIG.ENDPOINT_ROW_HEIGHT;
    const totalH = headerH + eps.length * rowH + CONFIG.ENDPOINT_PADDING;

    srv._h = totalH;
    srv._rowH = rowH;
    srv._headerH = headerH;

    const g = createSVGElement('g', {
      transform: `translate(${srv.gui.x}, ${srv.gui.y})`,
      class: getServiceClass(srv),
      'data-svc-id': srv.id
    });

    g.appendChild(createSVGElement('rect', {
      width: srv.gui.width, height: totalH, rx: 10, class: 'service-rect'
    }));

    g.appendChild(createSVGElement('rect', {
      width: srv.gui.width, height: headerH, rx: 10,
      class: 'service-header', 'data-drag-service': srv.id
    }));

    g.appendChild(createSVGElement('text', {
      x: 14, y: 23, class: 'service-name', textContent: srv.name
    }));

    g.appendChild(createSVGElement('text', {
      x: srv.gui.width - 22, y: 23, 'text-anchor': 'end',
      class: 'service-id', textContent: srv.id
    }));

    g.appendChild(createSVGElement('line', {
      x1: 0, y1: headerH, x2: srv.gui.width, y2: headerH,
      stroke: 'var(--border)', 'stroke-width': 1
    }));

    g.appendChild(createSVGElement('circle', {
      cx: srv.gui.width, cy: headerH / 2, r: CONFIG.CONNECTOR_RADIUS,
      class: 'source-connector',
      'data-svc-id': srv.id,
      'data-source-connector': 'true'
    }));

    eps.forEach((ep, i) => {
      g.appendChild(createServiceEndpoint(ep, srv, headerH + i * rowH, rowH));
    });

    nodesG.appendChild(g);
  });

  state.connections.forEach(conn => renderWire(conn, wiresG));
  updateStats();
}

function getServiceClass(srv) {
  let className = 'service';
  if (selection.type === 'service' && selection.id === srv.id) className += ' selected';
  return className;
}

function createServiceEndpoint(ep, srv, y, rowH) {
  const isSelected = selection.type === 'endpoint' && selection.id === ep.id;
  const epG = createSVGElement('g', {
    transform: `translate(0, ${y})`,
    class: 'endpoint' + (isSelected ? ' selected' : ''),
    'data-ep-id': ep.id,
    'data-class': ep.$class
  });

  epG.appendChild(createSVGElement('rect', {
    x: 8, y: 3, width: srv.gui.width - 16, height: rowH - 6, rx: 5,
    class: `ep-rect ep-${ep.$class}`
  }));

  epG.appendChild(createSVGElement('text', {
    x: 20, y: rowH / 2 + 4, class: 'ep-method',
    textContent: getEndpointBadge(ep)
  }));

  epG.appendChild(createSVGElement('text', {
    x: 60, y: rowH / 2 + 4, class: 'ep-name',
    textContent: truncateLabel(getEndpointLabel(ep), CONFIG.MAX_LABEL_LENGTH)
  }));

  epG.appendChild(createSVGElement('circle', {
    cx: srv.gui.width - CONFIG.CONNECTOR_OFFSET_X,
    cy: rowH / 2, r: CONFIG.CONNECTOR_RADIUS, class: 'connector',
    'data-ep-id': ep.id, 'data-service-id': srv.id
  }));

  return epG;
}

/* ---------- RENDER: WIRE ---------- */
function renderWire(conn, group) {
  const src = state.services.find(s => s.id === conn.source_ref);
  if (!src) return;

  const sx = src.gui.x + src.gui.width;
  const sy = src.gui.y + src._headerH / 2;

  let tx, ty, free = false;
  const tgtSrv = state.services.find(s => s.id === conn.target_ref);
  const targetEp = conn.endpoint_ref ? state.endpoints.find(e => e.id === conn.endpoint_ref) : null;

  if (tgtSrv && targetEp) {
    const eps = state.endpoints.filter(e => e.service_ref === tgtSrv.id);
    const idx = eps.indexOf(targetEp);
    tx = tgtSrv.gui.x + tgtSrv.gui.width - CONFIG.CONNECTOR_OFFSET_X;
    ty = tgtSrv.gui.y + tgtSrv._headerH + idx * tgtSrv._rowH + tgtSrv._rowH / 2;
  } else if (tgtSrv) {
    tx = tgtSrv.gui.x;
    ty = tgtSrv.gui.y + tgtSrv._headerH / 2;
    free = true;
  } else if (conn.gui.free_target_pos) {
    tx = conn.gui.free_target_pos.x;
    ty = conn.gui.free_target_pos.y;
    free = true;
  } else {
    return;
  }

  const isSelected = selection.type === 'connection' && selection.id === conn.id;
  const isDraggingEnd = dragWireEnd && dragWireEnd.conn.id === conn.id;
  const dx = Math.max(CONFIG.MIN_CURVE_DX, Math.abs(tx - sx) * 0.5);

  const path = createSVGElement('path', {
    d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
    class: getWireClass(conn, isSelected),
    'data-conn-id': conn.id
  });
  path.style.stroke = getWireColor(conn, targetEp);
  group.appendChild(path);

  if (free) {
    const circle = createSVGElement('circle', {
      cx: tx, cy: ty, r: CONFIG.CONNECTOR_RADIUS,
      class: 'wire-end free' + (isDraggingEnd ? ' dragging' : ''),
      'data-conn-id': conn.id, 'data-end': 'target'
    });
    if (isDraggingEnd) circle.style.pointerEvents = 'none';
    group.appendChild(circle);
  }
}

function getWireClass(conn, isSelected) {
  const classes = ['wire'];
  if (conn.contract_mode === 'override') classes.push('override');
  if (isSelected) classes.push('selected');
  return classes.join(' ');
}

function getWireColor(conn, ep) {
  if (conn.contract_mode === 'override') return 'var(--warn)';
  if (!ep) return 'var(--warn)';
  if (ep.$class === 'GrpcEndpoint') return 'var(--grpc)';
  if (ep.$class === 'PubSubChannel') return 'var(--kafka)';
  return 'var(--accent)';
}

/* ---------- SIDEBAR: services + contracts ---------- */
function renderSidebar() {
  document.getElementById('svc-count').textContent = state.services.length;
  document.getElementById('conn-count').textContent = state.connections.length;
  document.getElementById('contract-count').textContent = state.contracts.length;

  domRefs.svcList.innerHTML = state.services.map(s =>
    `<div class="svc-list-item${selection.type==='service'&&selection.id===s.id?' selected':''}" data-svc-id="${s.id}">
      <span class="svc-dot"></span>
      <span>${escapeHtml(s.name)}</span>
      <span class="svc-list-id">${escapeHtml(s.id)}</span>
    </div>`
  ).join('');

  domRefs.contractList.innerHTML = state.contracts.map(c => {
    const isSelected = selection.type === 'contract' && selection.id === c.id;
    return `<div class="contract-item${isSelected?' selected':''}" data-contract="${c.id}">
      <div class="contract-id">${escapeHtml(c.id)}</div>
      <div class="contract-fields">
        ${Object.entries(c.fields).map(([k,v]) => `<span class="field-chip">${escapeHtml(k)}: ${escapeHtml(v)}</span>`).join('') || '<span style="color:var(--muted);font-size:10px;">пусто</span>'}
      </div>
    </div>`;
  }).join('');
}

/* ---------- SIDEBAR: connections ---------- */
function renderConnectionsList() {
  if (!domRefs.connList) return;

  domRefs.connList.innerHTML = state.connections.map(c => {
    const badge = getConnectionBadge(c);
    const isSelected = selection.type === 'connection' && selection.id === c.id;
    const modeCls = c.contract_mode === 'override' ? 'override' : 'strict';

    const targetHtml = c.target_ref
      ? `<span class="tgt">${escapeHtml(c.target_ref)}</span>`
      : `<span class="free">— повисла —</span>`;

    const epHtml = c.endpoint_ref
      ? `<span class="conn-ep">${escapeHtml(c.endpoint_ref)}</span>`
      : `<span class="conn-ep free">null</span>`;

    const cls = ['conn-list-item', badge.cls];
    if (isSelected) cls.push('selected');
    if (c.contract_mode === 'override') cls.push('override');

    return `
      <div class="${cls.join(' ')}" data-conn-id="${c.id}">
        <div class="conn-head">
          <span class="conn-class-badge ${badge.cls}">${badge.text}</span>
          <span class="conn-name">${escapeHtml(c.name)}</span>
        </div>
        <div class="conn-route">
          <span class="src">${escapeHtml(c.source_ref || '—')}</span>
          <span class="arr">→</span>
          ${targetHtml}
        </div>
        <div class="conn-meta">
          ${epHtml}
          <span class="conn-mode ${modeCls}">${c.contract_mode}</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ---------- JSON VIEW ---------- */
function buildCleanState() {
  return {
    mcs_version: state.mcs_version,
    system_name: state.system_name,
    metadata: state.metadata,
    contracts: state.contracts,
    endpoints: state.endpoints,     // ← как есть, с service_ref
    services: state.services.map(s => ({
      id: s.id,
      name: s.name,
      gui: { x: s.gui.x, y: s.gui.y, width: s.gui.width }
    })),
    connections: state.connections
  };
}

function renderJSON() {
  domRefs.jsonView.innerHTML = syntaxHighlight(JSON.stringify(buildCleanState(), null, 2));
}

function syntaxHighlight(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-str">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');
}

/* ============================================================
   INSPECTOR
   ============================================================ */

function renderInspector() {
  if (selection.type === 'service') {
    renderServiceInspector();
  } else if (selection.type === 'endpoint') {
    renderEndpointInspector();
  } else if (selection.type === 'connection') {
    renderConnectionInspector();
  } else if (selection.type === 'contract') {
    renderContractInspector();
  } else {
    domRefs.inspector.innerHTML = `<div style="color:var(--muted); font-size:12px; text-align:center; padding:20px 0;">
      Выберите сервис, эндпоинт, связь или контракт
    </div>`;
  }
}

function renderServiceInspector() {
  const s = state.services.find(x => x.id === selection.id);
  if (!s) return;
  const eps = state.endpoints.filter(e => e.service_ref === s.id);

  domRefs.inspector.innerHTML = `
    <div class="form-row">
      <label class="form-label">Имя сервиса</label>
      <input class="form-input" value="${escapeHtml(s.name)}" data-svc-field="name">
    </div>
    <div class="form-row">
      <label class="form-label">Идентификатор</label>
      <input class="form-input mono" value="${escapeHtml(s.id)}" data-svc-field="id">
    </div>
    <div class="form-row">
      <label class="form-label">Эндпоинты (${eps.length})</label>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${eps.map(e => `
          <span class="field-chip" style="background:var(--panel-2);border:1px solid var(--border-2);padding:3px 8px;cursor:pointer;"
                data-inspect-ep="${e.id}">
            ${escapeHtml(getEndpointLabel(e))}
          </span>`).join('') || '<span style="color:var(--muted);font-size:11px;">нет</span>'}
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">GUI координаты</label>
      <div class="form-input mono" style="display:flex;gap:10px;">
        <span>x: ${s.gui.x}</span><span>y: ${s.gui.y}</span><span>w: ${s.gui.width}</span>
      </div>
    </div>
    <button class="form-input danger-btn" data-action="delete-service" data-id="${escapeHtml(s.id)}">Удалить сервис</button>
  `;

  domRefs.inspector.querySelectorAll('[data-svc-field]').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.svcField;
      const v = el.value.trim();
      if (!v) { renderAll(); return; }

      if (f === 'name') {
        s.name = v;
      } else if (f === 'id') {
        if (v === s.id) return;
        if (!isIdUnique(state.services, v, s.id)) {
          alert(`Идентификатор "${v}" уже используется другим сервисом`);
          renderAll();
          return;
        }
        const oldId = s.id;
        s.id = v;
        state.endpoints.forEach(e => { if (e.service_ref === oldId) e.service_ref = v; });
        state.connections.forEach(c => {
          if (c.source_ref === oldId) c.source_ref = v;
          if (c.target_ref === oldId) c.target_ref = v;
        });
        selection.id = v;
      }
      renderAll();
    });
  });

  domRefs.inspector.querySelectorAll('[data-inspect-ep]').forEach(el => {
    el.addEventListener('click', () => {
      selection = { type: 'endpoint', id: el.dataset.inspectEp };
      renderAll();
    });
  });
}

function renderEndpointInspector() {
  const ep = state.endpoints.find(x => x.id === selection.id);
  if (!ep) return;

  let classFields = '';
  if (ep.$class === 'RestEndpoint') {
    classFields = `
      <div class="form-row">
        <label class="form-label">Path</label>
        <input class="form-input mono" value="${escapeHtml(ep.path || '')}" data-ep-field="path">
      </div>
      <div class="form-row">
        <label class="form-label">HTTP Method</label>
        <select class="form-select mono" data-ep-field="method">
          ${['GET','POST','PUT','DELETE','PATCH'].map(m =>
            `<option ${ep.method === m ? 'selected' : ''}>${m}</option>`
          ).join('')}
        </select>
      </div>
    `;
  } else if (ep.$class === 'GrpcEndpoint') {
    classFields = `
      <div class="form-row">
        <label class="form-label">Package</label>
        <input class="form-input mono" value="${escapeHtml(ep.package || '')}" data-ep-field="package">
      </div>
      <div class="form-row">
        <label class="form-label">Service Name</label>
        <input class="form-input mono" value="${escapeHtml(ep.service_name || '')}" data-ep-field="service_name">
      </div>
      <div class="form-row">
        <label class="form-label">RPC Method</label>
        <input class="form-input mono" value="${escapeHtml(ep.rpc_method || '')}" data-ep-field="rpc_method">
      </div>
    `;
  } else if (ep.$class === 'PubSubChannel') {
    classFields = `
      <div class="form-row">
        <label class="form-label">Topic Name</label>
        <input class="form-input mono" value="${escapeHtml(ep.topic_name || '')}" data-ep-field="topic_name">
      </div>
      <div class="form-row">
        <label class="form-label">Broker Type</label>
        <select class="form-select mono" data-ep-field="broker_type">
          <option ${ep.broker_type === 'kafka' ? 'selected' : ''}>kafka</option>
          <option ${ep.broker_type === 'rabbitmq' ? 'selected' : ''}>rabbitmq</option>
        </select>
      </div>
    `;
  }

  let contractHtml = '';
  if (ep.$class === 'PubSubChannel') {
    contractHtml = `
      <div class="form-row">
        <label class="form-label">Message Schema</label>
        <select class="form-select mono" data-ep-field="message_schema_ref">
          <option value="">— не выбрано —</option>
          ${state.contracts.map(c =>
            `<option value="${c.id}" ${ep.message_schema_ref === c.id ? 'selected' : ''}>${escapeHtml(c.id)}</option>`
          ).join('')}
        </select>
      </div>
    `;
  } else {
    const bodyRef = ep.response?.body_ref || '';
    const status  = ep.response?.status;
    contractHtml = `
      ${status !== undefined ? `
      <div class="form-row">
        <label class="form-label">Response Status</label>
        <input class="form-input mono" type="number" value="${status}" data-ep-field="response.status">
      </div>` : ''}
      <div class="form-row">
        <label class="form-label">Response Contract</label>
        <select class="form-select mono" data-ep-field="response.body_ref">
          <option value="">— не выбрано —</option>
          ${state.contracts.map(c =>
            `<option value="${c.id}" ${bodyRef === c.id ? 'selected' : ''}>${escapeHtml(c.id)}</option>`
          ).join('')}
        </select>
      </div>
    `;
  }

  const svcOptions = state.services.map(s =>
    `<option value="${s.id}" ${ep.service_ref === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`
  ).join('');

  domRefs.inspector.innerHTML = `
    <div class="form-row">
      <label class="form-label">Класс</label>
      <input class="form-input mono" value="${escapeHtml(ep.$class)}" readonly>
    </div>
    <div class="form-row">
      <label class="form-label">Имя эндпоинта</label>
      <input class="form-input" value="${escapeHtml(ep.name || '')}" data-ep-field="name">
    </div>
    <div class="form-row">
      <label class="form-label">Идентификатор</label>
      <input class="form-input mono" value="${escapeHtml(ep.id)}" data-ep-field="id">
    </div>
    <div class="form-row">
      <label class="form-label">Принадлежит сервису</label>
      <select class="form-select mono" data-ep-field="service_ref">${svcOptions}</select>
    </div>
    ${classFields}
    ${contractHtml}
    <button class="form-input danger-btn" data-action="delete-endpoint" data-id="${escapeHtml(ep.id)}">Удалить эндпоинт</button>
  `;

  domRefs.inspector.querySelectorAll('[data-ep-field]').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.epField;
      let v = el.value;
      if (v === '') v = null;
      if (el.type === 'number' && v !== null) v = +v;

      if (f === 'id') {
        if (!v || v === ep.id) { renderAll(); return; }
        if (!isIdUnique(state.endpoints, v, ep.id)) {
          alert(`Идентификатор "${v}" уже используется другим эндпоинтом`);
          renderAll();
          return;
        }
        const oldId = ep.id;
        ep.id = v;
        state.connections.forEach(c => { if (c.endpoint_ref === oldId) c.endpoint_ref = v; });
        selection.id = v;
        renderAll();
        return;
      }

      setNested(ep, f, v);
      renderAll();
    });
  });
}

function renderConnectionInspector() {
  const c = state.connections.find(x => x.id === selection.id);
  if (!c) return;
  const isOverride = c.contract_mode === 'override';

  const classOptions = [
    'SyncRequestResponse',
    'AsyncFireAndForget',
    'StreamingInteraction'
  ].map(cls => `<option value="${cls}" ${c.$class === cls ? 'selected' : ''}>${cls}</option>`).join('');

  const sourceOptions = state.services.map(s =>
    `<option value="${s.id}" ${c.source_ref === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`
  ).join('');

  const targetOptions = `<option value="">— не выбрано (повисла) —</option>` +
    state.services.map(s =>
      `<option value="${s.id}" ${c.target_ref === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`
    ).join('');

  const endpointOptions = `<option value="">— не выбрано —</option>` +
    state.endpoints
      .filter(e => !c.target_ref || e.service_ref === c.target_ref)
      .map(e => `<option value="${e.id}" ${c.endpoint_ref === e.id ? 'selected' : ''}>${escapeHtml(e.id)} · ${escapeHtml(getEndpointLabel(e))}</option>`)
      .join('');

  domRefs.inspector.innerHTML = `
    <div class="form-row">
      <label class="form-label">Название сценария</label>
      <input class="form-input" value="${escapeHtml(c.name)}" data-conn-field="name">
    </div>
    <div class="form-row">
      <label class="form-label">Класс взаимодействия</label>
      <select class="form-select mono" data-conn-field="$class">${classOptions}</select>
    </div>
    <div class="form-row">
      <label class="form-label">source_ref</label>
      <select class="form-select mono" data-conn-field="source_ref">${sourceOptions}</select>
    </div>
    <div class="form-row">
      <label class="form-label">target_ref</label>
      <select class="form-select mono" data-conn-field="target_ref">${targetOptions}</select>
    </div>
    <div class="form-row">
      <label class="form-label">endpoint_ref</label>
      <select class="form-select mono" data-conn-field="endpoint_ref">${endpointOptions}</select>
    </div>
    <div class="form-row">
      <label class="form-label">Режим контракта</label>
      <div class="contract-mode">
        <button data-mode="strict" class="${!isOverride?'active':''}">strict</button>
        <button data-mode="override" class="${isOverride?'active':''}">override</button>
      </div>
    </div>
    ${c.timeout_ms !== undefined ? `
    <div class="form-row">
      <label class="form-label">Timeout (ms)</label>
      <input class="form-input" type="number" value="${c.timeout_ms}" data-conn-field="timeout_ms">
    </div>` : ''}
    ${c.retry_policy ? `
    <div class="form-row">
      <label class="form-label">Retry policy</label>
      <div class="form-input mono" style="font-size:11px;">max_attempts: ${c.retry_policy.max_attempts}, backoff: ${c.retry_policy.backoff_factor}</div>
    </div>` : ''}
    ${c.delivery_guarantee ? `
    <div class="form-row">
      <label class="form-label">Delivery guarantee</label>
      <div class="form-input mono" style="font-size:11px;">${escapeHtml(c.delivery_guarantee)}</div>
    </div>` : ''}
    ${isOverride ? `
    <div class="form-row">
      <label class="form-label">Переопределённый response</label>
      <div class="form-input mono" style="font-size:11px; color:var(--warn);">${escapeHtml(JSON.stringify(c.response))}</div>
    </div>` : ''}
    <button class="form-input danger-btn" data-action="delete-connection" data-id="${escapeHtml(c.id)}">Удалить связь явно</button>
  `;

  domRefs.inspector.querySelectorAll('[data-conn-field]').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.connField;
      let v = el.value;
      if (v === '') v = null;
      if (f === 'timeout_ms') v = +v;

      c[f] = v;

      if (f === 'target_ref' && c.endpoint_ref) {
        const ep = state.endpoints.find(e => e.id === c.endpoint_ref);
        if (!ep || (c.target_ref && ep.service_ref !== c.target_ref)) {
          c.endpoint_ref = null;
        }
      }

      if (f === 'source_ref') {
        delete c.gui.free_target_pos;
      }

      renderAll();
    });
  });

  domRefs.inspector.querySelectorAll('.contract-mode button').forEach(b => {
    b.addEventListener('click', () => {
      c.contract_mode = b.dataset.mode;
      if (c.contract_mode === 'override' && !c.response) {
        c.response = { status: 200, body_ref: state.contracts[0]?.id || "" };
      }
      renderAll();
    });
  });
}

/* ---------- Contract inspector (NEW) ---------- */

function renderContractInspector() {
  const ct = state.contracts.find(x => x.id === selection.id);
  if (!ct) return;

  const fieldNames = Object.keys(ct.fields);
  const usages = findContractUsages(ct.id);

  const fieldRows = fieldNames.map(name => `
    <div class="field-row">
      <input class="form-input mono field-name"
             value="${escapeHtml(name)}"
             data-field-old="${escapeHtml(name)}"
             data-field-part="name">
      <input class="form-input mono field-type"
             value="${escapeHtml(ct.fields[name])}"
             data-field-old="${escapeHtml(name)}"
             data-field-part="type">
      <button class="field-remove"
              data-field-remove="${escapeHtml(name)}"
              title="Удалить поле">×</button>
    </div>
  `).join('');

  domRefs.inspector.innerHTML = `
    <div class="form-row">
      <label class="form-label">Идентификатор контракта</label>
      <input class="form-input mono" value="${escapeHtml(ct.id)}" data-contract-field="id">
    </div>

    <div class="form-row">
      <label class="form-label">Поля (${fieldNames.length})</label>
      <div class="field-list">
        ${fieldRows || '<div style="color:var(--muted);font-size:11px;padding:4px 0;">нет полей</div>'}
      </div>
      <button class="form-input add-field-btn" data-field-add>+ Добавить поле</button>
    </div>

    <div class="form-row">
      <label class="form-label">Используется в (${usages.length})</label>
      <div class="usage-list">
        ${usages.length
          ? usages.map(u => `
              <div class="usage-item" data-usage-type="${u.type}" data-usage-id="${escapeHtml(u.id)}">
                <span class="usage-type usage-${u.type}">${u.type === 'endpoint' ? 'EP' : 'CONN'}</span>
                <span class="usage-label">${escapeHtml(u.label)}</span>
              </div>
            `).join('')
          : '<div style="color:var(--muted);font-size:11px;padding:4px 0;">нигде не используется</div>'}
      </div>
    </div>

    <button class="form-input danger-btn" data-action="delete-contract" data-id="${escapeHtml(ct.id)}">Удалить контракт</button>
  `;

  // --- Rename id (with cascade into endpoints / connections) ---
  const idEl = domRefs.inspector.querySelector('[data-contract-field="id"]');
  idEl?.addEventListener('change', () => {
    const v = idEl.value.trim();
    if (!v || v === ct.id) { renderAll(); return; }
    if (!isIdUnique(state.contracts, v, ct.id)) {
      alert(`Идентификатор "${v}" уже используется другим контрактом`);
      renderAll();
      return;
    }
    const oldId = ct.id;
    ct.id = v;
    state.endpoints.forEach(ep => {
      if (ep.response?.body_ref === oldId) ep.response.body_ref = v;
      if (ep.message_schema_ref === oldId) ep.message_schema_ref = v;
    });
    state.connections.forEach(conn => {
      if (conn.response?.body_ref === oldId) conn.response.body_ref = v;
    });
    selection.id = v;
    renderAll();
  });

  // --- Edit field name / type ---
  domRefs.inspector.querySelectorAll('[data-field-part]').forEach(el => {
    el.addEventListener('change', () => {
      const oldName = el.dataset.fieldOld;
      const part = el.dataset.fieldPart;
      if (!(oldName in ct.fields)) { renderAll(); return; }

      const newVal = el.value.trim();
      if (part === 'name') {
        if (!newVal) { renderAll(); return; }
        if (newVal !== oldName && newVal in ct.fields) {
          alert(`Поле "${newVal}" уже существует в этом контракте`);
          renderAll();
          return;
        }
        // Rebuild fields, preserving order
        const rebuilt = {};
        for (const [k, v] of Object.entries(ct.fields)) {
          if (k === oldName) rebuilt[newVal] = v;
          else rebuilt[k] = v;
        }
        ct.fields = rebuilt;
      } else {
        ct.fields[oldName] = newVal || 'any';
      }
      renderAll();
    });
  });

  // --- Remove field ---
  domRefs.inspector.querySelectorAll('[data-field-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.fieldRemove;
      delete ct.fields[name];
      renderAll();
    });
  });

  // --- Add field ---
  const addBtn = domRefs.inspector.querySelector('[data-field-add]');
  addBtn?.addEventListener('click', () => {
    let n = 1;
    let key = 'new_field';
    while (key in ct.fields) key = 'new_field_' + (n++);
    ct.fields[key] = 'string';
    renderAll();
  });

  // --- Jump to usage ---
  domRefs.inspector.querySelectorAll('[data-usage-type]').forEach(el => {
    el.addEventListener('click', () => {
      selection = { type: el.dataset.usageType, id: el.dataset.usageId };
      renderAll();
    });
  });
}

/* ---------- Delete handlers ---------- */
function deleteService(id) {
  state.services = state.services.filter(s => s.id !== id);
  state.endpoints = state.endpoints.filter(e => e.service_ref !== id);
  state.connections = state.connections.filter(c => c.source_ref !== id && c.target_ref !== id);
  selection = { type: null, id: null };
  renderAll();
}
function deleteConnection(id) {
  state.connections = state.connections.filter(c => c.id !== id);
  selection = { type: null, id: null };
  renderAll();
}
function deleteEndpoint(id) {
  state.endpoints = state.endpoints.filter(e => e.id !== id);
  state.connections.forEach(c => {
    if (c.endpoint_ref === id) c.endpoint_ref = null;
  });
  selection = { type: null, id: null };
  renderAll();
}
function deleteContract(id) {
  state.contracts = state.contracts.filter(c => c.id !== id);
  // Nullify references, don't touch the object itself
  state.endpoints.forEach(ep => {
    if (ep.response?.body_ref === id) ep.response.body_ref = null;
    if (ep.message_schema_ref === id) ep.message_schema_ref = null;
  });
  state.connections.forEach(conn => {
    if (conn.response?.body_ref === id) conn.response.body_ref = null;
  });
  selection = { type: null, id: null };
  renderAll();
}

/* ---------- STATS ---------- */
function updateStats() {
  document.getElementById('stat-nodes').textContent =
    state.services.length + state.endpoints.length;
  document.getElementById('stat-links').textContent =
    state.connections.filter(c => c.source_ref && c.target_ref && c.endpoint_ref).length;
  document.getElementById('stat-free').textContent =
    state.connections.filter(c => !c.source_ref || !c.target_ref || !c.endpoint_ref).length;

  const statusEl = document.getElementById('stat-status');
  const freeCount = state.connections.filter(c => !c.source_ref || !c.target_ref || !c.endpoint_ref).length;
  if (state.metadata.mode === 'draft') {
    statusEl.className = 'status-draft';
    statusEl.textContent = freeCount > 0 ? `Черновик (${freeCount} повисших)` : 'Черновик';
  } else {
    if (freeCount > 0) {
      statusEl.className = 'status-draft';
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `Ошибка: ${freeCount} повисших нитей`;
    } else {
      statusEl.className = 'status-ok';
      statusEl.style.color = '';
      statusEl.textContent = 'Норма';
    }
  }
}

/* ---------- RENDER ALL + AUTOSAVE ---------- */
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToLocalStorage, CONFIG.AUTOSAVE_DELAY_MS);
}

function renderAll() {
  renderSidebar();
  renderConnectionsList();
  renderCanvas();
  renderInspector();
  renderJSON();
  scheduleSave();
}

/* ============================================================
   PERSISTENCE: localStorage + Export/Import
   ============================================================ */

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildCleanState()));
  } catch (e) {
    console.warn('Autosave failed:', e);
  }
}

function loadStateFromObject(parsed) {
  state.mcs_version = parsed.mcs_version || "3.0";
  state.system_name = parsed.system_name || "Untitled";
  state.metadata   = parsed.metadata   || { mode: "draft", gui_viewport: { zoom: 1, x: 0, y: 0 } };
  state.contracts  = Array.isArray(parsed.contracts)  ? parsed.contracts  : [];
  state.endpoints  = Array.isArray(parsed.endpoints)  ? parsed.endpoints  : [];
  state.services   = Array.isArray(parsed.services)   ? parsed.services.map(s => ({
    id: s.id,
    name: s.name || s.id,
    gui: s.gui || { x: 100, y: 100, width: 240 }
  })) : [];
  state.connections = Array.isArray(parsed.connections) ? parsed.connections : [];
  selection = { type: null, id: null };

  // MIGRATION: восстановить service_ref из services[].endpoint_refs
  // для файлов, сохранённых до исправления buildCleanState().
  const missing = state.endpoints.filter(ep => !ep.service_ref);
  if (missing.length > 0 && Array.isArray(parsed.services)) {
    parsed.services.forEach(s => {
      const refs = Array.isArray(s.endpoint_refs) ? s.endpoint_refs : [];
      refs.forEach(epId => {
        const ep = state.endpoints.find(e => e.id === epId);
        if (ep && !ep.service_ref) ep.service_ref = s.id;
      });
    });
  }
}

function tryLoadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    loadStateFromObject(parsed);
    return true;
  } catch (e) {
    console.warn('localStorage load failed:', e);
    return false;
  }
}

function exportToFile() {
  const clean = buildCleanState();
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.system_name || 'architecture'}.mcs.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.mcs.json,application/json';
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        loadStateFromObject(parsed);
        renderAll();
      } catch (err) {
        alert('Не удалось загрузить файл: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function resetToDefault() {
  if (!confirm('Сбросить текущую архитектуру и загрузить пример?')) return;
  state = createDefaultState();
  selection = { type: null, id: null };
  renderAll();
}

/* ============================================================
   EVENT DELEGATION: data-action
   ============================================================ */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'delete-service')    deleteService(id);
  if (action === 'delete-endpoint')   deleteEndpoint(id);
  if (action === 'delete-connection') deleteConnection(id);
  if (action === 'delete-contract')   deleteContract(id);
});

/* ============================================================
   INTERACTION: HIT-TEST HELPERS
   ============================================================ */

function findConnectorAt(clientX, clientY) {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (el.classList && el.classList.contains('connector')) return el;
  }
  return null;
}

/* ============================================================
   INTERACTION: SELECT + DRAG SERVICES + DRAG WIRE ENDS + SOURCE PLUG
   ============================================================ */
let dragSvc = null;
let dragWireEnd = null;
let pendingSourceDrag = null;

domRefs.svg.addEventListener('mousedown', (e) => {
  const target = e.target;

  if (target.classList.contains('source-connector')) {
    pendingSourceDrag = {
      svcId: target.dataset.svcId,
      startX: e.clientX,
      startY: e.clientY
    };
    e.preventDefault();
    return;
  }

  if (target.classList.contains('wire-end') && target.classList.contains('free')) {
    const conn = state.connections.find(c => c.id === target.dataset.connId);
    if (!conn) return;

    selection = { type: 'connection', id: conn.id };

    const svgRect = domRefs.svg.getBoundingClientRect();
    const mx = e.clientX - svgRect.left;
    const my = e.clientY - svgRect.top;
    const curX = conn.gui.free_target_pos?.x ?? mx;
    const curY = conn.gui.free_target_pos?.y ?? my;

    conn.target_ref = null;
    conn.endpoint_ref = null;
    conn.gui.free_target_pos = { x: curX, y: curY };

    dragWireEnd = { conn, offsetX: mx - curX, offsetY: my - curY };
    e.preventDefault();
    renderAll();
    return;
  }

  if (target.dataset.dragService) {
    const srv = state.services.find(s => s.id === target.dataset.dragService);
    if (!srv) return;

    selection = { type: 'service', id: srv.id };
    renderAll();

    const svgRect = domRefs.svg.getBoundingClientRect();
    dragSvc = {
      srv,
      offsetX: e.clientX - svgRect.left - srv.gui.x,
      offsetY: e.clientY - svgRect.top  - srv.gui.y
    };
    e.preventDefault();
    return;
  }

  if (target.dataset.connId) {
    selection = { type: 'connection', id: target.dataset.connId };
    renderAll();
    e.preventDefault();
    return;
  }

  const epG = target.closest('.endpoint');
  if (epG) {
    selection = { type: 'endpoint', id: epG.dataset.epId };
    renderAll();
    return;
  }

  const svcG = target.closest('.service');
  if (svcG) {
    selection = { type: 'service', id: svcG.dataset.svcId };
    renderAll();
    return;
  }

  selection = { type: null, id: null };
  renderAll();
});

document.addEventListener('mousemove', (e) => {
  if (pendingSourceDrag) {
    const dx = Math.abs(e.clientX - pendingSourceDrag.startX);
    const dy = Math.abs(e.clientY - pendingSourceDrag.startY);
    if (dx < CONFIG.DRAG_THRESHOLD_PX && dy < CONFIG.DRAG_THRESHOLD_PX) return;

    const srv = state.services.find(s => s.id === pendingSourceDrag.svcId);
    if (srv) {
      const id = 'conn_new_' + Date.now().toString(36).slice(-4);
      const svgRect = domRefs.svg.getBoundingClientRect();
      const mx = e.clientX - svgRect.left;
      const my = e.clientY - svgRect.top;

      const newConn = {
        $class: 'SyncRequestResponse',
        id,
        name: 'Новая связь',
        source_ref: srv.id,
        target_ref: null,
        endpoint_ref: null,
        contract_mode: 'strict',
        timeout_ms: 1000,
        retry_policy: { max_attempts: 1, backoff_factor: 1.0 },
        gui: { free_target_pos: { x: mx, y: my } }
      };
      state.connections.push(newConn);
      selection = { type: 'connection', id };
      dragWireEnd = { conn: newConn, offsetX: 0, offsetY: 0 };
      pendingSourceDrag = null;
      renderAll();
    } else {
      pendingSourceDrag = null;
    }
  }

  if (dragWireEnd) {
    const svgRect = domRefs.svg.getBoundingClientRect();
    const mx = e.clientX - svgRect.left;
    const my = e.clientY - svgRect.top;

    dragWireEnd.conn.gui.free_target_pos = {
      x: mx - dragWireEnd.offsetX,
      y: my - dragWireEnd.offsetY
    };

    renderCanvas();

    const hovered = findConnectorAt(e.clientX, e.clientY);
    if (hovered) hovered.classList.add('target-hover');
    return;
  }

  if (dragSvc) {
    const svgRect = domRefs.svg.getBoundingClientRect();
    dragSvc.srv.gui.x = Math.max(0, e.clientX - svgRect.left - dragSvc.offsetX);
    dragSvc.srv.gui.y = Math.max(0, e.clientY - svgRect.top  - dragSvc.offsetY);
    renderCanvas();
    renderJSON();
  }
});

document.addEventListener('mouseup', (e) => {
  if (pendingSourceDrag) {
    pendingSourceDrag = null;
    return;
  }

  if (dragWireEnd) {
    const conn = dragWireEnd.conn;
    const hovered = findConnectorAt(e.clientX, e.clientY);

    if (hovered) {
      const epId  = hovered.dataset.epId;
      const svcId = hovered.dataset.serviceId;
      const ep = state.endpoints.find(x => x.id === epId);
      if (ep && svcId) {
        conn.target_ref = svcId;
        conn.endpoint_ref = epId;
        delete conn.gui.free_target_pos;
      }
    }

    dragWireEnd = null;
    renderAll();
    return;
  }

  if (dragSvc) {
    dragSvc.srv.gui.x = snapToGrid(dragSvc.srv.gui.x);
    dragSvc.srv.gui.y = snapToGrid(dragSvc.srv.gui.y);
    dragSvc = null;
    renderCanvas();
    renderJSON();
    scheduleSave();
  }
});

/* ============================================================
   INTERACTION: PALETTE
   ============================================================ */
let newEndpointCounter = 1;
document.querySelectorAll('[data-add]').forEach(el => {
  el.addEventListener('click', () => {
    const type = el.dataset.add;

    if (type === 'service') {
      const id = 'srv_new_' + Date.now().toString(36).slice(-4);
      state.services.push({
        id, name: 'New Service',
        gui: { x: 100 + Math.random() * 400, y: 400 + Math.random() * 200, width: 240 }
      });
      selection = { type: 'service', id };
    }
    else if (type === 'rest' || type === 'grpc' || type === 'kafka') {
      const srvId =
        (selection.type === 'service' && state.services.find(s => s.id === selection.id)?.id) ||
        (selection.type === 'endpoint' && state.endpoints.find(e => e.id === selection.id)?.service_ref) ||
        state.services[0]?.id;
      if (!srvId) return;

      let newEp;
      if (type === 'rest') {
        newEp = {
          $class: 'RestEndpoint', id: 'ep_new_rest_' + (newEndpointCounter++), name: 'New Endpoint',
          service_ref: srvId, path: '/v1/new',
          method: 'GET', response: { status: 200, body_ref: state.contracts[0]?.id || '' }
        };
      } else if (type === 'grpc') {
        newEp = {
          $class: 'GrpcEndpoint', id: 'ep_new_grpc_' + (newEndpointCounter++), name: 'New RPC',
          service_ref: srvId, package: 'pkg.v1', service_name: 'Svc', rpc_method: 'Call',
          response: { body_ref: state.contracts[0]?.id || '' }
        };
      } else {
        newEp = {
          $class: 'PubSubChannel', id: 'ch_new_' + (newEndpointCounter++), name: 'New Topic',
          service_ref: srvId, topic_name: 'new.events.v1',
          broker_type: 'kafka', message_schema_ref: state.contracts[0]?.id || ''
        };
      }
      state.endpoints.push(newEp);
      selection = { type: 'endpoint', id: newEp.id };
    }
    else if (type === 'connection') {
      const srcSrv =
        (selection.type === 'service' && state.services.find(s => s.id === selection.id)) ||
        state.services[0];
      if (!srcSrv) {
        alert('Сначала создайте хотя бы один сервис');
        return;
      }
      const id = 'conn_new_' + Date.now().toString(36).slice(-4);
      state.connections.push({
        $class: 'SyncRequestResponse',
        id,
        name: 'Новая связь',
        source_ref: srcSrv.id,
        target_ref: null,
        endpoint_ref: null,
        contract_mode: 'strict',
        timeout_ms: 1000,
        retry_policy: { max_attempts: 1, backoff_factor: 1.0 },
        gui: { free_target_pos: { x: srcSrv.gui.x + 420, y: srcSrv.gui.y + 180 } }
      });
      selection = { type: 'connection', id };
    }

    renderAll();
  });
});

/* ============================================================
   MODE TOGGLE
   ============================================================ */
document.getElementById('btn-draft').addEventListener('click', () => {
  state.metadata.mode = 'draft';
  document.getElementById('btn-draft').classList.add('active');
  document.getElementById('btn-locked').classList.remove('active');
  updateStats(); renderJSON(); scheduleSave();
});
document.getElementById('btn-locked').addEventListener('click', () => {
  state.metadata.mode = 'locked';
  document.getElementById('btn-locked').classList.add('active');
  document.getElementById('btn-draft').classList.remove('active');
  updateStats(); renderJSON(); scheduleSave();
});

/* ============================================================
   SIDEBAR CLICKS
   ============================================================ */
domRefs.svcList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-svc-id]');
  if (!item) return;
  selection = { type: 'service', id: item.dataset.svcId };
  renderAll();
});

domRefs.connList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-conn-id]');
  if (!item) return;
  selection = { type: 'connection', id: item.dataset.connId };
  renderAll();
});

domRefs.contractList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-contract]');
  if (!item) return;
  selection = { type: 'contract', id: item.dataset.contract };
  renderAll();
});

/* ============================================================
   COLLAPSIBLE PANELS
   ============================================================ */
document.querySelectorAll('[data-toggle]').forEach(el => {
  el.addEventListener('click', () => {
    el.parentElement.classList.toggle('collapsed');
  });
});

/* ============================================================
   SWAGGER 2.0 + OPENAPI 3.x IMPORT
   ============================================================ */

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'];

function detectSpecDialect(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.swagger === '2.0') return 'swagger2';
  if (spec.openapi && spec.paths) return 'openapi3';
  return null;
}

function importOpenAPI() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let spec;
    try {
      spec = JSON.parse(await file.text());
    } catch (err) {
      alert('Не удалось распарсить JSON: ' + err.message);
      return;
    }

    const preview = specToMCS(spec);
    if (!preview) return;
    showImportPreview(preview);
  };
  input.click();
}

function specToMCS(spec) {
  const dialect = detectSpecDialect(spec);
  if (!dialect) {
    alert(
      'Формат не распознан.\n\n' +
      'Поддерживаются:\n' +
      '• Swagger 2.0 ("swagger": "2.0")\n' +
      '• OpenAPI 3.x ("openapi": "3.x.y")'
    );
    return null;
  }

  const title = (spec.info?.title || '').trim() || 'Imported Service';
  const baseId = 'srv_' + slugify(title);

  const service = {
    id: baseId,
    name: title,
    gui: { x: 400, y: 400, width: 260 }
  };

  const definitions = getDefinitions(spec, dialect);
  const basePath = dialect === 'swagger2' ? (spec.basePath || '') : '';

  const usedSchemaNames = new Set();
  for (const item of Object.values(spec.paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const okCode = Object.keys(op.responses || {}).find(c => /^2\d\d$/.test(c));
      if (!okCode) continue;
      const ref = extractResponseSchemaRef(op.responses[okCode], dialect);
      if (ref) usedSchemaNames.add(ref);
    }
  }

  const contracts = [];
  const usedContractIds = new Set();
  for (const name of usedSchemaNames) {
    if (!definitions[name]) continue;
    if (usedContractIds.has(name)) continue;
    const fields = extractFlatFields(definitions[name], definitions);
    if (Object.keys(fields).length === 0) continue;
    contracts.push({ id: name, fields });
    usedContractIds.add(name);
  }

  const endpoints = [];
  const usedEpIds = new Set();

  for (const [rawPath, item] of Object.entries(spec.paths)) {
    if (!item || typeof item !== 'object') continue;

    const fullPath = dialect === 'swagger2' ? joinPaths(basePath, rawPath) : rawPath;

    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;

      const rawName = op.operationId || op.summary || `${method.toUpperCase()} ${rawPath}`;
      let epId = 'ep_' + slugify(op.operationId || `${method}_${rawPath}`);
      if (usedEpIds.has(epId)) {
        let n = 2;
        while (usedEpIds.has(`${epId}_${n}`)) n++;
        epId = `${epId}_${n}`;
      }
      usedEpIds.add(epId);

      const okCode = Object.keys(op.responses || {}).find(c => /^2\d\d$/.test(c));
      const okResp = okCode ? op.responses[okCode] : null;
      const bodyRef = okResp ? extractResponseSchemaRef(okResp, dialect) : null;

      endpoints.push({
        $class: 'RestEndpoint',
        id: epId,
        name: rawName,
        service_ref: service.id,
        path: fullPath,
        method: method.toUpperCase(),
        response: {
          status: okCode ? parseInt(okCode, 10) : 200,
          body_ref: bodyRef && usedContractIds.has(bodyRef) ? bodyRef : null
        }
      });
    }
  }

  if (endpoints.length === 0) {
    alert('В спецификации не найдено ни одной операции.');
    return null;
  }

  return { dialect, basePath, service, endpoints, contracts };
}

function getDefinitions(spec, dialect) {
  if (dialect === 'swagger2') return spec.definitions || {};
  return spec.components?.schemas || {};
}

function extractResponseSchemaRef(response, dialect) {
  if (!response) return null;
  const schema = dialect === 'swagger2'
    ? response.schema
    : response.content?.['application/json']?.schema;
  if (!schema) return null;
  if (schema.$ref) return refName(schema.$ref);
  if (schema.type === 'array' && schema.items?.$ref) return refName(schema.items.$ref);
  return null;
}

function refName($ref) {
  return String($ref).replace(/^#\/(definitions|components\/schemas)\//, '');
}

function extractFlatFields(schema, allSchemas) {
  if (!schema || typeof schema !== 'object') return {};
  if (schema.$ref) {
    const name = refName(schema.$ref);
    return extractFlatFields(allSchemas[name], allSchemas);
  }
  const fields = {};
  for (const [key, val] of Object.entries(schema.properties || {})) {
    fields[key] = typeName(val);
  }
  return fields;
}

function typeName(s) {
  if (!s || typeof s !== 'object') return 'any';
  if (s.$ref) return refName(s.$ref);
  if (s.type === 'array') return (s.items ? typeName(s.items) : 'any') + '[]';
  if (s.enum) return `enum[${s.enum.join(',')}]`;
  if (s.type === 'object') return 'object';
  if (s.format) return `${s.type}(${s.format})`;
  return s.type || 'any';
}

function joinPaths(a, b) {
  const left = (a || '').replace(/\/+$/, '');
  const right = (b || '').replace(/^\/+/, '');
  if (!left) return '/' + right;
  if (!right) return left;
  return left + '/' + right;
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'unnamed';
}

/* ---------- Preview modal ---------- */

function showImportPreview(preview) {
  const { service, endpoints, contracts, dialect, basePath } = preview;

  const svcCollision = state.services.some(s => s.id === service.id);
  const epCollisions = endpoints.filter(e => state.endpoints.some(x => x.id === e.id));
  const ctCollisions = contracts.filter(c => state.contracts.some(x => x.id === c.id));

  const dialectLabel = dialect === 'swagger2' ? 'Swagger 2.0' : 'OpenAPI 3.x';
  const dialectClass = dialect === 'swagger2' ? 'swagger' : 'openapi';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>
          Импорт: ${escapeHtml(service.name)}
          <span class="modal-dialect modal-dialect-${dialectClass}">${dialectLabel}</span>
        </h3>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="modal-stats">
          <div><span class="modal-stat-num">1</span><span class="modal-stat-label">сервис</span></div>
          <div><span class="modal-stat-num">${endpoints.length}</span><span class="modal-stat-label">эндпоинтов</span></div>
          <div><span class="modal-stat-num">${contracts.length}</span><span class="modal-stat-label">контрактов</span></div>
        </div>

        ${basePath ? `<div class="modal-info">basePath <code>${escapeHtml(basePath)}</code> добавлен ко всем путям.</div>` : ''}
        ${svcCollision ? `<div class="modal-warn">Сервис с id <code>${escapeHtml(service.id)}</code> уже существует — он будет пропущен.</div>` : ''}

        <div class="modal-section-title">Эндпоинты</div>
        <div class="modal-list">
          ${endpoints.map(e => `
            <div class="modal-list-item">
              <span class="modal-badge modal-badge-${e.method.toLowerCase()}">${e.method}</span>
              <span class="modal-path">${escapeHtml(e.path)}</span>
              <span class="modal-name">${escapeHtml(e.name)}</span>
              ${epCollisions.includes(e) ? '<span class="modal-skip">дубликат</span>' : ''}
            </div>
          `).join('')}
        </div>

        ${contracts.length > 0 ? `
          <div class="modal-section-title">Контракты</div>
          <div class="modal-list">
            ${contracts.map(c => `
              <div class="modal-list-item">
                <span class="modal-name">${escapeHtml(c.id)}</span>
                <span class="modal-fields">${Object.entries(c.fields).map(([k, v]) =>
                  `<span class="field-chip">${escapeHtml(k)}: ${escapeHtml(v)}</span>`
                ).join('')}</span>
                ${ctCollisions.includes(c) ? '<span class="modal-skip">дубликат</span>' : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="modal-footer">
        <button class="modal-btn" data-close>Отмена</button>
        <button class="modal-btn modal-btn-primary" data-apply>Импортировать</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-apply]').addEventListener('click', () => {
    applyOpenAPIImport(preview);
    close();
  });
}

function applyOpenAPIImport(preview) {
  const { service, endpoints, contracts } = preview;

  if (!state.services.some(s => s.id === service.id)) {
    const maxX = state.services.reduce((m, s) => Math.max(m, s.gui.x + s.gui.width), 0);
    service.gui.x = maxX + 80;
    service.gui.y = 100;
    state.services.push(service);
  }

  for (const c of contracts) {
    if (!state.contracts.some(x => x.id === c.id)) state.contracts.push(c);
  }

  for (const e of endpoints) {
    if (!state.endpoints.some(x => x.id === e.id)) state.endpoints.push(e);
  }

  if (state.services.some(s => s.id === service.id)) {
    selection = { type: 'service', id: service.id };
  }

  renderAll();
}

/* ============================================================
   HEADER BUTTONS: export / import / openapi / reset
   ============================================================ */
document.getElementById('btn-export')?.addEventListener('click', exportToFile);
document.getElementById('btn-import')?.addEventListener('click', importFromFile);
document.getElementById('btn-import-openapi')?.addEventListener('click', importOpenAPI);
document.getElementById('btn-reset')?.addEventListener('click', resetToDefault);

/* ============================================================
   GLOBAL SEARCH (Ctrl+F / Cmd+F)
   Command-palette style.
   ============================================================ */

const SearchPalette = (() => {
  let root = null;
  let inputEl = null;
  let listEl = null;
  let counterEl = null;
  let results = [];
  let activeIndex = 0;
  let isOpen = false;

  // ---------- Build flat search index ----------
  function buildEntries() {
    const entries = [];

    state.services.forEach(s => {
      entries.push({
        type: 'service',
        id: s.id,
        primary: s.name,
        secondary: s.id,
        badge: 'SRV',
        badgeClass: 'badge-service',
        haystack: `${s.name} ${s.id}`.toLowerCase(),
        scrollTarget: { x: s.gui.x, y: s.gui.y, w: s.gui.width }
      });
    });

    state.endpoints.forEach(ep => {
      const srv = state.services.find(s => s.id === ep.service_ref);
      const haystack = [
        ep.id, ep.name, ep.path, ep.topic_name, ep.rpc_method,
        ep.package, ep.service_name, ep.broker_type,
        ep.service_ref, ep.message_schema_ref, ep.response?.body_ref
      ].filter(Boolean).join(' ').toLowerCase();

      entries.push({
        type: 'endpoint',
        id: ep.id,
        primary: getEndpointLabel(ep),
        secondary: `${ep.id} · ${srv?.name || ep.service_ref || '?'}`,
        badge: getEndpointBadge(ep) || 'EP',
        badgeClass: 'badge-endpoint',
        haystack,
        scrollTarget: srv ? { x: srv.gui.x, y: srv.gui.y, w: srv.gui.width } : null
      });
    });

    state.connections.forEach(c => {
      const badge = getConnectionBadge(c);
      const haystack = [
        c.id, c.name, c.source_ref, c.target_ref, c.endpoint_ref, c.$class
      ].filter(Boolean).join(' ').toLowerCase();

      const src = state.services.find(s => s.id === c.source_ref);
      entries.push({
        type: 'connection',
        id: c.id,
        primary: c.name,
        secondary: `${c.source_ref || '?'} → ${c.target_ref || '?'}`,
        badge: badge.text,
        badgeClass: 'badge-' + badge.cls,
        haystack,
        scrollTarget: src ? { x: src.gui.x, y: src.gui.y, w: src.gui.width } : null
      });
    });

    state.contracts.forEach(ct => {
      const fieldNames = Object.keys(ct.fields);
      const haystack = [ct.id, ...fieldNames].join(' ').toLowerCase();

      entries.push({
        type: 'contract',
        id: ct.id,
        primary: ct.id,
        secondary: `${fieldNames.length} field${fieldNames.length === 1 ? '' : 's'}`,
        badge: 'CTR',
        badgeClass: 'badge-contract',
        haystack,
        scrollTarget: null
      });
    });

    return entries;
  }

  // ---------- Scoring ----------
  function scoreEntry(query, entry) {
    const q = query.toLowerCase();
    const primary = entry.primary.toLowerCase();
    const id = entry.id.toLowerCase();

    if (id === q) return 1000;
    if (primary === q) return 900;
    if (primary.startsWith(q)) return 800;
    if (id.startsWith(q)) return 700;
    if (primary.includes(q)) return 500;
    if (id.includes(q)) return 400;
    if (entry.haystack.includes(q)) return 100;
    if (isSubsequence(q, entry.haystack)) return 10;
    return -1;
  }

  function isSubsequence(needle, haystack) {
    let i = 0;
    for (let j = 0; j < haystack.length && i < needle.length; j++) {
      if (haystack[j] === needle[i]) i++;
    }
    return i === needle.length;
  }

  function search(query) {
    const entries = buildEntries();
    if (!query) return entries.slice(0, 60);

    return entries
      .map(e => ({ entry: e, score: scoreEntry(query, e) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score ||
        a.entry.primary.localeCompare(b.entry.primary))
      .slice(0, 60)
      .map(x => x.entry);
  }

  // ---------- Highlight ----------
  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, idx)) +
      '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' +
      escapeHtml(text.slice(idx + query.length))
    );
  }

  // ---------- Render ----------
  function renderList() {
    if (!listEl) return;

    if (results.length === 0) {
      listEl.innerHTML = '<div class="search-empty">Ничего не найдено</div>';
      counterEl.textContent = '0';
      return;
    }
    counterEl.textContent = results.length;

    const q = inputEl.value;
    listEl.innerHTML = results.map((r, i) => `
      <div class="search-item${i === activeIndex ? ' active' : ''}" data-index="${i}">
        <span class="search-badge ${r.badgeClass}">${escapeHtml(r.badge)}</span>
        <div class="search-text">
          <div class="search-primary">${highlight(r.primary, q)}</div>
          <div class="search-secondary">${escapeHtml(r.secondary)}</div>
        </div>
      </div>
    `).join('');
  }

  // ---------- Lifecycle ----------
  function ensureRoot() {
    if (root) return;

    root = document.createElement('div');
    root.className = 'search-overlay';
    root.innerHTML = `
      <div class="search-palette">
        <div class="search-header">
          <span class="search-icon">⌕</span>
          <input class="search-input" type="text"
                 placeholder="Поиск: сервисы, эндпоинты, связи, контракты…"
                 autocomplete="off" spellcheck="false">
          <span class="search-counter">0</span>
        </div>
        <div class="search-list"></div>
        <div class="search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> навигация</span>
          <span><kbd>Enter</kbd> открыть</span>
          <span><kbd>Esc</kbd> закрыть</span>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    inputEl = root.querySelector('.search-input');
    listEl = root.querySelector('.search-list');
    counterEl = root.querySelector('.search-counter');

    inputEl.addEventListener('input', () => {
      results = search(inputEl.value);
      activeIndex = 0;
      renderList();
    });

    inputEl.addEventListener('keydown', onInputKeydown);

    listEl.addEventListener('click', (e) => {
      const item = e.target.closest('[data-index]');
      if (!item) return;
      const idx = +item.dataset.index;
      if (!isNaN(idx) && results[idx]) navigate(results[idx]);
    });

    listEl.addEventListener('mousemove', (e) => {
      const item = e.target.closest('[data-index]');
      if (!item) return;
      const idx = +item.dataset.index;
      if (idx !== activeIndex) {
        activeIndex = idx;
        updateActive();
      }
    });

    root.addEventListener('mousedown', (e) => {
      if (e.target === root) close();
    });
  }

  function onInputKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length === 0) return;
      activeIndex = Math.min(activeIndex + 1, results.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[activeIndex]) navigate(results[activeIndex]);
    }
  }

  function updateActive() {
    listEl.querySelectorAll('.search-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
    const a = listEl.querySelector('.search-item.active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Navigation ----------
  function navigate(entry) {
    selection = { type: entry.type, id: entry.id };
    renderAll();
    if (entry.scrollTarget) scrollCanvasTo(entry.scrollTarget);
    close();
  }

  function scrollCanvasTo(target) {
    const wrap = domRefs.canvasWrap;
    if (!wrap) return;
    const centerX = target.x + (target.w || 240) / 2;
    const targetLeft = centerX - wrap.clientWidth / 2;
    const targetTop  = target.y - wrap.clientHeight / 3;
    wrap.scrollTo({
      left: Math.max(0, targetLeft),
      top:  Math.max(0, targetTop),
      behavior: 'smooth'
    });
  }

  // ---------- Public ----------
  function open() {
    ensureRoot();
    isOpen = true;
    root.classList.add('open');
    inputEl.value = '';
    results = search('');
    activeIndex = 0;
    renderList();
    requestAnimationFrame(() => inputEl.focus());
  }

  function close() {
    if (!root) return;
    isOpen = false;
    root.classList.remove('open');
    if (inputEl) inputEl.blur();
  }

  function toggle() {
    isOpen ? close() : open();
  }

  return { open, close, toggle, isOpen: () => isOpen };
})();

/* ---------- Global keyboard hook ---------- */
window.addEventListener('keydown', (e) => {
  const isFind = (e.ctrlKey || e.metaKey) &&
                 !e.shiftKey && !e.altKey &&
                 (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'а');
  if (!isFind) return;

  // Не перехватываем внутри textarea и contenteditable —
  // там Ctrl+F может быть осмысленным поиском по тексту поля
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

  e.preventDefault();
  SearchPalette.toggle();
});

/* ============================================================
   BOOT
   ============================================================ */
if (!tryLoadFromLocalStorage()) {
  // Дефолтное состояние уже установлено в createDefaultState()
}
renderAll();