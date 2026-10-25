# Progress video: service discovery and NFRs (target 4 minutes 40 seconds)

Run from the SEATS code directory: `assignments/group/code`.

## 0:00–0:35 — Architecture

Say: "SEATS uses REST at its public boundary and gRPC between its backend components.
The frontend calls Kong on port 4000. Kong authenticates the bearer token. The internal
REST-to-gRPC adapter checks operation roles and maps JSON requests to protobuf calls.
Services also call each other directly through gRPC. Only Kong has a published backend
port in our Compose deployment."

Show: `docker compose ps` and the service block in `gateway/kong/kong.yml`.

## 0:35–1:25 — Service discovery

Say: "We use DNS-based service discovery provided by Docker Compose. Each container
is registered under its service name on the Compose network. Kong's upstream is
rest-adapter:4000. The adapter discovers services by names such as booking:5002,
and Booking calls concert-round and table-availability by their names. The IP
addresses are allocated by Docker; our configuration does not hard-code them.
Kong consumes DNS discovery; it is not a separate service registry. Routing rules
are declarative, while DNS supplies the current container address."

Show the addresses in `docker-compose.yml`, then run:

```powershell
docker compose exec -T rest-adapter node -e "const dns=require('node:dns').promises; Promise.all(['rest-adapter','concert-round','booking','table-availability','payment','notification','staff-account'].map(async name=>console.log(name,JSON.stringify(await dns.lookup(name,{all:true})))))"
curl.exe http://localhost:4000/health
```

Explain: DNS output proves names resolve; `/health` proves the adapter can reach the
six services over gRPC. Health checks are separate from discovery. This does not
prove automatic failover, multiple-instance balancing, or zero-downtime recovery.
When containers are replaced their address may change; reconnection and DNS caching
must also be tested before claiming seamless recovery.

## 1:25–2:25 — Security / NFR-44 (partial evidence)

Say: "Our security goal is to protect account and reservation access. Kong validates
staff bearer tokens against the existing Staff Account session store. It strips
client-supplied identity headers and sends verified identity to the adapter. The
adapter accepts only requests with Kong's shared secret and then enforces route roles.
Revocation and role changes are checked on every staff request."

Run:

```powershell
node demo/kong-auth.mjs
```

Point out: forged identity gives 401; valid staff login succeeds; a customer trying a
staff operation gets 403; changed roles are reflected; disabled accounts and signed-out
tokens get 401. These checks support the access-control part of NFR-44, not the entire
customer-data protection requirement. Customer login currently uses explicit demo LINE
tokens. Real LINE verification is implemented but untested with a live channel, so do
not claim NFR-36 is satisfied. Local HTTP also does not satisfy NFR-39's TLS requirement.

## 2:25–3:45 — Concurrency and latency

Say: "We test system behavior through Kong, rather than infer performance from the
choice of gateway. NFR-20 requires exactly one winning hold among at least 50
simultaneous attempts. NFR-01 requires five hold requests per second. NFR-04 specifies
a 95th percentile response time below two seconds under that load."

Run:

```powershell
node demo/nfr-check.mjs
```

Explain: the script creates a separate 60-table fixture. First it sends 50 attempts
for the same table, then schedules 50 requests for different free tables every 200 ms
(5 requests/sec over roughly 10 seconds). Timing includes the HTTP response body.
It checks statuses and p95, releases all test holds, and writes `demo/nfr-results.json`.
Named venue fixtures remain; it does not reset existing demo data.

Measured on this local Compose deployment:

- Contention: 1 winner and 49 conflicts out of 50 attempts.
- Scheduled hold rate: 5 requests/sec; observed launch rate: 5/sec.
- Independent holds: 50 successes out of 50.
- Hold API p95: read the latest `demo/nfr-results.json`; compare it with the 2,000 ms threshold.

Say: "This passes our local sample for NFR-20 and NFR-01 and the hold-API portion of
NFR-04. It is a short single-instance test with simulated customer tokens and an
in-memory booking store. It does not establish full NFR-04 compliance, sustained
production capacity or correctness across replicas."

## 3:45–4:40 — Evidence and remaining work

Show `demo/nfr-results.json`, and say:

"We have demonstrated service-name resolution, live gRPC connectivity, access-control
checks, contention handling and measured hold latency through Kong. Our next checks
are longer load runs, 200 browsing customers with 50 percent headroom (300 clients),
page-load and ticket-verification latency, real LINE tokens, HTTPS, persistent booking
storage, and recovery tests. The 99.5 percent availability requirement needs monitoring
over its specified rolling period; today's health check cannot establish that."

Keep the final recording below five minutes. Prebuild containers before recording,
use a readable terminal font, and do not display `.env` or token values.

## Requirement evidence matrix

| Requirement | Evidence | Accurate status |
|---|---|---|
| NFR-01: at least 5 hold requests/sec | `demo/nfr-check.mjs` | Passed short local sample |
| NFR-04: p95 <=2 sec for page loads, holds, ticket verification | Measured hold API only | Partial; other operations and longer load pending |
| NFR-20: exactly one winner among >=50 attempts | 50 concurrent API requests | Passed single-instance local sample |
| NFR-44: protect customer info and credentials | `demo/kong-auth.mjs`, adapter secret test | Access-control evidence only |
| NFR-36: real LINE ID tokens validated server-side | Real-mode implementation; current demo mode | Not demonstrated |
| NFR-39: all traffic uses TLS >=1.2 | Local gateway is HTTP, gRPC is plaintext | Not met by local deployment |
| NFR-27: 200 browsing customers, 60 tables, 50% headroom | 60-table fixture only | 300-client browsing test pending |
| NFR-19: 99.5% availability over rolling 12 months | Health endpoint only | Not established |
| NFR-02: recovery within two hours | No timed recovery exercise | Not demonstrated |

References:
- Project requirements: `../workspace/report/project-document/03-requirements.md` relative to the code repository.
- Docker discovery: https://docs.docker.com/compose/how-tos/networking/
- Kong DNS routing: https://developer.konghq.com/gateway/traffic-control/load-balancing-reference/
