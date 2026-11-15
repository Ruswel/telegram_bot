import { Bot } from "grammy"
import { registerCommands } from "./src/commands.js"

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is missing")
  process.exit(1)
}

const bot = new Bot(token)
registerCommands(bot)

bot.catch((err) => {
  console.error("[bot] update error:", err.error ?? err)
})

async function main() {
  const me = await bot.api.getMe()
  console.log(`[bot] logged in as @${me.username}`)

  // Polling is the simplest mode and does not require a public URL.
  await bot.api.deleteWebhook().catch(() => {})
  await bot.start({
    onStart: () => console.log("[bot] polling for updates"),
  })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.log(`[bot] ${signal}, stopping`)
    bot.stop()
  })
}

main().catch((err) => {
  console.error("[bot] fatal error:", err)
  process.exit(1)
})
