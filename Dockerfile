# One image per service, built from the repo root so that proto/ is inside the image; TypeScript is compiled here.
#   docker build --build-arg SERVICE=services/booking -t seats-booking .
FROM node:20-alpine
WORKDIR /app
ARG SERVICE
ENV SERVICE=$SERVICE
COPY package.json tsconfig.base.json ./
COPY proto/package.json proto/
COPY packages/config/package.json packages/config/
COPY packages/errors/package.json packages/errors/
COPY packages/store/package.json packages/store/
COPY gateway/package.json gateway/
COPY monolith/package.json monolith/
COPY services/concert-round/package.json services/concert-round/
COPY services/table-availability/package.json services/table-availability/
COPY services/booking/package.json services/booking/
COPY services/payment/package.json services/payment/
COPY services/notification/package.json services/notification/
COPY services/staff-account/package.json services/staff-account/
RUN npm install
COPY proto ./proto
COPY packages ./packages
COPY gateway ./gateway
COPY monolith ./monolith
COPY services ./services
RUN npm run build
# Shared packages are source-only; tsx resolves their .js imports to TypeScript.
CMD ["sh", "-c", "exec node --import tsx $SERVICE/src/server.ts"]
