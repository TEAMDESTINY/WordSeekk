import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("worldle_games")
    .addColumn("id", "integer", (col) =>
      col.primaryKey().generatedByDefaultAsIdentity(),
    )
    .addColumn("chat_id", "text", (col) => col.notNull())
    .addColumn("topic_id", "text", (col) => col.notNull())
    .addColumn("country_code", "varchar(2)", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("worldle_guesses")
    .addColumn("id", "integer", (col) =>
      col.primaryKey().generatedByDefaultAsIdentity(),
    )
    .addColumn("game_id", "integer", (col) =>
      col.references("worldle_games.id").onDelete("cascade").notNull(),
    )
    .addColumn("guess_code", "varchar(2)", (col) => col.notNull())
    .addColumn("distance_km", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await sql`
    CREATE UNIQUE INDEX worldle_active_game_unique
    ON worldle_games (chat_id, topic_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("worldle_guesses").ifExists().execute();
  await db.schema.dropTable("worldle_games").ifExists().execute();
}
