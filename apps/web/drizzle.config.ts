import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "../../packages/domain/src/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: postgresUrl(),
    },
});

function postgresUrl() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");

    const url = new URL(databaseUrl);
    url.searchParams.set("client_min_messages", "warning");
    return url.toString();
}
