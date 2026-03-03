import { Composer, InputFile } from "grammy";

import { join } from "path";
import { randomInt } from "crypto";

import { db } from "../config/db";
import countries from "../data/countries.json";
import { CommandsHelper } from "../util/commands-helper";

const composer = new Composer();

composer.command("worldle", async (ctx) => {
  if (!ctx.chat) return;

  const chatId = ctx.chat.id.toString();
  const topicId = ctx.msg.message_thread_id?.toString() || "general";

  const existing = await db
    .selectFrom("worldleGames")
    .selectAll()
    .where("chatId", "=", chatId)
    .where("topicId", "=", topicId)
    .executeTakeFirst();

  if (existing) {
    return ctx.reply("A Worldle game is already running here.");
  }

  const randomCountry = countries[randomInt(0, countries.length)];

  await db
    .insertInto("worldleGames")
    .values({
      chatId: chatId,
      topicId: topicId,
      countryCode: randomCountry.code,
    })
    .execute();

  const imagePath = join(
    process.cwd(),
    "src",
    "data",
    "countries",
    `${randomCountry.code.toLowerCase()}.png`,
  );

  await ctx.replyWithPhoto(new InputFile(imagePath), {
    caption: "🌍 Worldle started!\nGuess the country.",
  });
});

CommandsHelper.addNewCommand(
  "worldle",
  "Guess the country with map given and distance",
);

export const worldleCommand = composer;
