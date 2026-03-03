import { InputFile } from "grammy";
import { ReactionTypeEmoji } from "grammy/types";
import { Composer, Context, GrammyError } from "grammy";

import z from "zod";
import sharp from "sharp";
import { join } from "path";
import satori from "satori";
import { readFile } from "fs/promises";

import { db } from "../config/db";
import { redis } from "../config/redis";
import allSixWords from "../data/all-six.json";
import countries from "../data/countries.json";
import allFiveWords from "../data/all-five.json";
import allFourWords from "../data/all-four.json";
import { toFancyText } from "../util/to-fancy-text";
import { getDistanceKm } from "../util/get-distance";
import { requireAllowedTopic, runGuards } from "../util/guards";
import { formatDailyWordDetails } from "../util/format-word-details";
import { getCurrentGameDateString } from "../services/daily-wordle-cron";

const composer = new Composer();

type WordLength = 4 | 5 | 6;

const ALL_WORDS: Record<WordLength, string[]> = {
  4: allFourWords,
  5: allFiveWords,
  6: allSixWords,
};

const MODE_LABEL: Record<WordLength, string> = {
  4: "4-letter mode",
  5: "5-letter mode",
  6: "6-letter mode",
};

export const dailyWordleSchema = z.object({
  dailyWordId: z.number(),
  date: z.string(),
});

const normalize = (str: string) => str.trim().toLowerCase();

const countryMap = new Map(countries.map((c) => [c.code, c]));

async function handleWorldle(ctx: Context) {
  if (!ctx.msg || !ctx.chat || !ctx.message) return;

  const currentTopicId = ctx.msg.message_thread_id?.toString() || "general";
  const chatId = ctx.chat.id.toString();

  const worldleGame = await db
    .selectFrom("worldleGames")
    .selectAll()
    .where("chatId", "=", chatId)
    .where("topicId", "=", currentTopicId)
    .executeTakeFirst();

  if (!worldleGame) return;

  if (worldleGame) {
    const guessText = normalize(ctx.message.text ?? "");

    const guessedCountry = countries.find((c) => c.aliases.includes(guessText));

    if (!guessedCountry) return;

    const existingGuess = await db
      .selectFrom("worldleGuesses")
      .select("id")
      .where("gameId", "=", worldleGame.id)
      .where("guessCode", "=", guessedCountry.code)
      .executeTakeFirst();

    if (existingGuess) {
      return ctx.reply(`Someone has already guessed ${guessedCountry}`);
    }

    const correctCountry = countryMap.get(worldleGame.countryCode)!;

    const distance = getDistanceKm(
      guessedCountry.lat,
      guessedCountry.lng,
      correctCountry.lat,
      correctCountry.lng,
    );

    await db
      .insertInto("worldleGuesses")
      .values({
        gameId: worldleGame.id,
        guessCode: guessedCountry.code,
        distanceKm: distance,
      })
      .execute();

    if (guessedCountry.code === correctCountry.code) {
      await revealWorldleResult(ctx, worldleGame.id, correctCountry, true);
      return;
    }

    const guesses = await db
      .selectFrom("worldleGuesses")
      .selectAll()
      .where("gameId", "=", worldleGame.id)
      .orderBy("id", "asc")
      .execute();

    const guessLines = guesses
      .map((g, i) => {
        const country = countryMap.get(g.guessCode)!;
        return `${i + 1}. ${country.name} — ${g.distanceKm.toLocaleString()} km`;
      })
      .join("\n");

    const imagePath = join(
      process.cwd(),
      "src",
      "data",
      "countries",
      `${correctCountry.code.toLowerCase()}.png`,
    );

    await ctx.replyWithPhoto(new InputFile(imagePath), {
      caption: `🌍 Worldle\n\n<b>Distance from the country:</b>\n${guessLines}`,
      parse_mode: "HTML",
    });
  }
}

type Country =
  | {
      code: string;
      name: string;
      aliases: string[];
      flag: string;
      lat: number;
      lng: number;
      capital: string;
      region: string;
      population: number;
    }
  | {
      code: string;
      name: string;
      aliases: string[];
      flag: string;
      lat: number;
      lng: number;
      region: string;
      population: number;
      capital: undefined;
    };

export async function generateWorldleImage(country: Country): Promise<Buffer> {
  const silhouettePath = join(
    process.cwd(),
    "src",
    "data",
    "countries",
    `${country.code.toLowerCase()}.png`,
  );

  const silhouette = await readFile(silhouettePath);
  const greenSilhouette = await sharp(silhouette).tint("#2ecc71").toBuffer();

  const fontPath = join(process.cwd(), "src/fonts/roboto.ttf");
  const fontData = await readFile(fontPath);

  const svg = await satori(
    <div
      style={{
        display: "flex",
        width: 800,
        height: 400,
        background: "linear-gradient(145deg, #0a0f1e 0%, #111d2b 100%)",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Inter",
        color: "white",
      }}
    >
      {/* Decorative Background Orbs */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, transparent 70%)",
          top: -150,
          left: -150,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%)",
          bottom: -100,
          right: -50,
          display: "flex",
        }}
      />

      {/* World Map Dot Pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.1,
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.2) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          display: "flex",
        }}
      />

      {/* LEFT SIDE — Silhouette with colorize filter */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 320,
          position: "relative",
          background: "rgba(255, 255, 255, 0.02)",
          borderRight: "1px solid rgba(255, 255, 255, 0.05)",
        }}
      >
        {/* Silhouette Glow */}
        <div
          style={{
            position: "absolute",
            width: 240,
            height: 240,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, transparent 70%)",
            display: "flex",
          }}
        />

        {/* Silhouette Image */}
        <img
          src={`data:image/png;base64,${greenSilhouette.toString("base64")}`}
          style={{
            width: 200,
            height: 200,
            objectFit: "contain",
            filter:
              "invert(1) sepia(1) saturate(6) hue-rotate(100deg) brightness(0.85)",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 24,
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              color: "rgba(255,255,255,0.4)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 600,
            }}
          >
            Region
          </div>
          <div
            style={{
              display: "flex",
              color: "#fff",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {country.region}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE — Details */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          padding: "0 60px",
        }}
      >
        {/* Header: Flag + Code */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              borderRadius: 4,
              overflow: "hidden",
              width: 48,
              height: 32,
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            <img
              src={country.flag}
              style={{ width: 48, height: 32, display: "flex" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              color: "#10b981",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: 1.5,
            }}
          >
            {country.code}
          </div>
        </div>

        {/* Name */}
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-1.5px",
            lineHeight: 1.1,
            marginBottom: 32,
            color: "#ffffff",
          }}
        >
          {country.name}
        </div>

        {/* Grid Data - Improved Spacing for Long Names */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Row 1: Capital & Population */}
          <div style={{ display: "flex", gap: 40 }}>
            {/* Capital Column - Using flex: 1 to ensure space allocation */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                flex: 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Capital
              </div>
              <div
                style={{
                  display: "flex",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 18,
                  lineHeight: 1.3,
                  maxWidth: "240px",
                  wordBreak: "break-word",
                }}
              >
                {country.capital ?? "N/A"}
              </div>
            </div>

            {/* Population Column */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                flex: 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Population
              </div>
              <div
                style={{
                  display: "flex",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                {country.population.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Row 2: Coordinates */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                color: "rgba(255,255,255,0.4)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Coordinates
            </div>
            <div
              style={{
                display: "flex",
                color: "rgba(255,255,255,0.6)",
                fontSize: 15,
                fontWeight: 500,
                fontFamily: "monospace",
              }}
            >
              {country.lat.toFixed(2)}° N / {country.lng.toFixed(2)}° E
            </div>
          </div>
        </div>

        {/* Bottom Accent Line */}
        <div
          style={{
            display: "flex",
            marginTop: 36,
            height: 3,
            width: 80,
            borderRadius: 2,
            background: "linear-gradient(90deg, #10b981, transparent)",
          }}
        />
      </div>
    </div>,
    {
      width: 800,
      height: 400,
      fonts: [{ name: "Roboto", data: fontData, weight: 700 }],
    },
  );

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function handleWorldleWin(ctx: Context, country: Country) {
  const silhouettePath = join(
    process.cwd(),
    "src",
    "data",
    "countries",
    `${country.code.toLowerCase()}.png`,
  );

  const silhouette = await readFile(silhouettePath);
  const greenSilhouette = await sharp(silhouette).tint("#2ecc71").toBuffer();

  const fontPath = join(process.cwd(), "src/fonts/roboto.ttf");
  const fontData = await readFile(fontPath);

  const svg = await satori(
    <div
      style={{
        display: "flex",
        width: 800,
        height: 400,
        background: "linear-gradient(145deg, #0a0f1e 0%, #111d2b 100%)",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Inter",
        color: "white",
      }}
    >
      {/* Decorative Background Orbs */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, transparent 70%)",
          top: -150,
          left: -150,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%)",
          bottom: -100,
          right: -50,
          display: "flex",
        }}
      />

      {/* World Map Dot Pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.1,
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.2) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          display: "flex",
        }}
      />

      {/* LEFT SIDE — Silhouette with colorize filter */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 320,
          position: "relative",
          background: "rgba(255, 255, 255, 0.02)",
          borderRight: "1px solid rgba(255, 255, 255, 0.05)",
        }}
      >
        {/* Silhouette Glow */}
        <div
          style={{
            position: "absolute",
            width: 240,
            height: 240,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, transparent 70%)",
            display: "flex",
          }}
        />

        {/* Silhouette Image */}
        <img
          src={`data:image/png;base64,${greenSilhouette.toString("base64")}`}
          style={{
            width: 200,
            height: 200,
            objectFit: "contain",
            filter:
              "invert(1) sepia(1) saturate(6) hue-rotate(100deg) brightness(0.85)",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 24,
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              color: "rgba(255,255,255,0.4)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 600,
            }}
          >
            Region
          </div>
          <div
            style={{
              display: "flex",
              color: "#fff",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {country.region}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE — Details */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          padding: "0 60px",
        }}
      >
        {/* Header: Flag + Code */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              borderRadius: 4,
              overflow: "hidden",
              width: 48,
              height: 32,
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            <img
              src={country.flag}
              style={{ width: 48, height: 32, display: "flex" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              color: "#10b981",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: 1.5,
            }}
          >
            {country.code}
          </div>
        </div>

        {/* Name */}
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-1.5px",
            lineHeight: 1.1,
            marginBottom: 32,
            color: "#ffffff",
          }}
        >
          {country.name}
        </div>

        {/* Grid Data - Improved Spacing for Long Names */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Row 1: Capital & Population */}
          <div style={{ display: "flex", gap: 40 }}>
            {/* Capital Column - Using flex: 1 to ensure space allocation */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                flex: 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Capital
              </div>
              <div
                style={{
                  display: "flex",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 18,
                  lineHeight: 1.3,
                  maxWidth: "240px",
                  wordBreak: "break-word",
                }}
              >
                {country.capital ?? "N/A"}
              </div>
            </div>

            {/* Population Column */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                flex: 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Population
              </div>
              <div
                style={{
                  display: "flex",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                {country.population.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Row 2: Coordinates */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                color: "rgba(255,255,255,0.4)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Coordinates
            </div>
            <div
              style={{
                display: "flex",
                color: "rgba(255,255,255,0.6)",
                fontSize: 15,
                fontWeight: 500,
                fontFamily: "monospace",
              }}
            >
              {country.lat.toFixed(2)}° N / {country.lng.toFixed(2)}° E
            </div>
          </div>
        </div>

        {/* Bottom Accent Line */}
        <div
          style={{
            display: "flex",
            marginTop: 36,
            height: 3,
            width: 80,
            borderRadius: 2,
            background: "linear-gradient(90deg, #10b981, transparent)",
          }}
        />
      </div>
    </div>,
    {
      width: 800,
      height: 400,
      fonts: [{ name: "Roboto", data: fontData, weight: 700 }],
    },
  );

  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  await ctx.replyWithPhoto(new InputFile(png), {
    caption: `🎉 Correct! It was ${country.name}.`,
  });
}

export async function revealWorldleResult(
  ctx: Context,
  gameId: number,
  country: Country,
  isWin: boolean,
) {
  const guesses = await db
    .selectFrom("worldleGuesses")
    .selectAll()
    .where("gameId", "=", gameId)
    .execute();

  const imageBuffer = await generateWorldleImage(country);

  const caption = formatWorldleDetails(country, guesses.length, isWin);

  await ctx.replyWithPhoto(new InputFile(imageBuffer), {
    caption,
    parse_mode: "HTML",
  });

  await db.deleteFrom("worldleGuesses").where("gameId", "=", gameId).execute();
  await db.deleteFrom("worldleGames").where("id", "=", gameId).execute();
}

export function formatWorldleDetails(
  country: Country,
  guessCount: number,
  isWin: boolean,
): string {
  return `<blockquote>${isWin ? "🎉 Correct!" : "🎮 Game Ended"}
Country: <b>${country.name}</b>
Capital: ${country.capital ?? "N/A"}
Region: ${country.region}
Population: ${country.population.toLocaleString()}
Coordinates: ${country.lat.toFixed(2)}° / ${country.lng.toFixed(2)}°</blockquote>
<blockquote>Start another game with /worldle</blockquote>
`;
}

composer.on("message:text", async (ctx) => {
  const currentGuess = ctx.message.text?.toLowerCase();

  await handleWorldle(ctx);

  const isValidWord = /^[a-z]{4,6}$/.test(currentGuess ?? "");

  if (!isValidWord || currentGuess.startsWith("/")) {
    return;
  }

  const userId = ctx.from.id.toString();
  const chatId = ctx.chat.id.toString();

  if (ctx.chat.type === "private") {
    const dailyGameData = await redis.get(`daily_wordle:${userId}`);
    const result = dailyWordleSchema.safeParse(
      JSON.parse(dailyGameData || "{}"),
    );
    if (result.success) {
      const todayDate = getCurrentGameDateString();

      if (result.data.date !== todayDate) {
        await redis.del(`daily_wordle:${userId}`);
        return ctx.reply(
          "Your previous game has expired. Please start today's WordSeek with /daily",
        );
      }

      return handleDailyWordleGuess(ctx, currentGuess);
    }
  }

  const currentTopicId = ctx.msg.message_thread_id?.toString() || "general";

  const currentGame = await db
    .selectFrom("games")
    .selectAll()
    .where("activeChat", "=", ctx.chat.id.toString())
    .where("topicId", "=", currentTopicId)
    .executeTakeFirst();

  if (!currentGame) return;

  const guard = await runGuards(ctx, [requireAllowedTopic]);
  if (!guard.ok) return;

  const wordLength = currentGame.word.length as WordLength;
  const validWords = ALL_WORDS[wordLength];

  if (currentGuess.length !== wordLength) return;

  if (!validWords.includes(currentGuess))
    return ctx.reply(
      `${currentGuess} is not a valid ${wordLength}-letter word.`,
    );

  const guessExists = await db
    .selectFrom("guesses")
    .selectAll()
    .where("guess", "=", currentGuess)
    .where("chatId", "=", ctx.chat.id.toString())
    .executeTakeFirst();

  if (guessExists)
    return ctx.reply(
      "Someone has already guessed your word. Please try another one!",
    );

  if (currentGuess === currentGame.word) {
    if (!ctx.from.is_bot) {
      const allGuesses = await db
        .selectFrom("guesses")
        .selectAll()
        .where("gameId", "=", currentGame.id)
        .execute();

      const score = 30 - allGuesses.length;
      const additionalMessage = `Added ${30 - allGuesses.length} to the leaderboard.`;

      await db
        .insertInto("leaderboard")
        .values({
          score,
          chatId,
          userId,
          wordLength: wordLength.toString() as "4" | "5" | "6",
        })
        .execute();

      const formattedResponse = `<blockquote>Congrats! You guessed it correctly.\nCorrect Word: <b>${currentGuess}</b>\n${additionalMessage}</blockquote>\nStart with /new${wordLength}`;

      ctx.reply(formattedResponse, {
        reply_parameters: { message_id: ctx.message.message_id },
        parse_mode: "HTML",
      });
    } else {
      const additionalMessage = `Anonymous admins or channels don't get points.`;

      const formattedResponse = `<blockquote>Congrats! You guessed it correctly.\nCorrect Word: <b>${currentGuess}</b>\n</blockquote>${additionalMessage}\nStart with /new${wordLength}`;

      ctx.reply(formattedResponse, {
        reply_parameters: { message_id: ctx.message.message_id },
        parse_mode: "HTML",
      });
    }

    reactWithRandom(ctx);
    await db.deleteFrom("games").where("id", "=", currentGame.id).execute();
    return;
  }

  await db
    .insertInto("guesses")
    .values({
      gameId: currentGame.id,
      guess: currentGuess,
      chatId,
    })
    .execute();

  const allGuesses = await db
    .selectFrom("guesses")
    .selectAll()
    .where("gameId", "=", currentGame.id)
    .orderBy("createdAt", "asc")
    .execute();

  if (allGuesses.length === 30) {
    await db.deleteFrom("games").where("id", "=", currentGame.id).execute();
    return ctx.reply(
      "Game Over! The word was " +
        currentGame.word +
        `\nYou can start a new game with /new${wordLength}`,
    );
  }

  const modeLabel = MODE_LABEL[wordLength];
  let responseMessage =
    `<i>${modeLabel} · ${allGuesses.length}/30</i>\n\n` +
    toFancyText(getFeedback(allGuesses, currentGame.word));

  ctx.reply(responseMessage, {
    parse_mode: "HTML",
  });
});

async function handleDailyWordleGuess(ctx: Context, currentGuess: string) {
  const userId = ctx.from!.id.toString();

  if (!allFiveWords.includes(currentGuess)) {
    return ctx.reply(`${currentGuess.toUpperCase()} is not a valid word.`);
  }

  const todayDate = getCurrentGameDateString();

  const dailyWord = await db
    .selectFrom("dailyWords")
    .selectAll()
    .where("date", "=", new Date(todayDate))
    .executeTakeFirst();

  if (!dailyWord) {
    return ctx.reply(
      "Today's WordSeek is not available. Please try again later.",
    );
  }

  const existingGuesses = await db
    .selectFrom("dailyGuesses")
    .selectAll()
    .where("userId", "=", userId)
    .where("dailyWordId", "=", dailyWord.id)
    .orderBy("attemptNumber", "asc")
    .execute();

  if (existingGuesses.some((g) => g.guess === currentGuess)) {
    return ctx.reply("You've already guessed this word. Try a different one!");
  }

  const attemptNumber = existingGuesses.length + 1;
  await db
    .insertInto("dailyGuesses")
    .values({
      userId,
      dailyWordId: dailyWord.id,
      guess: currentGuess,
      attemptNumber,
    })
    .execute();

  const allGuesses = await db
    .selectFrom("dailyGuesses")
    .selectAll()
    .where("userId", "=", userId)
    .where("dailyWordId", "=", dailyWord.id)
    .orderBy("attemptNumber", "asc")
    .execute();

  if (currentGuess === dailyWord.word) {
    await handleDailyWordleWin(ctx, dailyWord, allGuesses);
    return;
  }

  if (allGuesses.length >= 6) {
    await handleDailyWordleLoss(ctx, dailyWord, allGuesses);
    return;
  }

  const imageBuffer = await generateWordleImage(allGuesses, dailyWord.word);
  const attemptsLeft = 6 - allGuesses.length;

  await ctx.replyWithPhoto(new InputFile(new Uint8Array(imageBuffer)), {
    caption: `${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} remaining`,
  });
}

type DailyWord = {
  date: Date;
  dayNumber: number;
  meaning: string | null;
  phonetic: string | null;
  sentence: string | null;
  word: string;
};
async function handleDailyWordleWin(
  ctx: Context,
  dailyWord: DailyWord,
  allGuesses: GuessEntry[],
) {
  const userId = ctx.from!.id.toString();

  await redis.del(`daily_wordle:${userId}`);

  const userStats = await db
    .selectFrom("userStats")
    .selectAll()
    .where("userId", "=", userId)
    .executeTakeFirst();

  if (userStats) {
    const todayDateString = getCurrentGameDateString();
    const todayDate = new Date(todayDateString + "T00:00:00");

    let newStreak = 1;

    if (userStats.lastGuessed) {
      const lastGuessedDate = new Date(userStats.lastGuessed);
      lastGuessedDate.setHours(0, 0, 0, 0);

      const diffTime = todayDate.getTime() - lastGuessedDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        newStreak = userStats.currentStreak + 1;
      } else if (diffDays === 0) {
        newStreak = userStats.currentStreak;
      }
    }

    const newHighestStreak = Math.max(newStreak, userStats.highestStreak);

    await db
      .updateTable("userStats")
      .set({
        currentStreak: newStreak,
        highestStreak: newHighestStreak,
        lastGuessed: new Date().toISOString(),
      })
      .where("userId", "=", userId)
      .execute();

    const imageBuffer = await generateWordleImage(allGuesses, dailyWord.word);
    const shareText = generateWordleShareText(
      dailyWord.dayNumber,
      allGuesses,
      dailyWord.word,
    );

    await ctx.replyWithPhoto(new InputFile(new Uint8Array(imageBuffer)), {
      caption: `🎉 Congratulations! You guessed it in ${allGuesses.length} ${allGuesses.length === 1 ? "try" : "tries"}!\n\n🔥 Current Streak: ${newStreak}\n⭐ Highest Streak: ${newHighestStreak}\n\n${formatDailyWordDetails(dailyWord)}`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📤 Share",
              switch_inline_query: shareText,
            },
          ],
        ],
      },
    });

    reactWithRandom(ctx);
  }
}

export function generateWordleShareText(
  dayNumber: number,
  guesses: GuessEntry[],
  solution: string,
) {
  const totalAttempts = guesses.length;
  const attemptLine = `${dayNumber} ${totalAttempts}/6`;

  const lines = guesses.map((entry) => {
    const guess = entry.guess.toUpperCase();
    const sol = solution.toUpperCase();
    const result: string[] = [];

    const solutionCount: Record<string, number> = {};

    for (const c of sol) {
      solutionCount[c] = (solutionCount[c] || 0) + 1;
    }

    for (let i = 0; i < guess.length; i++) {
      if (guess[i] === sol[i]) {
        result[i] = "🟩";
        solutionCount[guess[i]]--;
      }
    }

    for (let i = 0; i < guess.length; i++) {
      if (result[i]) continue;
      if (solutionCount[guess[i]] > 0) {
        result[i] = "🟨";
        solutionCount[guess[i]]--;
      } else {
        result[i] = "⬛";
      }
    }

    return result.join("");
  });

  return `WordSeek ${attemptLine}\n\n${lines.join("\n")}\nTry yourself by using /daily command.`;
}

async function handleDailyWordleLoss(
  ctx: Context,
  dailyWord: DailyWord,
  allGuesses: GuessEntry[],
) {
  const userId = ctx.from!.id.toString();

  await redis.del(`daily_wordle:${userId}`);

  await db
    .updateTable("userStats")
    .set({
      currentStreak: 0,
      lastGuessed: new Date().toISOString(),
    })
    .where("userId", "=", userId)
    .execute();

  const imageBuffer = await generateWordleImage(allGuesses, dailyWord.word);
  const shareText = generateWordleShareText(
    dailyWord.dayNumber,
    allGuesses,
    dailyWord.word,
  );

  await ctx.replyWithPhoto(new InputFile(new Uint8Array(imageBuffer)), {
    caption: `Game Over! The word was: ${dailyWord.word.toUpperCase()}\n\n💔 Streak reset to 0\n\n${formatDailyWordDetails(dailyWord)}\n\nCome back tomorrow for a new challenge!`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📤 Share",
            switch_inline_query: shareText,
          },
        ],
      ],
    },
  });
}

export const onMessageHander = composer;

interface GuessEntry {
  id: number;
  guess: string;
  gameId?: number;
  dailyWordId?: number;
  attemptNumber?: number;
  createdAt: Date;
  updatedAt: Date;
}

function getFeedback(data: GuessEntry[], solution: string) {
  return data
    .map((entry) => {
      let feedback = "";
      const guess = entry.guess.toUpperCase();
      const solutionCount: Record<string, number> = {};

      for (const char of solution.toUpperCase()) {
        solutionCount[char] = (solutionCount[char] || 0) + 1;
      }

      const result = Array(guess.length).fill("🟥");
      for (let i = 0; i < guess.length; i++) {
        if (guess[i] === solution[i].toUpperCase()) {
          result[i] = "🟩";
          solutionCount[guess[i]]--;
        }
      }

      for (let i = 0; i < guess.length; i++) {
        if (result[i] === "🟥" && solutionCount[guess[i]] > 0) {
          result[i] = "🟨";
          solutionCount[guess[i]]--;
        }
      }

      feedback = result.join(" ");
      return `${feedback} ${guess}`;
    })
    .join("\n");
}

export async function generateWordleImage(
  data: GuessEntry[],
  solution: string,
) {
  const tiles = data.map((entry) => {
    const guess = entry.guess.toUpperCase();
    const solutionCount: Record<string, number> = {};

    for (const char of solution.toUpperCase()) {
      solutionCount[char] = (solutionCount[char] || 0) + 1;
    }

    const result = Array(guess.length).fill("absent");

    for (let i = 0; i < guess.length; i++) {
      if (guess[i] === solution[i].toUpperCase()) {
        result[i] = "correct";
        solutionCount[guess[i]]--;
      }
    }

    for (let i = 0; i < guess.length; i++) {
      if (result[i] === "absent" && solutionCount[guess[i]] > 0) {
        result[i] = "present";
        solutionCount[guess[i]]--;
      }
    }

    return { guess, result };
  });

  const getColor = (state: string) => {
    if (state === "correct") return "#538d4e";
    if (state === "present") return "#b59f3b";
    return "#3a3a3c";
  };

  const fontPath = join(process.cwd(), "src", "fonts", "roboto.ttf");
  const fontData = await readFile(fontPath);

  const tileSize = 60;
  const gap = 8;
  const padding = 20;

  const columnWidth = solution.length * tileSize + (solution.length - 1) * gap;
  const width = padding * 2 + columnWidth;
  const height = padding * 2 + 6 * tileSize + 5 * gap; // Always 6 rows for daily wordle

  // Pad with empty rows if less than 6 guesses
  const paddedTiles = [...tiles];
  while (paddedTiles.length < 6) {
    paddedTiles.push({
      guess: "     ",
      result: Array(5).fill("empty"),
    });
  }

  const svg = await satori(
    <div
      style={{
        display: "flex",
        background: "#121213",
        padding: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {paddedTiles.map(({ guess, result }, rowIdx) => (
          <div key={rowIdx} style={{ display: "flex", gap: "8px" }}>
            {guess.split("").map((letter, i) => (
              <div
                key={i}
                style={{
                  width: "60px",
                  height: "60px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    result[i] === "empty" ? "#3a3a3c" : getColor(result[i]),
                  color: result[i] === "empty" ? "#3a3a3c" : "white",
                  fontSize: "32px",
                  fontWeight: "bold",
                  border: result[i] === "empty" ? "2px solid #565758" : "none",
                }}
              >
                {letter.trim()}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>,
    {
      width,
      height,
      fonts: [
        {
          name: "Roboto",
          data: fontData,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

  return pngBuffer;
}

async function reactWithRandom(ctx: Context) {
  const emojis: ReactionTypeEmoji["emoji"][] = [
    "🎉",
    "🏆",
    "🤩",
    "⚡",
    "🫡",
    "💯",
    "❤‍🔥",
    "🦄",
  ];

  const shuffled = emojis.sort(() => Math.random() - 0.5);

  for (const emoji of shuffled) {
    try {
      await ctx.react(emoji);
      return;
    } catch (err) {
      if (
        err instanceof GrammyError &&
        err.description?.includes("REACTION_NOT_ALLOWED")
      ) {
        continue;
      } else {
        break;
      }
    }
  }
}
