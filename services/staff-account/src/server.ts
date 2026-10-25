import { startSessionIntrospection } from './api/session-http.js';
import { grpcPort } from '@seats/config/src/index.js';
import { connectStore, wire } from './infrastructure/index.js';
import { startGrpc } from './api/grpc.js';
import { seedStaffAccounts } from './domain/index.js';

await connectStore();                                // the Staff Account DB (ADR-06): MongoDB with STAFF_ACCOUNT_MONGO_URL or MONGO_URL, else in memory
wire();                                              // binds the repositories to the domain's ports
await seedStaffAccounts();                            // progress 1: manager/manager, door1/door1, owner/owner (kept as they are when the DB has them)
startGrpc(grpcPort('staff-account'));                      // the only transport (ADR-12): the API Gateway calls it by gRPC

if (process.env.SESSION_INTROSPECTION_PORT) startSessionIntrospection(Number(process.env.SESSION_INTROSPECTION_PORT));
