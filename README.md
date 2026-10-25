# SEATS — Seating & Event Availability Tracking System

SEATS lets the customers of a live-music bar reserve a specific table for a concert round from a LINE web app: pick
the round, pick a free table on the venue's zone map, hold it for 15 minutes, pay the full table fee and receive an
e-ticket; at the door the staff scan the ticket. The venue's staff run the back-office: zone maps, table types,
concert rounds and prices, a live view of the tables on the night, business parameters and staff accounts.

This repository implements the microservice design of the project document of group SE 101 (2110521 Software
Architecture): the same names, contracts and decisions, so that the document and the code can be read side by side.
Who builds what and how we work is in [docs/team.md](docs/team.md).

The project document's repository includes this repository as a git submodule at `assignments/group/code`, pinned to the
commit that each document version describes; a tagged document version pairs with the commit its pointer names.

## Architecture

Three parts: the **Frontend** (two web apps), the **Backend** (an API Gateway and six services, each with its own
store) and the **external systems** (LINE, the Payment Gateway, object storage), reached only through adapters.

| Component | Folder | Port | Role |
|---|---|---|---|
| Kong API Gateway | `gateway/kong/` | REST :4000 | authenticates bearer tokens and forwards verified identity |
| REST-to-gRPC adapter | `gateway/src/` | internal :4000 | enforces route roles and maps REST requests and responses to gRPC |
| Concert Round Service | `services/concert-round/` | gRPC :5001 | the venue and its events: zone maps, table types, rounds, prices, business parameters |
| Table Availability Service | `services/table-availability/` | gRPC :5003 | the read model of the table map: the status of every table of every round, polled by the web apps |
| Booking Service | `services/booking/` | gRPC :5002 | the booking from Held to Checked-in; it owns the hold (first lock wins), the customer profile and the terms |
| Payment Service | `services/payment/` | gRPC :5004 | payment requests and the signed results of the (simulated) Payment Gateway |
| Notification Service | `services/notification/` | gRPC :5005 | the LINE notices of a booking (a log line in progress 1) |
| Staff Account Service | `services/staff-account/` | gRPC :5006 | staff sign-in sessions and staff accounts |
| Customer Web App | `frontend/customer-web-app/` | :5173 | the LINE (LIFF) app: screens C1 to C9 |
| Back-office Web App | `frontend/back-office-web-app/` | :5174 | the staff app: screens B1 to B7 |

Three decisions shape the code (the ADRs of the project document):

- **REST at the gateway only, gRPC inside** (ADR-12). Every service has exactly one API, its `.proto` file; the
  gateway's route table maps each REST route onto one gRPC method, passes the caller's identity as gRPC metadata and
  maps the gRPC status to the HTTP status. The web apps never see gRPC; the services never speak REST.
- **The booking owns the hold; the table map is a read model** (ADR-13). A hold is one insert in the Booking
  Service that only one of several concurrent customers wins; the Table Availability Service keeps the projection
  that the web apps poll every 2 seconds with an ETag, and is updated after each booking transition.
- **A modular monolith mode for development and tests** (ADR-14). The same code runs as one process: each service's
  API layer is called in-process, every message still through the Protocol Buffers serializers, so the end-to-end
  tests run in milliseconds. It is never the deployment target.

The two flows of the Deliverable 3 demo: **Create Zone Map and Create Round** (the manager, REST CRUD through the
gateway onto the Concert Round Service, which creates the round's table map in the Table Availability Service when
the round is published) and **Create Booking** (the customer, `POST /api/bookings`: the Booking Service reads the
round, wins the hold in its own store and reports it to the table map; the party size then computes the fee).

## Contracts

The design is contract first, derived in one direction: the domain model of the document → each service's data model
([docs/data-model.md](docs/data-model.md)) → its types (`src/domain/model.ts`) → its gRPC messages (`proto/*.proto`, types
generated into `proto/gen/`) → the routes of the gateway ([docs/openapi.yaml](docs/openapi.yaml), from which the web
apps generate their client types). [docs/contracts.md](docs/contracts.md) is the readable route table with the gRPC
method, the roles and the notes behind each route. A contract change is a compile error in every caller, the gateway
included.

## Run

```bash
npm install                 # one install for every workspace
npm run dev                 # the seven backend processes from the TypeScript sources (tsx), coloured logs
npm run dev:mono            # the same backend as ONE process on :4000 (ADR-14), for debugging and quick checks
npm run dev:customer        # the Customer Web App on :5173 (proxies /api to :4000)
npm run dev:backoffice      # the Back-office Web App on :5174; sign in with manager/manager
docker compose up --build   # the seven backend processes as containers, compiled with tsc in the image
npm run demo:seed           # the demo data through the API: three rounds on the next Saturdays, held tables (GATEWAY=… for a deployment)
npm run demo:reset          # empty the monolith through its reset route (DEMO_RESET_TOKEN on both sides), then demo:seed; --no-seed only empties
demo/rest-demo.sh           # the demo flows as readable curl calls through the gateway (needs jq)
demo/grpc-demo.sh           # CRUD on the Table Availability Service with grpcurl
demo/VIDEO.md               # the runbook of the deliverable 3 video: what to click, what each terminal shows
```

**Ports and addresses.** No process carries a port or a URL of its own: `packages/config` is the registry. A service
listens on `GRPC_PORT` or its default (5001 to 5006), a caller finds it at `<SERVICE>_GRPC` or `localhost` and that
default, the gateway and the monolith listen on `PORT` (4000), scripts and tests call `GATEWAY` (default
`http://localhost:4000`), the web apps' dev servers take `PORT` (5173, 5174) and proxy `/api` to `API_PROXY` (the
gateway), and every gRPC call has `GRPC_DEADLINE_MS` (2000). A test reaches a deployed web app at `CUSTOMER_APP_URL`
and `BACK_OFFICE_APP_URL`. `docker-compose.yml` sets the `*_GRPC` variables to the container names; the deployment sets
`PORT` and the rewrites. A port that is not a number fails the process at start-up.

## Test

```bash
npm test                    # node:test: unit tests of every service, the in-process end-to-end flows and the use case scenarios
npm run smoke               # the demo flows against the running gateway (npm run dev or dev:mono first): the wire-level check
npm run test:e2e            # Playwright: the use case flows and the feature suites through the real screens (starts the servers it needs)
npm run test:e2e:deployed   # the same suite on the Vercel apps and the Render backend: reset, run, reset and seed again (DEMO_RESET_TOKEN=…)
npm run test:api            # the same scenarios over the network against a running gateway (GATEWAY=…, default localhost:4000)
npm run test:coverage       # the unit, contract and in-process scenario tests under Node's coverage, with thresholds
npm run typecheck           # tsc on every package; run before a PR
npm run proto               # regenerate proto/gen/ after a change to a .proto file (commit the result)
node scripts/test-traceability.mjs   # docs/test-traceability.md: every use case scenario and the test that covers it
```

The unit tests stub the collaborators and test `domain.ts` alone. The scenario tests (`monolith/test/scenarios/`)
drive each basic, alternative and exception flow of the use cases through the gateway with the services in-process,
named by the flow they cover (`UC-01 AF-3 Table Just Taken by Another Customer`). The Playwright suite
(`frontend/e2e/`) does the same through the screens. `npm run test:api` runs the same scenario files over the network against whatever runs at `GATEWAY`: the seven processes of `npm run dev`, `docker compose up`, `dev:mono` or a deployment; the scenarios that drive a service from inside the process (the hold-expiry job with a shifted clock, a failing fake adapter) are skipped and listed. The smoke test is the quick wire-level demo. [docs/test-design.md](docs/test-design.md) describes the techniques: equivalence classes with boundaries, state-transition matrices, decision tables, the concurrency and authorization scenarios, the doubles, and the coverage thresholds.

## Deploy

The demo deployment is the monolith on a process host and the two web apps on Vercel; the microservices themselves are
deployed with `docker-compose.yml`. Live since 30 September 2026:

| What | URL | Note |
|---|---|---|
| Backend (monolith on Render) | https://seats-monolith.onrender.com | `/health` lists the six services |
| Customer Web App (Vercel) | https://seats-customer.vercel.app | type any LINE user id on the first screen |
| Back-office Web App (Vercel) | https://seats-back-office.vercel.app | sign in with `manager/manager`; also `door1/door1`, `owner/owner` |

Both apps rewrite `/api` and `/health` to the Render backend (`frontend/*/vercel.json`); every push to `main` redeploys all three.

The backend sleeps after 15 minutes without traffic and wakes up empty. **Before a demo**, empty and seed it in one go:

```bash
DEMO_RESET_TOKEN=… GATEWAY=https://seats-monolith.onrender.com npm run demo:reset   # three rounds on the next Saturdays, held tables
```

`npm run demo:reset` calls `POST /api/admin/reset`, a route the monolith has only when `DEMO_RESET_TOKEN` is set
(`render.yaml` generates one; read it under *Environment* in the Render dashboard, and `DEMO_RESET_TOKEN=x npm run
dev:mono` gives a local backend one). It empties the six databases, in memory or on MongoDB, and seeds the staff
accounts again; then `demo/seed.mjs` makes the demo data through the API as the manager and three customers, as the
web apps would: three table types, the Active zone map "Main hall" with two zones and twelve tables, three Published
rounds on the next Saturdays, and on the first round three held tables (Held for the 15 minutes of BRULE-02; Booked
and Occupied tables need the payment of progress 2). The route is outside the gateway's API and its role model: a
reset is a store operation, since the business rules rightly refuse to discard a Published round or an Active zone map.
`npm run demo:seed` alone adds the data to a running backend and does nothing when the rounds are there; `npm run
smoke` is the quick check, not the seed. The microservices have no reset route: `docker compose down -v`.
`npm run test:e2e:deployed` uses the same route to run the Playwright suite on the deployment and leave it seeded.

**Backend on Render** (free plan): New → Blueprint → this repository. `render.yaml` creates the web service
`seats-monolith` from `Dockerfile.monolith`, which runs `monolith/src/server.ts` on the port Render gives it, with
`/health` as the health check. Its URL is `https://seats-monolith.onrender.com`; if Render has to change the name, put
the new host into the two `vercel.json` files below. The free plan sleeps after 15 minutes without traffic (the first
request then takes up to a minute) and keeps the data in memory, so it starts empty after every sleep: seed it with
`npm run demo:reset` as above or through the back-office. The databases can instead
persist to MongoDB: set `MONGO_URL` on the Render service (e.g. an Atlas free-tier connection string; each service takes
its own database `seats_<service>` on it, or `<SERVICE>_MONGO_URL` per service) and everything survives a sleep; see
`packages/store/` and "Inside a service" below.

**Web apps on Vercel** (Hobby plan): import this repository twice, once with the root directory
`frontend/customer-web-app` and once with `frontend/back-office-web-app`. Each folder's `vercel.json` sets the
install and build commands (they run from the repository root, so the shared client builds too), the output
directory and the rewrites: `/api/*` and `/health` go to the Render backend, so the apps stay same-origin and need no
CORS, and every other path serves `index.html` for the client-side routes. No environment variable is needed. After
the first deploy, `https://<app>.vercel.app/health` must answer the backend's health JSON; the customer app's URL is
the one to register as the LIFF endpoint later (ADR-01).

## Inside a service

TypeScript throughout (ES modules, `strict`), the same three layers in every service, and one rule between them:
the domain depends on nothing outside itself, the infrastructure depends on the domain, the API layer on both.
`npm run typecheck` runs `scripts/check-layers.mjs`, which fails on any import that breaks the rule.

| Folder | Holds |
|---|---|
| `src/domain/` | the pure core: `model.ts` (the types of the data model), `repository.ts` (the repository interfaces, one per aggregate, with domain-named queries), `ports.ts` (every interface the rules need from outside, repositories, external systems, collaborator services, and the `ports` holder the rules call), one file per use case (`zone-maps.ts`, `rounds.ts`, `booking.ts`, `expiry.ts`, …), `index.ts` the barrel. Imports only `@seats/errors` and message types |
| `src/infrastructure/` | the implementations of the ports: `store.ts` (the database, `@seats/store`), `repositories.ts` (the repositories over it), `adapters.ts` (the external systems and their fakes), `clients.ts` (the gRPC clients of the services it calls, each call with a deadline), `index.ts` whose `wire()` binds them to the domain's ports |
| `src/api/` | `handlers.ts`, one function per gRPC method, request message in, response message out, the domain's failures mapped by `toServiceError`; `grpc.ts`, the gRPC server over the handlers plus `grpc.health.v1.Health` |
| `src/server.ts` | the composition root: connect the store, `wire()`, seed, start gRPC |
| `test/` | unit tests of the domain through the in-memory infrastructure, the clients stubbed on the client objects |

The rules reach the outside only through `ports` (`ports.rounds.publishedOnMap(id)`, `ports.mediaStorage.store(…)`,
`ports.concertRound.getRound(id)`). `wire()` binds the real implementations once at start-up; the monolith calls each
service's `wire()` and then patches the client objects for in-process calls, and the unit tests call it before stubbing.
A port read before `wire()` throws a clear error instead of an undefined access.

Every service serves the standard health check; the gateway's `GET /health` calls each of them.

**Failures.** `packages/errors` tells three kinds apart, and its `toServiceError()` is the one place they become a gRPC
status. A `DomainError` is a rule saying no, with a kind (`invalid`, `not_found`, `conflict`, `unauthenticated`,
`not_implemented`) that the API layer maps to INVALID_ARGUMENT, NOT_FOUND, FAILED_PRECONDITION, UNAUTHENTICATED or
UNIMPLEMENTED; the domain never sees an HTTP or gRPC code. An `InfrastructureError` is something the service depends on
not answering, a collaborator service, the database or an external system behind an adapter: UNAVAILABLE, with the
system named in `details`, retryable. Anything else thrown is a defect: logged with its stack under a reference id and
answered INTERNAL with the reference only, so no stack or internal message reaches a client. The gateway maps the
gRPC status to HTTP (400, 401, 404, 409, 501, 502, 504, 500).

**Persistence (ADR-06).** `packages/store` holds the one repository contract, `Collection<T>` with `get`, `put`,
`insert`, `delete`, `list` and `find`, all asynchronous, every read a copy, and two implementations: in memory, and
MongoDB through Mongoose. A service binds to it in `src/infrastructure/store.ts` and chooses at start-up: `<SERVICE>_MONGO_URL` names
the service's own database, `MONGO_URL` names a cluster on which the service takes the database `seats_<service>`,
nothing means memory (development, the tests, the demo deployment). `insert()` fails on an existing id on both stores,
which is how the Booking Service keeps first-lock-wins on a table (ADR-13). `npm -w packages/store test` runs the
contract against memory, and against MongoDB too when `TEST_MONGO_URL` is set. The whole system on a local MongoDB:

```bash
docker run -d -p 27017:27017 mongo:7
MONGO_URL=mongodb://localhost:27017 npm run dev:mono     # six databases seats_* on it; data survives a restart
```

## External systems: adapters and their fakes

The LINE Platform, the Payment Gateway and the object storage are reached only through an adapter, a module of the
component that uses it (project document, Table 5.2). Each adapter is a port with a fake behind it in progress 1; the
real implementation replaces the fake by configuration, and the tests inject their own doubles through the same port.

| Port | Where | Fake (default) | Selected by |
|---|---|---|---|
| LINE Login: verify an ID token | `gateway/src/adapters.ts` | accepts `Authorization: Bearer fake-line-<LINE user id>` | `LINE_LOGIN=fake` |
| LINE Messaging: push a message | `services/notification/src/infrastructure/adapters.ts` | logs the push and records it; a test can make the next pushes fail, which the retry job of FR-22 then retries three times | `LINE_MESSAGING=fake` |
| Payment Gateway: open a checkout, verify a result's signature | `services/payment/src/infrastructure/adapters.ts` | the simulated gateway of ADR-11: a fake checkout URL, the signature `sim-<payment id>` | `PAYMENT_GATEWAY=simulated` |
| Media Storage: store the image of a zone map | `services/concert-round/src/infrastructure/adapters.ts` | answers a URL without storing; a test can make the next store fail (UC-04 EF-3) | `MEDIA_STORAGE=fake` |

The gateway therefore accepts two identities: the progress-1 headers `x-user-id` and `x-role` (staff, and the web
apps for now) or a LINE ID token as `Authorization: Bearer …`, verified by the LINE Login Adapter, which makes the
caller a customer.

## Progress 1 stubs

- **Auth**: the web apps still send the headers `x-user-id` and `x-role` (`customer`, `manager`, `front_staff`,
  `owner`); the LIFF app will send the LINE ID token instead. Staff can already sign in at the Staff Account Service
  (`POST /api/sessions`), which seeds `manager/manager`, `door1/door1` and `owner/owner`; the staff routes do not check
  the session token yet.
- **Storage**: every service keeps its data in memory behind `src/infrastructure/store.ts` unless `MONGO_URL` is set.
- **Payment**: the Booking Service's `startPayment()` still answers 501; wiring it to the Payment Service comes in
  progress 2. The simulated gateway's result is posted to `POST /api/payments/webhook`.
- **Notifications**: the Booking Service does not call the Notification Service yet.
- **Not built yet**: check-in (501).

## Kong gateway deployment

`Frontend -> Kong (authentication) -> REST-to-gRPC adapter (roles and mapping) -> services`

Kong loads the custom `seats-auth` plugin from `gateway/kong/plugins/`. Staff sign-in
still uses `POST /api/sessions` and the existing username/password store. Send the
returned opaque token as `Authorization: Bearer <token>`. Kong validates it against
Staff Account's private `/internal/session` endpoint on port 5007 on every request;
sign-out, disabled accounts and changed roles are immediately reflected. This HTTP
endpoint is an internal authentication-control interface; business operations and
service-to-service calls continue to use gRPC.

Kong strips client identity headers and supplies verified `x-user-id` and `x-role`.
The adapter checks route roles and translates REST/JSON to protobuf/gRPC. In Compose,
it requires `AUTH_MODE=kong` and a shared secret header injected by Kong. Neither the
adapter, introspection endpoint nor gRPC ports are published to the host. Only Kong
is published at `http://localhost:4000`. The Admin API is disabled.

`GET /health`, `POST /api/sessions`, and `POST /api/payments/webhook` are anonymous.
The payment service still validates webhook signatures. Other operations require a
bearer token. Kong returns 401 for invalid credentials and 503 when verification is
unavailable; the adapter returns 403 for a role without permission.

### Setup and tests

Create a random shared secret in an untracked `.env` before starting a fresh clone:

```sh
node -e "require('fs').writeFileSync('.env', 'SEATS_ADAPTER_SECRET='+require('crypto').randomBytes(32).toString('hex')+'\n', {flag:'wx'})"
docker compose up --build -d
curl http://localhost:4000/health
node demo/kong-auth.mjs
npm run smoke
```

A `.env` has already been generated in the current working checkout. Never commit it.
The auth integration script checks spoofed headers, invalid tokens, sign-in, customer
role denial and session revocation. The smoke script checks the booking and manager
flows. Configuration validation:

```sh
docker compose run --rm --no-deps gateway kong config parse /etc/kong/kong.yml
```

Restart Kong after changing the plugin or declarative file. Recreate both Kong and
the adapter after rotating `SEATS_ADAPTER_SECRET`.

### LINE mode

The existing project implements simulated LINE login only. The declarative file
explicitly selects `line_mode: fake`, accepting `fake-line-<user id>` tokens as
customers. This is demo authentication and lets anyone select a customer identity.
The customer demo UI now sends such a bearer token; old browser sessions without a
token must sign out and log in again. Staff tokens always use the actual session store.

For real LINE ID tokens, set `line_mode: line` and `line_channel_id` to your LINE Login
channel ID in `gateway/kong/kong.yml`, then restart Kong. The plugin calls LINE's
HTTPS verification endpoint and checks issuer, audience and expiry. The customer UI
must obtain a real ID token from LIFF/LINE Login rather than the demo dialog; that
provider/UI setup requires your channel configuration and is not supplied here.
Real LINE verification has not been exercised against a live channel.

Direct Node development (`npm run dev`, `npm run dev:mono`), in-process tests and the
hosted Render monolith keep their legacy auth behavior and bypass Kong. Frontend
identity headers are retained solely for that compatibility; Kong always replaces
them. These development modes are not the protected Compose deployment.
