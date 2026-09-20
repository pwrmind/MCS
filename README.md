# Microservices Connection Specification (MCS) — v3.0

**MCS (Microservices Connection Specification)** — это открытый архитектурный стандарт и мета-язык для декларативного проектирования, валидации и визуализации микросервисных архитектур. 

В отличие от спецификаций, описывающих изолированные сервисы (OpenAPI, AsyncAPI), **MCS фокусируется на графе связей** между ними. Стандарт построен на принципах чистой агрегации, строгой объектно-ориентированной модели контрактов и явного переопределения сценариев взаимодействия.

## 🔑 Ключевые принципы стандарта

1. **Чистая агрегация (Flat Architecture):** Файлы спецификации `*.mcs.json` и `*.mcs.yaml` имеют абсолютно плоскую структуру. Сервисы, эндпоинты, связи и контракты данных находятся в корневых массивах и ссылаются друг на друга по уникальным `id`. Это разрывает жесткую композицию и позволяет гибко работать с компонентами как в коде, так и в визуальных UI-редакторах.
2. **Явное лучше, чем неявное (Explicit over Implicit):** Архитектурные оверрайды требуют декларации намерений. Если конкретная связь между сервисами перегружает базовый контракт эндпоинта (например, передает специфичные legacy-флаги), она обязана явно объявить режим `contract_mode: "override"`. Неявное изменение контрактов запрещено.
3. **Полиморфизм и Расширяемость:** Эндпоинты (`Endpoint`) и связи (`Interaction`) спроектированы как самостоятельные ООП-классы. Поддержка новых протоколов (gRPC, GraphQL, WebTransport) или паттернов сети (Circuit Breaker, Saga) добавляется через создание изолированных классов-наследников без изменения ядра парсера.
4. **Разделение HTTP-методов:** В микросервисных средах комбинация `[Метод] + [Путь]` (например, `GET /users` и `POST /users`) имеет разную семантику, типы ответов и права доступа. В MCS они декларируются как независимые эндпоинты.
5. **Поддержка черновиков (Draft Mode):** Связи могут временно находиться в подвешенном состоянии (`target_ref: null`). Парсер поддерживает два уровня строгости: мягкий `GUI_DRAFT` для интерактивного проектирования на холсте и бескомпромиссный `CI_PROD` для блокировки сборки в CI/CD при наличии незамкнутых нитей.

## 📄 Спецификация формата (Пример `architecture.mcs.json`)

```json
{
  "mcs_version": "3.0",
  "system_name": "CoreRetailPlatform",
  "metadata": {
    "gui_viewport": { "zoom": 1.0, "x": 0, "y": 0 }
  },
  "contracts": [
    {
      "id": "contract_user_base",
      "fields": {
        "id": "uuid",
        "email": "string"
      }
    },
    {
      "id": "contract_user_legacy",
      "fields": {
        "id": "uuid",
        "email": "string",
        "legacy_token": "string"
      }
    }
  ],
  "endpoints": [
    {
      "$class": "RestEndpoint",
      "id": "ep_get_user_v1",
      "name": "Получить пользователя",
      "path": "/v1/users/{id}",
      "method": "GET",
      "response": {
        "status": 200,
        "body_ref": "contract_user_base"
      },
      "gui": { "offset_y": 40 }
    }
  ],
  "services": [
    {
      "id": "srv_user_management",
      "name": "User Management Service",
      "endpoint_refs": ["ep_get_user_v1"],
      "gui": { "x": 150, "y": 200, "width": 250, "height": 150 }
    },
    {
      "id": "srv_auth",
      "name": "Auth Service",
      "endpoint_refs": [],
      "gui": { "x": 500, "y": 100, "width": 200, "height": 100 }
    },
    {
      "id": "srv_legacy_billing",
      "name": "Legacy Billing System",
      "endpoint_refs": [],
      "gui": { "x": 500, "y": 350, "width": 200, "height": 100 }
    }
  ],
  "connections": [
    {
      "$class": "SyncRequestResponse",
      "id": "conn_auth_to_users",
      "name": "Стандартный запрос профиля",
      "source_ref": "srv_auth",
      "target_ref": "srv_user_management",
      "endpoint_ref": "ep_get_user_v1",
      "contract_mode": "strict",
      "timeout_ms": 1500,
      "gui": { "anchors": [] }
    },
    {
      "$class": "SyncRequestResponse",
      "id": "conn_billing_to_users_legacy",
      "name": "Легаси запрос авторизации",
      "source_ref": "srv_legacy_billing",
      "target_ref": "srv_user_management",
      "endpoint_ref": "ep_get_user_v1",
      "contract_mode": "override",
      "response": {
        "status": 200,
        "body_ref": "contract_user_legacy"
      },
      "timeout_ms": 3000,
      "gui": {
        "anchors": [],
        "free_target_pos": null
      }
    }
  ]
}
```

## 🏗️ Архитектура инструментов экосистемы

Экосистема MCS разделена на три независимых слоя, взаимодействующих через плоскую структуру JSON:

### 1. Ядро парсера и валидации (Core SDK)
Библиотека на базе **TypeScript / Node.js**, которая выполняет синтаксический анализ файла, инстанцирует полиморфные классы (`Endpoint`, `Interaction`) и производит валидацию графа. 
* Проверяет ссылочную целостность (наличие ID сервисов и контрактов).
* Вызывает внутренние методы `.validate()` у каждого класса для проверки логики (например, запрет синхронного RPC-вызова в асинхронный топик брокера сообщений).

### 2. Визуальный конструктор (GUI Designer)
Интерактивный веб-интерфейс, спроектированный по методологии **Atomic Design** на нативных **веб-компонентах (Web Components)** и Shadow DOM без привязки к фреймворкам.
* Отображает сервисы в виде блоков, а эндпоинты — в виде горизонтальных плашек с круглыми портами-коннекторами.
* Реализует физику **«повисших нитей»**: концы связей можно оторвать от портов и оставить в пространстве холста. При этом в JSON записываются null-значения и координаты `free_target_pos`.
* Общается по принципу **Unidirectional Data Flow**: движения мыши генерируют нативные всплывающие события `CustomEvents` (с флагом `composed: true`), обновляющие состояние на верхнем уровне страницы, которая затем спускает изменения обратно в UI через HTML-атрибуты.
* Использует нативный метод `document.elementsFromPoint()` для высокопроизводительного хит-тестинга и примагничивания нитей к портам.

### 3. Генераторы кода (Code Generators)
Изолированные плагины автоматизации, которые подключаются к результатам работы парсера. На основе валидного графа они генерируют:
* Клиентские SDK с зашитой сетевой логикой (таймауты, ретраи, экспоненциальный бэкoфф).
* Каркасы серверных контроллеров и заглушек.
* Конфигурации для API Gateways (Nginx, Kong, Envoy) и Service Mesh (Istio).

## 📊 Матрица классов

### Классы Эндпоинтов (`Endpoint`)
* `RestEndpoint`: содержит свойства `path`, `method` (GET/POST/PUT/DELETE) и структуру HTTP-ответа.
* `GrpcEndpoint`: содержит свойства `package`, `service_name`, `rpc_method`, а также ссылки на входящие и исходящие контракты.
* `PubSubChannel`: описывает асинхронные каналы брокеров сообщений (Kafka, RabbitMQ), содержит свойства `topic_name`, `broker_type` и ссылку на схему сообщения `message_schema_ref`.

### Классы Взаимодействий (`Interaction`)
* `SyncRequestResponse`: классическая синхронная связь (HTTP/gRPC) с жестким ожиданием ответа. Управляет свойствами `timeout_ms` и объектом `retry_policy`.
* `AsyncFireAndForget`: асинхронная публикация событий в очередь с контролем уровня гарантии доставки `delivery_guarantee` (at-least-once, exactly-once).
* `StreamingInteraction`: потоковое соединение (gRPC Streams, WebSockets) со свойствами `stream_type` (inbound/outbound/bidirectional) и `keep_alive_ms`.

## 🚀 Быстрый старт с CLI (Разработка)

Установка парсера:
```bash
npm install -g @mcs/cli
```

Явная валидация архитектуры в строгом режиме для CI/CD:
```bash
mcs validate --config ./architecture.mcs.json --mode ci_prod
```

## 📄 Лицензия
Проект распространяется под лицензией MIT.
