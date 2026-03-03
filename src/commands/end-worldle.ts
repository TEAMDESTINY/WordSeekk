import { Composer } from "grammy";

import { db } from "../config/db";
import countries from "../data/countries.json";
import { CommandsHelper } from "../util/commands-helper";
import { revealWorldleResult } from "../handlers/on-message";

const composer = new Composer();

composer.command("endworldle", async (ctx) => {
  if (!ctx.chat) return;

  const chatId = ctx.chat.id.toString();
  const topicId = ctx.msg?.message_thread_id?.toString() || "general";

  const game = await db
    .selectFrom("worldleGames")
    .selectAll()
    .where("chatId", "=", chatId)
    .where("topicId", "=", topicId)
    .executeTakeFirst();

  if (!game) {
    return ctx.reply("No active Worldle game here.");
  }

  const country = countries.find((c) => c.code === game.countryCode);
  if (!country) {
    return ctx.reply("Something went wrong.");
  }

  await revealWorldleResult(ctx, game.id, country, false);
});

CommandsHelper.addNewCommand("endworldle", "End Worldle Game");

export const endWorldleCommand = composer;
