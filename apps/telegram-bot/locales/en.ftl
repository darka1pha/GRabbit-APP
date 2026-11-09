## Home & onboarding

welcome-title = 🐰 Welcome to { $appName }!
welcome-description =
    { $slogan }

    ✨ What I can do:
    🔗 Download Media — Send any link from YouTube, Spotify, Instagram, TikTok, SoundCloud, X or Reddit.
    🎵 Song Finder (Shazam) — Send or forward a voice note, audio or video to identify the track and download it!
    🔎 Search — Type a song or video title to search and download directly.
    🚀 Inline Mode — Type @{ $botUsername } in any chat to share music with friends!

menu-btn-search = 🔎 Search
menu-btn-inline = ✨ Search from any chat
menu-btn-history = 📜 My downloads
menu-btn-status = ⏳ In progress
menu-btn-settings = ⚙️ Settings
menu-btn-help = ❓ Help
menu-btn-admin = 🛡️ Admin panel
menu-btn-home = 🏠 Main menu
menu-btn-refresh = 🔄 Refresh

## Help & about

help-title = ❓ How to use { $appName }
help-description =
    1. Send a link, or type a song or video name.
    2. Pick audio or a video quality.
    3. Your file arrives right here in the chat.

    Supported sites:
    • YouTube — videos, Shorts and audio
    • Spotify — single tracks as MP3
    • Instagram — public Reels and videos
    • SoundCloud — tracks and sets
    • TikTok, X (Twitter), Reddit — video and audio
    • 🎵 Music Recognition — send or forward any voice note, video or audio to identify it!

    Commands:
    /search — search music and videos
    /dl — download a link (in groups, reply /dl to a message with a link)
    /history — your recent downloads
    /status — downloads in progress
    /cancel — cancel a download
    /settings — language and default format
    /language — change language
    /about — about this bot
    
    In groups: send /dl, or start a message with @{ $botUsername } to search.

about-title = 🐰 About { $appName }
about-description =
    { $appName } is a fast, queue-based media download bot.

    Built with:
    • grammY (TypeScript)
    • BullMQ & Redis for background jobs
    • PostgreSQL
    • yt-dlp & FFmpeg / FFprobe
    • SSRF protection and rate limiting

## Language

language-select-title = 🌐 Choose your language / زبان خود را انتخاب کنید:
language-updated = ✅ Language set to English.
language-btn-en = 🇬🇧 English
language-btn-fa = 🇮🇷 فارسی
language-name = English

## Settings

settings-title = ⚙️ Settings
settings-current-language = 🌐 Language: { $language }
settings-tier = 👤 Account: { $tier }
settings-tier-vip = ⭐ VIP
settings-tier-free = Free
settings-default-format = 📥 Default format: { $format }
settings-format-hint = Choose what happens when you send a link:
settings-btn-change-language = 🌐 Change language
settings-format-ask = ❓ Ask every time
settings-format-audio = 🎵 Audio (MP3)
settings-format-video-720p = 🎬 Video 720p
settings-format-video-1080p = 🎬 Video 1080p
settings-format-updated = ✅ Default format saved.

## Search

search-prompt-title = 🔎 Search
search-prompt-body =
    Type a song, artist or video name and send it here.
    To search from any chat, tap the button below.
searching-query = 🔎 Searching for “{ $query }”…
search-results-title = 🔎 Results for “{ $query }”
search-results-hint = Tap 🎵 for audio, or 🎬 to pick a video quality.
search-no-results = 😕 Nothing found for “{ $query }”. Try other words, or send a link.
search-usage = 🔎 Add a name after the command, e.g. /search Daft Punk — or just type the name here.
search-btn-audio = 🎵 { $index } · Audio
search-btn-video = 🎬 { $index } · Video

inline-prompt = 🔎 Type a song or video name…
inline-btn-download = ⬇️ Download with { $appName }

## History

history-title = 📜 Your recent downloads
history-hint = Tap one to get it again.
history-empty = 📭 No downloads yet. Send a link or a song name to get started.
history-btn-resend = 🔄 { $index }. { $title }

## Link preview & format picker

processing-link = 🔎 Checking your link…
loading-formats = ⏳ Loading available qualities…
media-preview-author = 👤 { $author }
media-preview-meta = ⏱ { $duration } · 🌐 { $platform }
download-select-format = 👇 Choose a format:

btn-audio = 🎵 Audio ({ $ext })
btn-audio-original = 🎧 Audio ({ $ext }) · Best quality
btn-video = 🎬 Video ({ $quality })
btn-cancel = ❌ Cancel
btn-close = ✖️ Close

## Download progress

download-queued = ⏳ In queue (#{ $position }). Progress will show here.
download-stage-downloading = ⬇️ Downloading…
download-stage-processing = ⚙️ Processing…
download-stage-uploading = 📤 Sending to Telegram…
download-speed = 🚀 { $speed }
download-eta = ⏱ { $eta } left
download-completed = ✅ Sent ({ $size })
download-completed-instant = ⚡ Sent instantly
download-cancelled = 🚫 Download cancelled.

## Active downloads

no-active-jobs = 💤 No active downloads right now.
status-active-jobs = ⏳ Active downloads
status-queued = ⏳ Queued
status-processing = ⬇️ Downloading
status-uploading = 📤 Sending
cancel-job-prompt = Tap ❌ to cancel a download.
job-cancelled-success = 🚫 Cancelled: { $title }

## Channel subscription

forcejoin-title = 📢 Join our channel first
forcejoin-body = To use this bot, join { $channel }, then tap “I’ve joined”.
forcejoin-btn-join = 📢 Join channel
forcejoin-btn-verify = ✅ I’ve joined
forcejoin-verified = ✅ Thanks for joining! Send a link or a song name to get started.
forcejoin-verified-toast = ✅ Membership confirmed!
forcejoin-not-joined = ⚠️ You haven’t joined the channel yet.

## Errors

error-invalid-url = ⚠️ That link doesn’t look right. Check it and send it again.
error-unsupported-platform = ⚠️ This site isn’t supported. Try a link from YouTube, Spotify, Instagram, SoundCloud, TikTok, X or Reddit.
error-media-unavailable = ⚠️ This media is unavailable. It may be private or removed.
error-unauthorized-content = 🔒 This content is private, age-restricted or needs a login, so it can’t be downloaded.
error-bot-verification = 🤖 YouTube is temporarily blocking downloads from this server. Please try again later.
error-hint-admin-cookies = 🛠 Admin: upload fresh YouTube cookies in /admin → 🍪 YouTube Cookies.
error-drm-protected = 🔐 This video is DRM-protected (for example, a purchased or rented movie) and can’t be downloaded.
error-live-stream = 📡 Live streams can’t be downloaded. Try again after the stream ends.
error-file-too-large = ⚠️ This file is too big to send ({ $actualSize } MB, limit { $maxSize } MB). Try audio or a lower video quality.
error-duration-exceeded = ⚠️ This is longer than the { $maxDuration }-minute limit.
error-rate-limited = ⏳ Too many requests. Try again in { $seconds } s.
error-concurrent-limit = ⚠️ You already have { $limit } downloads running. Wait for one to finish, or cancel one in /status.
error-download-failed = ❌ Download failed. Please try again in a moment.
error-processing-failed = ❌ Couldn’t process this file. Try a different format.
error-delivery-failed = ❌ Couldn’t send the file to Telegram. Please try again.
error-job-not-found = ⚠️ This download has already finished or was cancelled.
error-preview-expired = ⌛ This menu has expired. Send the link again.
error-admin-only = 🔒 This command is for admins only.
error-generic = ❌ Something went wrong. Please try again.
spotify-send-track = ℹ️ This bot can’t list Spotify albums or playlists right now. Send a single track link to get its MP3.

## Albums, playlists & groups

collection-meta = 👤 { $author } · 🌐 { $platform } · { $count } tracks
collection-hint = Tap a number to open a track, or download them all as audio.
collection-btn-all = ⬇️ Download all as audio ({ $count })
collection-btn-next = ⬇️ Queue the next ones ({ $count } left)
collection-queued = ✅ Queued { $count }. You can run { $limit } downloads at a time, so tap again for the remaining { $left } once these finish.
collection-all-queued = ✅ Queued { $count }. That’s every track.
search-btn-more = More ➡️
dl-usage = ⬇️ Send /dl with a link, or reply /dl to a message that contains one.
error-not-your-menu = 🙅 This menu belongs to someone else. Send your own link or search.

## Admin panel
## Values here contain HTML; params are escaped by the caller.

admin-btn-refresh = 🔄 Refresh
admin-btn-users = 👥 Users & VIP/Ban
admin-btn-jobs = 📥 Active & recent jobs
admin-btn-maintenance = 🛠️ Maintenance & cache
admin-btn-cookies = 🍪 YouTube Cookies
admin-btn-channel = 📢 Force-join channel
admin-btn-broadcast = 📣 Broadcast message
admin-btn-back-panel = 🔙 Back to panel
admin-btn-back-users = 🔙 Back to users
admin-btn-back-cookies = 🔙 Back to cookies
admin-btn-back-channel = 🔙 Back to channel settings
admin-btn-prev = ⬅️ Prev
admin-btn-next = ➡️ Next
admin-btn-cancel = ❌ Cancel
admin-btn-kill = ❌ Stop { $job }
admin-btn-clean-temp = 🧹 Clean temp files
admin-btn-clean-queue = 🗑️ Clean queue history
admin-btn-flush-cache = ♻️ Flush media cache
admin-btn-cookies-upload = 📤 Upload / paste cookies.txt
admin-btn-cookies-remove = 🗑️ Remove cookies
admin-btn-channel-set = ✏️ Set channel (@username)
admin-btn-channel-off = 🚫 Turn off force-join
admin-btn-promote = ⭐ Make VIP
admin-btn-demote = 👤 Make Free
admin-btn-ban = 🚫 Ban
admin-btn-unban = ✅ Unban

admin-title = 🛡️ <b>{ $appName } Admin Panel</b>
admin-section-users = <b>👥 Users</b>
admin-users-total = • Total registered: <b>{ $count }</b>
admin-users-active = • Active (last 24h): <b>{ $count }</b>
admin-users-vip-banned = • VIP: <b>{ $vip }</b> | Banned: <b>{ $banned }</b>
admin-channel-line = • Force-join channel: <b>{ $channel }</b>
admin-cookies-line = • YouTube cookies: <b>{ $status }</b>
admin-off = Off
admin-cookies-active = ✅ Active
admin-cookies-missing = ⚠️ Not set
admin-section-downloads = <b>📥 Downloads</b>
admin-jobs-total = • Total jobs: <b>{ $count }</b>
admin-jobs-breakdown = • Completed: <b>{ $completed }</b> | Failed: <b>{ $failed }</b> | In progress: <b>{ $active }</b>
admin-bandwidth = • Total delivered: <b>{ $size }</b>
admin-top-platforms = • Top platforms: { $platforms }
admin-none-yet = None yet
admin-section-failures = <b>❌ Failures (last 24h)</b>
admin-failures-none = • No failures 🎉
admin-failure-line = • { $reason }: <b>{ $count }</b>
admin-section-cache = <b>⚡ Cache & queue</b>
admin-cache-line = • Cached media files: <b>{ $count }</b> ({ $size })
admin-queue-line = • Waiting: <b>{ $waiting }</b> | Active: <b>{ $active }</b> | Failed: <b>{ $failed }</b>
admin-queue-unavailable = • Queue: unavailable
admin-section-runtime = <b>🖥️ Runtime</b>
admin-runtime-line = • Uptime: <code>{ $uptime }</code> | RAM: <code>{ $memory } MB</code>

admin-reason-error-download-failed = Download failed
admin-reason-error-bot-verification = YouTube bot check (refresh cookies)
admin-reason-error-unauthorized-content = Private / login required
admin-reason-error-drm-protected = DRM-protected
admin-reason-error-live-stream = Live stream
admin-reason-error-media-unavailable = Unavailable / removed
admin-reason-error-file-too-large = File too large
admin-reason-error-duration-exceeded = Too long
admin-reason-error-processing-failed = Processing failed
admin-reason-error-delivery-failed = Telegram upload failed
admin-reason-other = Other / older

admin-access-denied = 🔒 Access denied: this panel is for administrators only.
admin-access-required = 🔒 Admin access required.
admin-upload-denied =
    🔒 <b>Access denied:</b> only administrators can upload <code>cookies.txt</code>.
    • Your Telegram ID: <code>{ $userId }</code>

admin-usage = Usage: <code>/{ $action } &lt;telegram_user_id&gt;</code>
admin-user-not-found = ⚠️ User <code>{ $userId }</code> isn’t in the database.
admin-user-banned = 🚫 User <code>{ $userId }</code> is now <b>banned</b>.
admin-user-unbanned = ✅ User <code>{ $userId }</code> is <b>unbanned</b>.
admin-user-vip = ⭐ User <code>{ $userId }</code> is now <b>VIP</b>.
admin-user-free = 👤 User <code>{ $userId }</code> is now on the <b>Free</b> tier.

admin-users-title = 👥 <b>Users ({ $total })</b> — page { $page }/{ $pages }
admin-users-hint = <i>Tap a user to change their tier or ban status.</i>
admin-users-empty = No users found.
admin-badge-banned = 🚫 BANNED
admin-badge-vip = ⭐ VIP
admin-badge-free = 👤 FREE
admin-user-row-meta = ID: <code>{ $userId }</code> | Lang: <b>{ $lang }</b> | Jobs: <b>{ $jobs }</b>

admin-user-detail-title = 👤 <b>User profile & access</b>
admin-user-name = • Name: <b>{ $name }</b>
admin-user-username = • Username: { $username }
admin-user-id = • Telegram ID: <code>{ $userId }</code>
admin-user-lang = • Language: <b>{ $lang }</b>
admin-user-tier = • Tier: <b>{ $tier }</b>
admin-user-status = • Status: <b>{ $status }</b>
admin-tier-vip = ⭐ VIP
admin-tier-free = 👤 Free
admin-status-banned = 🚫 Banned
admin-status-active = ✅ Active
admin-user-missing = ⚠️ User not found.
admin-na = N/A

admin-jobs-title = 📥 <b>Active & recent jobs</b>
admin-jobs-active = <b>⚡ Active ({ $count })</b>
admin-jobs-none-active = • Nothing running right now.
admin-job-row-meta = ID: <code>{ $jobId }</code> | User: <code>{ $userId }</code> | <b>{ $status }</b> ({ $percent }%)
admin-jobs-recent = <b>🕒 Recent</b>
admin-jobs-none-recent = • No jobs yet.

admin-maint-cleaned-temp = ✅ <b>Temp files cleaned.</b>
admin-maint-flushed = ✅ <b>Removed { $count } cached media entries.</b>
admin-maint-cleaned-queue = ✅ <b>Cleaned finished and failed queue jobs.</b>
admin-maint-queue-error = ⚠️ <b>Couldn’t clean the queue.</b>
admin-maint-title = 🛠️ <b>Maintenance & cache</b>
admin-maint-cache-section = <b>⚡ Telegram file cache</b>
admin-maint-cache-entries = • Entries: <b>{ $count }</b>
admin-maint-cache-size = • Total size: <b>{ $size }</b>
admin-maint-queue-section = <b>📊 Queue</b>
admin-maint-queue-counts = • Waiting: <b>{ $waiting }</b> | Active: <b>{ $active }</b>
admin-maint-queue-retained = • Kept — completed: <b>{ $completed }</b> | failed: <b>{ $failed }</b>

admin-cookies-title = 🍪 <b>YouTube cookies (<code>cookies.txt</code>)</b>
admin-cookies-status = • Status: { $status }
admin-cookies-configured = ✅ Set (<b>{ $count }</b> cookies, login: { $auth })
admin-cookies-configured-simple = ✅ Set
admin-cookies-auth-ok = ✅ valid
admin-cookies-auth-missing = ⚠️ missing login cookies
admin-cookies-path = • Path: <code>{ $path }</code>
admin-cookies-help =
    If YouTube blocks your server with <i>“Sign in to confirm you’re not a bot”</i>, fresh <code>cookies.txt</code> usually fixes it.

    <b>How to export cookies.txt:</b>
    1. Open a new private / incognito window.
    2. Go to <code>youtube.com</code> and sign in.
    3. Export with the <b>“Get cookies.txt LOCALLY”</b> extension (Firefox: <b>“cookies.txt”</b>).
    4. Close the private window without signing out.
    5. Send the file here, or paste its contents as a message.
admin-cookies-set-prompt =
    🍪 <b>Send YouTube cookies.txt</b>

    Send the file here as a document, or paste the cookie lines (Netscape or JSON) as text. Tap Cancel to go back.
admin-cookies-none =
    ⚠️ <b>No valid cookies found in your message.</b>

    Export YouTube cookies in <b>Netscape</b> or <b>JSON</b> format:
    • Chrome / Brave / Edge: <b>“Get cookies.txt LOCALLY”</b>
    • Firefox: <b>“cookies.txt”</b>

    💡 Make sure you’re <b>signed in to YouTube</b> before exporting.
admin-cookies-saved = ✅ <b>YouTube cookies saved.</b>
admin-cookies-saved-count = • Valid cookies: <b>{ $total }</b> ({ $youtube } YouTube/Google)
admin-cookies-auth-found = • Login session: ✅ <b>found</b> (<code>{ $names }</code>)
admin-cookies-auth-none =
    • Login session: ⚠️ <b>no login cookies</b> (missing <code>LOGIN_INFO</code> / <code>SAPISID</code> / <code>__Secure-1PSID</code>).
    <i>Without them, YouTube may still ask for bot verification on server IPs. Export again while signed in.</i>
admin-cookies-read-failed = ⚠️ <b>Couldn’t read the uploaded file.</b>
admin-cookies-read-path = • Bot API path: <code>{ $path }</code>
admin-cookies-read-detail = • Detail: <code>{ $detail }</code>
admin-cookies-read-fix =
    💡 <b>Fix:</b>
    1. Rebuild and restart so the shared volume permissions apply: <code>docker compose up -d --build</code>
    2. Or open <code>cookies.txt</code> in a text editor and paste its contents here as a message.

admin-channel-title = 📢 <b>Force-join channel</b>
admin-channel-status = • Status: { $status }
admin-channel-on = ✅ On (<code>{ $channel }</code>)
admin-channel-off = ❌ Off
admin-channel-help =
    When on, non-admin users must join your channel before downloading.
    <i>The bot must be an admin in that channel to check membership.</i>
admin-channel-set-prompt =
    📢 <b>Set force-join channel</b>

    Send the channel username (e.g. <code>@mychannel</code>) here, or tap Cancel.
admin-channel-updated = ✅ <b>Force-join channel set to:</b> <code>{ $channel }</code>

admin-broadcast-prompt =
    📣 <b>Broadcast to all users</b>

    Send the message to broadcast here, or tap Cancel.
admin-broadcast-sending = 📤 Sending to <b>{ $count }</b> users…
admin-broadcast-done =
    ✅ <b>Broadcast sent.</b>

    • Delivered: <b>{ $sent }</b>
    • Failed / blocked: <b>{ $failed }</b>

## Music Recognition (Shazam)

recognition-identifying = 🔎 Listening and identifying music…
recognition-no-match = 😕 Could not identify any song in this audio. Make sure the music is clear and try again.
recognition-found-title = 🎵 <b>{ $title }</b>
recognition-artist = 👤 Artist: <b>{ $artist }</b>
recognition-album = 💿 Album: { $album }
recognition-genre = 🏷️ Genre: { $genre }
recognition-released = 📅 Released: { $year }
recognition-btn-mp3 = 🎵 Download MP3
recognition-btn-video = 🎬 Download Video
recognition-btn-search = 🔎 Search other versions
recognition-btn-listen-apple = 🍎 Apple Music
recognition-btn-listen-shazam =  Shazam
recognition-error-too-large = ⚠️ File is too large for audio recognition. Please send a shorter snippet (under 25MB).
recognition-error-generic = ❌ An error occurred while identifying this audio. Please try again.

