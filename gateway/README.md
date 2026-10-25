# Gateway package

Docker Compose uses Kong authentication and this package as the internal REST-to-gRPC adapter.
See [Kong gateway deployment](#kong-gateway-deployment) below for the current deployment.

## Legacy direct Node development

The following describes direct Node/monolith development, which bypasses Kong.


REST :4000. The only component the Frontend calls and the only REST API of the system (Figure 5.1, ADR-12). It
authenticates the caller, checks the role of the route (FR-66) and makes one gRPC call to the service that owns the
operation: path, query and JSON body in, the response message as JSON out, the gRPC status mapped to an HTTP status
(`docs/contracts.md`). It holds no business logic.

Progress 1 auth is fake: send `x-user-id` (a LINE user id for a customer, a staff account for the back-office) and
`x-role` (`customer`, `manager`, `front_staff`, `owner`); the gateway passes both to the service as gRPC metadata.
Two routes need no headers (`auth: 'none'`): `POST /api/sessions` (staff sign-in at the Staff Account Service, 401 on
a wrong password) and `POST /api/payments/webhook` (the simulated Payment Gateway's callback, checked by its
signature). `DELETE /api/sessions/current` takes the token from `Authorization: Bearer <token>`, else from
`x-user-id`. LINE ID tokens (ADR-01) and checking the staff token on every route (ADR-07) come later.

- `src/routes.ts` — the route table: one line per route, type-checked against the generated request messages.
- `src/clients.ts` — the gRPC clients of the six services and their health checks (`GET /health` lists all six).
- `src/server.ts` — Express, auth, the call, the status mapping, `GET /health`.

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
