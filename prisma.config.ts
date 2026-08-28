// Prisma 7 CLI configuration.
//
// `dotenv/config` is required: unlike Prisma 6, the Prisma 7 CLI does NOT load
// .env automatically. Without this import the CLI sees no connection string.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Supabase owns everything in the `auth` schema. It only appears in our schema
// because public.admin_users has a foreign key to auth.users, and Prisma won't
// model a cross-schema relation unless both schemas are declared.
//
// Marking them external means Prisma will never emit a migration that alters or
// drops them. Without this, a future `prisma migrate` could try to recreate
// Supabase's auth tables — which would take your logins down with it.
const supabaseAuthTables = [
  "auth.audit_log_entries",
  "auth.custom_oauth_providers",
  "auth.flow_state",
  "auth.identities",
  "auth.instances",
  "auth.mfa_amr_claims",
  "auth.mfa_challenges",
  "auth.mfa_factors",
  "auth.oauth_authorizations",
  "auth.oauth_client_states",
  "auth.oauth_clients",
  "auth.oauth_consents",
  "auth.one_time_tokens",
  "auth.refresh_tokens",
  "auth.saml_providers",
  "auth.saml_relay_states",
  "auth.schema_migrations",
  "auth.sessions",
  "auth.sso_domains",
  "auth.sso_providers",
  "auth.users",
  "auth.webauthn_challenges",
  "auth.webauthn_credentials",
];

const supabaseAuthEnums = [
  "auth.aal_level",
  "auth.code_challenge_method",
  "auth.factor_status",
  "auth.factor_type",
  "auth.oauth_authorization_status",
  "auth.oauth_client_type",
  "auth.oauth_registration_type",
  "auth.oauth_response_type",
  "auth.one_time_token_type",
];

export default defineConfig({
  // Required to use tables.external / enums.external below.
  experimental: { externalTables: true },
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // The CLI (db pull, migrate, studio) needs a real session, which the
    // transaction pooler on port 6543 cannot give it. So the CLI uses
    // DIRECT_URL (session pooler, port 5432) while Prisma Client uses
    // DATABASE_URL at runtime — see lib/prisma.ts.
    url: env("DIRECT_URL"),
  },
  tables: { external: supabaseAuthTables },
  enums: { external: supabaseAuthEnums },
});
