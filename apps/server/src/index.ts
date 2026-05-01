import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { appConfig } from "./config.js";
import { initDb } from "./db.js";
import { registerRoutes } from "./routes.js";

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      sessionId: string;
    };
  }
}

async function start() {
  initDb();
  const app = Fastify({ logger: true });
  await app.register(cookie, { secret: appConfig.SESSION_SECRET });
  await app.register(cors, {
    origin: appConfig.WEB_ORIGIN,
    credentials: true
  });
  await registerRoutes(app);
  await app.listen({ port: appConfig.PORT, host: "0.0.0.0" });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
