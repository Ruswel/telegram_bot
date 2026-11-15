import { mkdtemp, readdir, stat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import youtubedl from "youtube-dl-exec"

const MAX_BYTES = 45 * 1024 * 1024
const MAX_DURATION_SECONDS = 15 * 60
const DOWNLOAD_TIMEOUT_MS = 8 * 60 * 1000
const activeJobs = new Map()

const SUPPORTED_HOSTS = [
  "youtube.com", "youtu.be", "youtube-nocookie.com",
  "instagram.com", "instagr.am",
  "pinterest.com", "pin.it",
  "tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
]

function isSupportedUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return false
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    return SUPPORTED_HOSTS.some((domain) => host === domain || host.endsWith("." + domain))
  } catch {
    return false
  }
}

function isAdmin(ctx) {
  const adminId = process.env.ADMIN_USER_ID?.trim()
  return Boolean(adminId && String(ctx.from?.id) === adminId)
}

function helpText() {
  return [
    "🎬 Personal Downloader",
    "",
    "Отправь ссылку на видео — попробую скачать его и вернуть сюда.",
    "",
    "Поддерживаются YouTube / Shorts, Instagram Reels, TikTok и видео Pinterest.",
    "Качество: до 720p, если площадка его предоставляет.",
    "Лимит файла: 45 МБ; длительность: до 15 минут.",
    "",
    "/start — начало",
    "/help — помощь",
    "/id — узнать свой Telegram ID",
    "/cancel — отменить текущую загрузку",
  ].join("\n")
}

async function runYtDlp(url, outputTemplate, onProcess) {
  let stderr = ""
  let child
  let timer

  try {
    child = youtubedl.exec(url, {
      noPlaylist: true,
      maxDownloads: 1,
      maxFilesize: "45M",
      matchFilter: `duration <= ${MAX_DURATION_SECONDS}`,
      format: "best[height<=720][ext=mp4]/best[height<=720]/best",
      output: outputTemplate,
      noPart: true,
      noProgress: true,
      noWarnings: true,
      socketTimeout: 25,
      retries: 1,
      fragmentRetries: 1,
    })

    onProcess(child)
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-6000)
    })

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        child.kill("SIGKILL")
        reject(new Error("Превышено время ожидания загрузки (8 минут)."))
      }, DOWNLOAD_TIMEOUT_MS)
    })

    // youtube-dl-exec returns a thenable child process. Await it so a failed
    // yt-dlp run is handled here instead of becoming an unhandled rejection.
    await Promise.race([child, timeout])
  } catch (error) {
    const detail = (stderr + "\n" + (error?.stderr || "") + "\n" + (error?.message || "")).toLowerCase()

    if (detail.includes("sign in to confirm") || detail.includes("not a bot") || detail.includes("cookies")) {
      throw new Error("YouTube bloqueó la descarga: necesita cookies de una sesión iniciada. Prueba otra plataforma o configura cookies.")
    }
    if (detail.includes("private") || detail.includes("login") || detail.includes("sign in")) {
      throw new Error("La plataforma requiere iniciar sesión o el vídeo es privado.")
    }
    if (detail.includes("maximum file size") || detail.includes("file is larger")) {
      throw new Error("El vídeo supera el límite de 45 МБ.")
    }
    if (detail.includes("duration") || detail.includes("match-filter")) {
      throw new Error("El vídeo dura más de 15 минут o no cumple las restricciones.")
    }
    if (error?.message?.includes("8 минут")) throw error

    console.error("[yt-dlp] download failed:", error?.message || error)
    throw new Error("No se pudo descargar el vídeo. El enlace puede estar inaccesible o la plataforma puede estar bloqueando la solicitud.")
  } finally {
    if (timer) clearTimeout(timer)
    onProcess(null)
  }
}

export function registerCommands(bot) {
  bot.command("start", async (ctx) => {
    const suffix = isAdmin(ctx)
      ? "\n\n✅ Доступ к скачиванию настроен."
      : "\n\nТвой ID: " + (ctx.from?.id ?? "неизвестен") + "\nВладелец должен указать этот ID в ADMIN_USER_ID в настройках хостинга."
    await ctx.reply("Привет! Я твой личный загрузчик видео." + suffix + "\n\n" + helpText())
  })

  bot.command("help", (ctx) => ctx.reply(helpText()))
  bot.command("id", (ctx) => ctx.reply(`Твой Telegram ID: ${ctx.from?.id ?? "unknown"}\nChat ID: ${ctx.chat.id}`))

  bot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("Бот ещё не настроен для твоего Telegram ID.")
    const job = activeJobs.get(ctx.chat.id)
    if (!job) return ctx.reply("Сейчас ничего не скачивается.")
    job.kill("SIGTERM")
    activeJobs.delete(ctx.chat.id)
    await ctx.reply("Отмена запрошена.")
  })

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim()
    if (text.startsWith("/")) return
    if (!isAdmin(ctx)) {
      return ctx.reply("Доступ пока не настроен. Отправь /id и добавь свой ID в переменную ADMIN_USER_ID в настройках FadeHost.")
    }

    const match = text.match(/https?:\/\/\S+/i)
    if (!match || !isSupportedUrl(match[0])) {
      return ctx.reply("Пришли ссылку на YouTube, Instagram Reels, TikTok или Pinterest.")
    }

    if (activeJobs.has(ctx.chat.id)) {
      return ctx.reply("У тебя уже идёт загрузка. Дождись её окончания или отправь /cancel.")
    }

    const url = match[0].replace(/[),.!?]+$/, "")
    const status = await ctx.reply("⏬ Проверяю ссылку и начинаю загрузку…")
    let directory

    try {
      directory = await mkdtemp(path.join(tmpdir(), "tg-downloader-"))
      const outputTemplate = path.join(directory, "%(title).80B-%(id)s.%(ext)s")
      await runYtDlp(url, outputTemplate, (child) => {
        if (child) activeJobs.set(ctx.chat.id, child)
        else activeJobs.delete(ctx.chat.id)
      })

      const files = await readdir(directory)
      const candidates = await Promise.all(files.map(async (name) => {
        const fullPath = path.join(directory, name)
        const info = await stat(fullPath)
        return info.isFile() ? { fullPath, size: info.size, name } : null
      }))
      const file = candidates.filter(Boolean).sort((a, b) => b.size - a.size)[0]
      if (!file) throw new Error("Загрузчик не создал видеофайл.")
      if (file.size > MAX_BYTES) throw new Error("Файл больше лимита Telegram (45 МБ).")

      await ctx.api.editMessageText(ctx.chat.id, status.message_id, "📤 Загружаю видео в Telegram…")
      const caption = "Готово! 🎬"
      const ext = path.extname(file.name).toLowerCase()
      if (ext === ".mp4") {
        await ctx.replyWithVideo({ source: file.fullPath }, { caption, supports_streaming: true })
      } else {
        await ctx.replyWithDocument({ source: file.fullPath }, { caption })
      }
      await ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => {})
    } catch (error) {
      console.error("[download]", error)
      const message = error?.message || "Неизвестная ошибка."
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, "❌ " + message).catch(() => {})
    } finally {
      activeJobs.delete(ctx.chat.id)
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  })
}
