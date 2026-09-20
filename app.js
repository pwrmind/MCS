/* ============================================================
   MCS v3.0 — Single Page Application
   Плоская агрегация: contracts[], endpoints[], services[], connections[]
   ============================================================ */

const SVGNS = 'http://www.w3.org/2000/svg';

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
  connList: document.getElementById('conn-list'),
  contractList: document.getElementById('contract-list')
};

/* ---------- HELPERS ---------- */
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

/* Set nested property by dotted path: setNested(obj, "response.body_ref", v) */
function setNested(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
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

/* ---------- RENDER: CANVAS ---------- */
function renderCanvas() {
  reindex();
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
      x: srv.gui.width - 14, y: 23, 'text-anchor': 'end',
      class: 'service-id', textContent: srv.id
    }));

    g.appendChild(createSVGElement('line', {
      x1: 0, y1: headerH, x2: srv.gui.width, y2: headerH,
      stroke: 'var(--border)', 'stroke-width': 1
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
  const dx = Math.max(CONFIG.MIN_CURVE_DX, Math.abs(tx - sx) * 0.5);

  const path = createSVGElement('path', {
    d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
    class: getWireClass(conn, isSelected),
    'data-conn-id': conn.id
  });
  path.style.stroke = getWireColor(conn, targetEp);
  group.appendChild(path);

  if (free) {
    group.appendChild(createSVGElement('circle', {
      cx: tx, cy: ty, r: CONFIG.CONNECTOR_RADIUS, class: 'wire-end free',
      'data-conn-id': conn.id, 'data-end': 'target'
    }));
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

/* ---------- SIDEBAR: services ---------- */
function renderSidebar() {
  document.getElementById('svc-count').textContent = state.services.length;
  document.getElementById('conn-count').textContent = state.connections.length;
  document.getElementById('contract-count').textContent = state.contracts.length;

  domRefs.svcList.innerHTML = state.services.map(s =>
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

/* ---------- SIDEBAR: connections ---------- */
function renderConnectionsList() {
  if (!domRefs.connList) return;

  domRefs.connList.innerHTML = state.connections.map(c => {
    const badge = getConnectionBadge(c);
    const isSelected = selection.type === 'connection' && selection.id === c.id;
    const modeCls = c.contract_mode === 'override' ? 'override' : 'strict';

    const targetHtml = c.target_ref
      ? `<span class="tgt">${c.target_ref}</span>`
      : `<span class="free">— повисла —</span>`;

    const epHtml = c.endpoint_ref
      ? `<span class="conn-ep">${c.endpoint_ref}</span>`
      : `<span class="conn-ep free">null</span>`;

    const cls = ['conn-list-item', badge.cls];
    if (isSelected) cls.push('selected');
    if (c.contract_mode === 'override') cls.push('override');

    return `
      <div class="${cls.join(' ')}" data-conn-id="${c.id}">
        <div class="conn-head">
          <span class="conn-class-badge ${badge.cls}">${badge.text}</span>
          <span class="conn-name">${c.name}</span>
        </div>
        <div class="conn-route">
          <span class="src">${c.source_ref || '—'}</span>
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
  domRefs.jsonView.innerHTML = syntaxHighlight(JSON.stringify(clean, null, 2));
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
  } else {
    domRefs.inspector.innerHTML = `<div style="color:var(--muted); font-size:12px; text-align:center; padding:20px 0;">
      Выберите сервис, эндпоинт или связь
    </div>`;
  }
}

/* ---------- Service Inspector ---------- */
function renderServiceInspector() {
  const s = state.services.find(x => x.id === selection.id);
  if (!s) return;
  const eps = state.endpoints.filter(e => e.service_ref === s.id);

  domRefs.inspector.innerHTML = `
    <div class="form-row">
      <label class="form-label">Имя сервиса</label>
      <input class="form-input" value="${s.name}" data-svc-field="name">
    </div>
    <div class="form-row">
      <label class="form-label">Идентификатор</label>
      <input class="form-input mono" value="${s.id}" data-svc-field="id">
    </div>
    <div class="form-row">
      <label class="form-label">Эндпоинты (${eps.length})</label>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${eps.map(e => `
          <span class="field-chip" style="background:var(--panel-2);border:1px solid var(--border-2);padding:3px 8px;cursor:pointer;"
                data-inspect-ep="${e.id}">
            ${getEndpointLabel(e)}
          </span>`).join('') || '<span style="color:var(--muted);font-size:11px;">нет</span>'}
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

  // Bind editable fields
  domRefs.inspector.querySelectorAll('[data-svc-field]').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.svcField;
      const v = el.value.trim();
      if (!v) { renderAll(); return; }

      if (f === 'name') {
        s.name = v;
      } else if (f === 'id') {
        if (v === s.id) return;
        const oldId = s.id;
        s.id = v;
        // Cascade rename into endpoints and connections
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

  // Shortcut: click chip → inspect endpoint
  domRefs.inspector.querySelectorAll('[data-inspect-ep]').forEach(el => {
    el.addEventListener('click', () => {
      selection = { type: 'endpoint', id: el.dataset.inspectEp };
      renderAll();
    });
  });
}

/* ---------- Endpoint Inspector ---------- */
function renderEndpointInspector() {
  const ep = state.endpoints.find(x => x.id === selection.id);
  if (!ep) return;

  // Class-specific editable fields
  let classFields = '';
  if (ep.$class === 'RestEndpoint') {
    classFields = `
      <div class="form-row">
        <label class="form-label">Path</label>
        <input class="form-input mono" value="${ep.path || ''}" data-ep-field="path">
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
        <input class="form-input mono" value="${ep.package || ''}" data-ep-field="package">
      </div>
      <div class="form-row">
        <label class="form-label">Service Name</label>
        <input class="form-input mono" value="${ep.service_name || ''}" data-ep-field="service_name">
      </div>
      <div class="form-row">
        <label class="form-label">RPC Method</label>
        <input class="form-input mono" value="${ep.rpc_method || ''}" data-ep-field="rpc_method">
      </div>
    `;
  } else if (ep.$class === 'PubSubChannel') {
    classFields = `
      <div class="form-row">
        <label class="form-label">Topic Name</label>
        <input class="form-input mono" value="${ep.topic_name || ''}" data-ep-field="topic_name">
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

  // Contract binding (response for RPC/REST, message_schema for Pub/Sub)
  let contractHtml = '';
  if (ep.$class === 'PubSubChannel') {
    contractHtml = `
      <div class="form-row">
        <label class="form-label">Message Schema</label>
        <select class="form-select mono" data-ep-field="message_schema_ref">
          <option value="">— не выбрано —</option>
          ${state.contracts.map(c =>
            `<option value="${c.id}" ${ep.message_schema_ref === c.id ? 'selected' : ''}>${c.id}</option>`
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
            `<option value="${c.id}" ${bodyRef === c.id ? 'selected' : ''}>${c.id}</option>`
          ).join('')}
        </select>
      </div>
    `;
  }

  const svcOptions = state.services.map(s =>
    `<option value="${s.id}" ${ep.service_ref === s.id ? 'selected' : ''}>${s.name} (${s.id})</option>`
  ).join('');

  domRefs.inspector.innerHTML = `
    <div class="form-row">
      <label class="form-label">Класс</label>
      <input class="form-input mono" value="${ep.$class}" readonly>
    </div>
    <div class="form-row">
      <label class="form-label">Имя эндпоинта</label>
      <input class="form-input" value="${ep.name || ''}" data-ep-field="name">
    </div>
    <div class="form-row">
      <label class="form-label">Идентификатор</label>
      <input class="form-input mono" value="${ep.id}" data-ep-field="id">
    </div>
    <div class="form-row">
      <label class="form-label">Принадлежит сервису</label>
      <select class="form-select mono" data-ep-field="service_ref">${svcOptions}</select>
    </div>
    ${classFields}
    ${contractHtml}
    <button class="form-input" style="background:rgba(248,81,73,0.1);border-color:var(--danger);color:var(--danger);cursor:pointer;font-weight:600;" onclick="deleteEndpoint('${ep.id}')">Удалить эндпоинт</button>
  `;

  // Bind editable fields
  domRefs.inspector.querySelectorAll('[data-ep-field]').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.epField;
      let v = el.value;
      if (v === '') v = null;
      if (el.type === 'number' && v !== null) v = +v;

      // Special-case: rename ID with cascade
      if (f === 'id') {
        if (!v || v === ep.id) { renderAll(); return; }
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

/* ---------- Connection Inspector ---------- */
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
    `<option value="${s.id}" ${c.source_ref === s.id ? 'selected' : ''}>${s.name} (${s.id})</option>`
  ).join('');

  const targetOptions = `<option value="">— не выбрано (повисла) —</option>` +
    state.services.map(s =>
      `<option value="${s.id}" ${c.target_ref === s.id ? 'selected' : ''}>${s.name} (${s.id})</option>`
    ).join('');

  const endpointOptions = `<option value="">— не выбрано —</option>` +
    state.endpoints
      .filter(e => !c.target_ref || e.service_ref === c.target_ref)
      .map(e => `<option value="${e.id}" ${c.endpoint_ref === e.id ? 'selected' : ''}>${e.id} · ${getEndpointLabel(e)}</option>`)
      .join('');

  domRefs.inspector.innerHTML = `
    <div class="form-row">
      <label class="form-label">Название сценария</label>
      <input class="form-input" value="${c.name}" data-conn-field="name">
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
      <div class="form-input mono" style="font-size:11px;">${c.delivery_guarantee}</div>
    </div>` : ''}
    ${isOverride ? `
    <div class="form-row">
      <label class="form-label">Переопределённый response</label>
      <div class="form-input mono" style="font-size:11px; color:var(--warn);">${JSON.stringify(c.response)}</div>
    </div>` : ''}
    <button class="form-input" style="background:rgba(248,81,73,0.1);border-color:var(--danger);color:var(--danger);cursor:pointer;font-weight:600;" onclick="deleteConnection('${c.id}')">Удалить связь явно</button>
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
        c.response = { status: 200, body_ref: "contract_user_legacy" };
      }
      renderAll();
    });
  });
}

/* ---------- Delete handlers ---------- */
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
window.deleteEndpoint = function(id) {
  state.endpoints = state.endpoints.filter(e => e.id !== id);
  state.connections.forEach(c => {
    if (c.endpoint_ref === id) c.endpoint_ref = null;
  });
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
  renderConnectionsList();
  renderCanvas();
  renderInspector();
  renderJSON();
}

/* ============================================================
   INTERACTION: SELECT + DRAG SERVICES
   ============================================================ */
let dragSvc = null;

domRefs.svg.addEventListener('mousedown', (e) => {
  const target = e.target;

  // 1. Шапка сервиса — выделяем и стартуем drag
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

  // 2. Нить — выделяем связь
  if (target.dataset.connId) {
    selection = { type: 'connection', id: target.dataset.connId };
    renderAll();
    e.preventDefault();
    return;
  }

  // 3. Эндпоинт (или его коннектор) — выделяем эндпоинт
  const epG = target.closest('.endpoint');
  if (epG) {
    selection = { type: 'endpoint', id: epG.dataset.epId };
    renderAll();
    return;
  }

  // 4. Тело сервиса (не эндпоинт) — выделяем сервис
  const svcG = target.closest('.service');
  if (svcG) {
    selection = { type: 'service', id: svcG.dataset.svcId };
    renderAll();
    return;
  }

  // 5. Пустое место — сброс выделения
  selection = { type: null, id: null };
  renderAll();
});

document.addEventListener('mousemove', (e) => {
  if (!dragSvc) return;
  const svgRect = domRefs.svg.getBoundingClientRect();
  dragSvc.srv.gui.x = Math.max(0, e.clientX - svgRect.left - dragSvc.offsetX);
  dragSvc.srv.gui.y = Math.max(0, e.clientY - svgRect.top  - dragSvc.offsetY);
  renderCanvas();
  renderJSON();
});

document.addEventListener('mouseup', () => {
  dragSvc = null;
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
        endpoint_refs: [],
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
          method: 'GET', response: { status: 200, body_ref: 'contract_user_base' }
        };
      } else if (type === 'grpc') {
        newEp = {
          $class: 'GrpcEndpoint', id: 'ep_new_grpc_' + (newEndpointCounter++), name: 'New RPC',
          service_ref: srvId, package: 'pkg.v1', service_name: 'Svc', rpc_method: 'Call',
          response: { body_ref: 'contract_payment_ok' }
        };
      } else {
        newEp = {
          $class: 'PubSubChannel', id: 'ch_new_' + (newEndpointCounter++), name: 'New Topic',
          service_ref: srvId, topic_name: 'new.events.v1',
          broker_type: 'kafka', message_schema_ref: 'contract_order'
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
  updateStats(); renderJSON();
});
document.getElementById('btn-locked').addEventListener('click', () => {
  state.metadata.mode = 'locked';
  document.getElementById('btn-locked').classList.add('active');
  document.getElementById('btn-draft').classList.remove('active');
  updateStats(); renderJSON();
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

/* ============================================================
   BOOT
   ============================================================ */
reindex();
renderAll();