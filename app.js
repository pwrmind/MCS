/* ============================================================
   MCS v3.0 — Single Page Application
   Плоская агрегация: contracts[], endpoints[], services[], connections[]
   ============================================================ */

const SVGNS = 'http://www.w3.org/2000/svg';

// Configuration constants
const CONFIG = {
  SERVICE_HEADER_HEIGHT: 36,
  ENDPOINT_ROW_HEIGHT: 32,
  ENDPOINT_PADDING: 10,
  CONNECTOR_RADIUS: 6,
  CONNECTOR_OFFSET_X: 14,
  MIN_CURVE_DX: 60,
  MAX_LABEL_LENGTH: 26,
  GRID_SIZE: 24
};

/* ---------- STATE ---------- */
const state = {
  mcs_version: "3.0",
  system_name: "CoreRetailPlatform",
  metadata: {
    mode: "draft",
    gui_viewport: { zoom: 1, x: 0, y: 0 }
  },
  contracts: [
    { id: "contract_user_base",   fields: { id: "uuid", email: "string" } },
    { id: "contract_user_legacy", fields: { id: "uuid", email: "string", legacy_token: "string" } },
    { id: "contract_order",       fields: { order_id: "uuid", total: "decimal" } },
    { id: "contract_payment_ok",  fields: { transaction_id: "string", timestamp: "datetime" } }
  ],
  endpoints: [
    { $class: "RestEndpoint",  id: "ep_get_user_v1",  name: "Получить пользователя", service_ref: "srv_user_management",
      path: "/v1/users/{id}", method: "GET", response: { status: 200, body_ref: "contract_user_base" } },
    { $class: "RestEndpoint",  id: "ep_create_order", name: "Создать заказ", service_ref: "srv_order",
      path: "/v1/orders", method: "POST", response: { status: 201, body_ref: "contract_order" } },
    { $class: "GrpcEndpoint",  id: "ep_charge",       name: "Списать средства", service_ref: "srv_payment",
      package: "retail.payment.v1", service_name: "PaymentService", rpc_method: "Charge",
      response: { body_ref: "contract_payment_ok" } },
    { $class: "PubSubChannel", id: "ch_order_events", name: "События заказов", service_ref: "srv_order",
      topic_name: "orders.v1.events", broker_type: "kafka", message_schema_ref: "contract_order" }
  ],
  services: [
    { id: "srv_auth",            name: "Auth Service",       endpoint_refs: [], gui: { x: 40,  y: 60,  width: 230 } },
    { id: "srv_user_management", name: "User Management",    endpoint_refs: [], gui: { x: 380, y: 60,  width: 280 } },
    { id: "srv_order",           name: "Order Service",      endpoint_refs: [], gui: { x: 380, y: 300, width: 280 } },
    { id: "srv_payment",         name: "Payment Gateway",    endpoint_refs: [], gui: { x: 760, y: 200, width: 280 } },
    { id: "srv_legacy_billing",  name: "Legacy Billing",     endpoint_refs: [], gui: { x: 40,  y: 340, width: 230 } }
  ],
  connections: [
    { $class: "SyncRequestResponse", id: "conn_auth_to_users",    name: "Стандартный запрос профиля",
      source_ref: "srv_auth",           target_ref: "srv_user_management", endpoint_ref: "ep_get_user_v1",
      contract_mode: "strict",   timeout_ms: 1500, retry_policy: { max_attempts: 3, backoff_factor: 2.0 }, gui: {} },
    { $class: "SyncRequestResponse", id: "conn_billing_legacy",   name: "Легаси запрос авторизации",
      source_ref: "srv_legacy_billing", target_ref: "srv_user_management", endpoint_ref: "ep_get_user_v1",
      contract_mode: "override", timeout_ms: 3000, retry_policy: { max_attempts: 1, backoff_factor: 1.0 },
      response: { status: 200, body_ref: "contract_user_legacy" }, gui: {} },
    { $class: "SyncRequestResponse", id: "conn_order_to_payment", name: "Оплата заказа",
      source_ref: "srv_order",          target_ref: "srv_payment",         endpoint_ref: "ep_charge",
      contract_mode: "strict",   timeout_ms: 5000, retry_policy: { max_attempts: 2, backoff_factor: 1.5 }, gui: {} },
    { $class: "AsyncFireAndForget",  id: "conn_order_events",     name: "Публикация событий",
      source_ref: "srv_order",          target_ref: "srv_order",           endpoint_ref: "ch_order_events",
      contract_mode: "strict",   delivery_guarantee: "at_least_once", gui: {} }
  ]
};

/* ---------- INDEX SERVICE ENDPOINTS ---------- */
function reindex() {
  state.services.forEach(s => s.endpoint_refs = []);
  state.endpoints.forEach(ep => {
    const srv = state.services.find(s => s.id === ep.service_ref);
    if (srv) srv.endpoint_refs.push(ep.id);
  });
}

/* ---------- SELECTION ---------- */
let selection = { type: null, id: null };

/* ---------- DOM REFS ---------- */
const domRefs = {
  svg: document.getElementById('canvas'),
  canvasWrap: document.getElementById('canvas-wrap'),
  jsonView: document.getElementById('json-view'),
  inspector: document.getElementById('inspector'),
  svcList: document.getElementById('svc-list'),
  contractList: document.getElementById('contract-list')
};

/* ---------- HELPER FUNCTIONS ---------- */
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

/* ---------- RENDER: SERVICES & ENDPOINTS ---------- */
function renderCanvas() {
  reindex();
  domRefs.domRefs.svg.innerHTML = '';

  const wiresG = createSVGElement('g', { class: 'wires' });
  domRefs.domRefs.svg.appendChild(wiresG);

  const nodesG = createSVGElement('g', { class: 'nodes' });
  domRefs.domRefs.svg.appendChild(nodesG);

  // Render services
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

    // body rect
    const rect = createSVGElement('rect', {
      width: srv.gui.width,
      height: totalH,
      rx: 10,
      class: 'service-rect'
    });
    g.appendChild(rect);

    // header (drag target)
    const header = createSVGElement('rect', {
      width: srv.gui.width,
      height: headerH,
      rx: 10,
      class: 'service-header',
      'data-drag-service': srv.id
    });
    g.appendChild(header);

    // service name
    const name = createSVGElement('text', {
      x: 14,
      y: 23,
      class: 'service-name',
      textContent: srv.name
    });
    g.appendChild(name);

    // service id
    const sid = createSVGElement('text', {
      x: srv.gui.width - 14,
      y: 23,
      'text-anchor': 'end',
      class: 'service-id',
      textContent: srv.id
    });
    g.appendChild(sid);

    // divider line
    const divider = createSVGElement('line', {
      x1: 0,
      y1: headerH,
      x2: srv.gui.width,
      y2: headerH,
      stroke: 'var(--border)',
      'stroke-width': 1
    });
    g.appendChild(divider);

    // endpoints
    eps.forEach((ep, i) => {
      const y = headerH + i * rowH;
      const epG = createServiceEndpoint(ep, srv, y, rowH);
      g.appendChild(epG);
    });

    nodesG.appendChild(g);
  });

  // Render wires (after nodes so we can compute positions)
  state.connections.forEach(conn => renderWire(conn, wiresG));

  updateStats();
}

function getServiceClass(srv) {
  let className = 'service';
  if (selection.type === 'service' && selection.id === srv.id) {
    className += ' selected';
  }
  return className;
}

function createServiceEndpoint(ep, srv, y, rowH) {
  const epG = createSVGElement('g', {
    transform: `translate(0, ${y})`,
    class: 'endpoint',
    'data-ep-id': ep.id,
    'data-class': ep.$class
  });

  const epRect = createSVGElement('rect', {
    x: 8,
    y: 3,
    width: srv.gui.width - 16,
    height: rowH - 6,
    rx: 5,
    class: `ep-rect ep-${ep.$class}`
  });
  epG.appendChild(epRect);

  // method/class badge
  const badge = getEndpointBadge(ep);
  const badgeText = createSVGElement('text', {
    x: 20,
    y: rowH / 2 + 4,
    class: 'ep-method',
    textContent: badge
  });
  epG.appendChild(badgeText);

  // path/name
  const label = getEndpointLabel(ep);
  const epName = createSVGElement('text', {
    x: 60,
    y: rowH / 2 + 4,
    class: 'ep-name',
    textContent: truncateLabel(label, CONFIG.MAX_LABEL_LENGTH)
  });
  epG.appendChild(epName);

  // connector circle (outbound port on right)
  const connector = createSVGElement('circle', {
    cx: srv.gui.width - CONFIG.CONNECTOR_OFFSET_X,
    cy: rowH / 2,
    r: CONFIG.CONNECTOR_RADIUS,
    class: 'connector',
    'data-ep-id': ep.id,
    'data-service-id': srv.id
  });
  epG.appendChild(connector);

  return epG;
}

function createSVGElement(tag, attributes) {
  const element = document.createElementNS(SVGNS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

/* ---------- RENDER: ONE WIRE ---------- */
function renderWire(conn, group) {
  const src = state.services.find(s => s.id === conn.source_ref);
  if (!src) return;

  // start point: right edge of source service, at header mid
  const sx = src.gui.x + src.gui.width;
  const sy = src.gui.y + src._headerH / 2;

  // end point
  let tx, ty, free = false;
  const tgtSrv = state.services.find(s => s.id === conn.target_ref);
  const targetEp = conn.endpoint_ref ? state.endpoints.find(e => e.id === conn.endpoint_ref) : null;

  if (tgtSrv && targetEp) {
    const eps = state.endpoints.filter(e => e.service_ref === tgtSrv.id);
    const idx = eps.indexOf(targetEp);
    tx = tgtSrv.gui.x + tgtSrv.gui.width - CONFIG.CONNECTOR_OFFSET_X;
    ty = tgtSrv.gui.y + tgtSrv._headerH + idx * tgtSrv._rowH + tgtSrv._rowH / 2;
  } else if (conn.gui.free_target_pos) {
    tx = conn.gui.free_target_pos.x;
    ty = conn.gui.free_target_pos.y;
    free = true;
  } else {
    return;
  }

  const isSelected = selection.type === 'connection' && selection.id === conn.id;
  const dx = Math.max(CONFIG.MIN_CURVE_DX, Math.abs(tx - sx) * 0.5);

  // path
  const path = createSVGElement('path', {
    d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
    class: getWireClass(conn, isSelected),
    'data-conn-id': conn.id
  });
  path.style.stroke = getWireColor(conn, targetEp);
  group.appendChild(path);

  // free badge
  if (free) {
    const dot = createSVGElement('circle', {
      cx: tx,
      cy: ty,
      r: CONFIG.CONNECTOR_RADIUS,
      class: 'wire-end free',
      'data-conn-id': conn.id,
      'data-end': 'target'
    });
    group.appendChild(dot);
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

/* ---------- SIDEBAR LISTS ---------- */
function renderSidebar() {
  document.getElementById('svc-count').textContent = state.services.length;
  document.getElementById('contract-count').textContent = state.contracts.length;

  domRefs.domRefs.svcList.innerHTML = state.services.map(s =>
    `<div class="svc-list-item${selection.type==='service'&&selection.id===s.id?' selected':''}" data-svc-id="${s.id}">
      <span class="svc-dot"></span>
      <span>${s.name}</span>
      <span class="svc-list-id">${s.id}</span>
    </div>`
  ).join('');

  domRefs.contractList.innerHTML = state.contracts.map(c =>
    `<div class="contract-item" data-contract="${c.id}">
      <div class="contract-id">${c.id}</div>
      <div class="contract-fields">
        ${Object.entries(c.fields).map(([k,v]) => `<span class="field-chip">${k}: ${v}</span>`).join('')}
      </div>
    </div>`
  ).join('');
}

/* ---------- JSON VIEW ---------- */
function renderJSON() {
  const clean = {
    mcs_version: state.mcs_version,
    system_name: state.system_name,
    metadata: state.metadata,
    contracts: state.contracts,
    endpoints: state.endpoints.map(e => {
      const { service_ref, ...rest } = e;
      return rest;
    }),
    services: state.services.map(s => ({
      id: s.id,
      name: s.name,
      endpoint_refs: s.endpoint_refs,
      gui: { x: s.gui.x, y: s.gui.y, width: s.gui.width }
    })),
    connections: state.connections
  };
  const json = JSON.stringify(clean, null, 2);
  domRefs.domRefs.jsonView.innerHTML = syntaxHighlight(json);
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

/* ---------- INSPECTOR ---------- */
function renderInspector() {
  if (selection.type === 'service') {
    const s = state.services.find(x => x.id === selection.id);
    if (!s) return;
    const eps = state.endpoints.filter(e => e.service_ref === s.id);
    domRefs.inspector.innerHTML = `
      <div class="form-row">
        <label class="form-label">Имя сервиса</label>
        <input class="form-input" value="${s.name}" data-field="name">
      </div>
      <div class="form-row">
        <label class="form-label">Идентификатор</label>
        <input class="form-input mono" value="${s.id}" readonly>
      </div>
      <div class="form-row">
        <label class="form-label">Эндпоинты (${eps.length})</label>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${eps.map(e => `<span class="field-chip" style="background:var(--panel-2);border:1px solid var(--border-2);padding:3px 8px;">${getEndpointLabel(e)}</span>`).join('') || '<span style="color:var(--muted);font-size:11px;">нет</span>'}
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">GUI координаты</label>
        <div class="form-input mono" style="display:flex;gap:10px;">
          <span>x: ${s.gui.x}</span><span>y: ${s.gui.y}</span><span>w: ${s.gui.width}</span>
        </div>
      </div>
      <button class="form-input" style="background:rgba(248,81,73,0.1);border-color:var(--danger);color:var(--danger);cursor:pointer;font-weight:600;" onclick="deleteService('${s.id}')">Удалить сервис</button>
    `;
  }
  else if (selection.type === 'connection') {
    const c = state.connections.find(x => x.id === selection.id);
    if (!c) return;
    const isOverride = c.contract_mode === 'override';
    domRefs.inspector.innerHTML = `
      <div class="form-row">
        <label class="form-label">Название сценария</label>
        <input class="form-input" value="${c.name}" data-conn-field="name">
      </div>
      <div class="form-row">
        <label class="form-label">Класс взаимодействия</label>
        <input class="form-input mono" value="${c.$class}" readonly>
      </div>
      <div class="form-row">
        <label class="form-label">source_ref → target_ref</label>
        <div class="form-input mono" style="font-size:10px;">
          ${c.source_ref} → ${c.target_ref || '<span style="color:var(--warn)">null (повисла)</span>'}
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">endpoint_ref</label>
        <div class="form-input mono" style="font-size:10px;">${c.endpoint_ref || '<span style="color:var(--warn)">null</span>'}</div>
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
        <div class="form-input mono" style="font-size:11px;">${c.delivery_guarantee}</div>
      </div>` : ''}
      ${isOverride ? `
      <div class="form-row">
        <label class="form-label">Переопределённый response</label>
        <div class="form-input mono" style="font-size:11px; color:var(--warn);">${JSON.stringify(c.response)}</div>
      </div>` : ''}
      <button class="form-input" style="background:rgba(248,81,73,0.1);border-color:var(--danger);color:var(--danger);cursor:pointer;font-weight:600;" onclick="deleteConnection('${c.id}')">Удалить связь явно</button>
    `;
    // bind controls
    domRefs.inspector.querySelectorAll('[data-conn-field]').forEach(el => {
      el.addEventListener('change', () => {
        const f = el.dataset.connField;
        c[f] = el.type === 'number' ? +el.value : el.value;
        renderAll();
      });
    });
    domRefs.inspector.querySelectorAll('.contract-mode button').forEach(b => {
      b.addEventListener('click', () => {
        c.contract_mode = b.dataset.mode;
        if (c.contract_mode === 'override' && !c.response) {
          c.response = { status: 200, body_ref: "contract_user_legacy" };
        }
        renderAll();
      });
    });
  }
  else {
    domRefs.inspector.innerHTML = `<div style="color:var(--muted); font-size:12px; text-align:center; padding:20px 0;">
      Выберите сервис или связь
    </div>`;
  }
}

window.deleteService = function(id) {
  state.services = state.services.filter(s => s.id !== id);
  state.endpoints = state.endpoints.filter(e => e.service_ref !== id);
  state.connections = state.connections.filter(c => c.source_ref !== id && c.target_ref !== id);
  selection = { type: null, id: null };
  renderAll();
};
window.deleteConnection = function(id) {
  state.connections = state.connections.filter(c => c.id !== id);
  selection = { type: null, id: null };
  renderAll();
};

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

/* ---------- RENDER ALL ---------- */
function renderAll() {
  renderSidebar();
  renderCanvas();
  renderInspector();
  renderJSON();
}

/* ============================================================
   INTERACTION: DRAG SERVICES
   ============================================================ */
let dragSvc = null;
domRefs.svg.addEventListener('mousedown', (e) => {
  const target = e.target;

  // service header drag
  if (target.dataset.dragService) {
    const srv = state.services.find(s => s.id === target.dataset.dragService);
    if (!srv) return;
    dragSvc = {
      srv,
      offsetX: e.clientX - srv.gui.x,
      offsetY: e.clientY - srv.gui.y
    };
    e.preventDefault();
    return;
  }

  // connection select
  if (target.dataset.connId) {
    selection = { type: 'connection', id: target.dataset.connId };
    renderAll();
    e.preventDefault();
    return;
  }

  // service body click (not on endpoint)
  const svcG = target.closest('.service');
  if (svcG && !target.closest('.endpoint')) {
    selection = { type: 'service', id: svcG.dataset.svcId };
    renderAll();
    return;
  }

  // blank click
  selection = { type: null, id: null };
  renderAll();
});

document.addEventListener('mousemove', (e) => {
  if (dragSvc) {
    dragSvc.srv.gui.x = Math.max(0, e.clientX - dragSvc.offsetX);
    dragSvc.srv.gui.y = Math.max(0, e.clientY - dragSvc.offsetY);
    renderCanvas();
    renderJSON();
  }
});

document.addEventListener('mouseup', () => {
  dragSvc = null;
});

/* ============================================================
   INTERACTION: PALETTE — ADD SERVICE / ENDPOINT
   ============================================================ */
let newEndpointCounter = 1;
document.querySelectorAll('[data-add]').forEach(el => {
  el.addEventListener('click', () => {
    const type = el.dataset.add;
    if (type === 'service') {
      const id = 'srv_new_' + Date.now().toString(36).slice(-4);
      state.services.push({
        id, name: 'New Service',
        endpoint_refs: [],
        gui: { x: 100 + Math.random() * 400, y: 400 + Math.random() * 200, width: 240 }
      });
    } else if (type === 'rest') {
      // add to currently selected service, or first one
      const srvId = selection.type === 'service' && selection.id
        ? selection.id
        : state.services[0]?.id;
      if (!srvId) return;
      const id = 'ep_new_rest_' + (newEndpointCounter++);
      state.endpoints.push({
        $class: 'RestEndpoint', id, name: 'New Endpoint',
        service_ref: srvId, path: '/v1/new',
        method: 'GET', response: { status: 200, body_ref: 'contract_user_base' }
      });
    } else if (type === 'grpc') {
      const srvId = selection.type === 'service' && selection.id
        ? selection.id : state.services[0]?.id;
      if (!srvId) return;
      const id = 'ep_new_grpc_' + (newEndpointCounter++);
      state.endpoints.push({
        $class: 'GrpcEndpoint', id, name: 'New RPC',
        service_ref: srvId, package: 'pkg.v1',
        service_name: 'Svc', rpc_method: 'Call',
        response: { body_ref: 'contract_payment_ok' }
      });
    } else if (type === 'kafka') {
      const srvId = selection.type === 'service' && selection.id
        ? selection.id : state.services[0]?.id;
      if (!srvId) return;
      const id = 'ch_new_' + (newEndpointCounter++);
      state.endpoints.push({
        $class: 'PubSubChannel', id, name: 'New Topic',
        service_ref: srvId, topic_name: 'new.events.v1',
        broker_type: 'kafka', message_schema_ref: 'contract_order'
      });
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
  updateStats();
  renderJSON();
});
document.getElementById('btn-locked').addEventListener('click', () => {
  state.metadata.mode = 'locked';
  document.getElementById('btn-locked').classList.add('active');
  document.getElementById('btn-draft').classList.remove('active');
  updateStats();
  renderJSON();
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

/* ============================================================
   BOOT
   ============================================================ */
reindex();
renderAll();

