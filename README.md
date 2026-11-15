# Personal Telegram Downloader

A private Telegram bot for downloading publicly accessible videos from YouTube, Instagram Reels, TikTok and Pinterest.

## Required environment variables

Set these in your hosting dashboard (never commit them):

- `TELEGRAM_BOT_TOKEN` — token from @BotFather.
- `ADMIN_USER_ID` — your numeric Telegram user ID. Get it by sending `/id` to the bot, then add it here and redeploy.

Until `ADMIN_USER_ID` is configured, the bot only responds with setup/help information and does not download anything.

## Run

```sh
npm install
npm start
```

The host must provide Node.js 20+ and allow outbound HTTPS connections to Telegram and supported video sites. The `youtube-dl-exec` package downloads the yt-dlp executable during installation.

## Current limits

- One active download per chat.
- Up to 720p where available.
- 45 MB maximum output size (Telegram cloud Bot API upload limit).
- 15-minute maximum duration.
- Eight-minute download timeout.
- Temporary files are removed after each attempt.

Some sites or individual videos may require login, be private, region-blocked, or change their extraction behaviour. The bot does not bypass DRM, paywalls, or access controls. Only download content you are allowed to save.

## Hosting note

This starter uses Telegram long polling. Run only one active instance with this bot token.
