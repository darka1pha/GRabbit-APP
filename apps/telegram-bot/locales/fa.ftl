## Home & onboarding

welcome-title = 🐰 به { $appName } خوش آمدید!
welcome-description =
    { $slogan }

    ✨ امکانات ربات:
    🔗 دانلود رسانه — ارسال لینک از یوتیوب، اسپاتیفای، اینستاگرام، تیک‌تاک، ساندکلاد، توییتر (ایکس) و ردیت.
    🎵 شناسایی آهنگ (شزم) — ارسال یا فوروارد ویس، ویدیو مسیج، فایل صوتی یا تصویری برای تشخیص نام آهنگ و دانلود آن!
    🔎 جستجو — ارسال نام آهنگ یا ویدیو برای جستجو و دریافت مستقیم فایل.
    🚀 جستجوی اینلاین — تایپ @{ $botUsername } در هر چتی برای پیدا کردن و اشتراک آسان موزیک با دوستان!

menu-btn-search = 🔎 جستجو
menu-btn-inline = ✨ جستجو در هر چتی
menu-btn-history = 📜 دانلودهای من
menu-btn-status = ⏳ در حال انجام
menu-btn-settings = ⚙️ تنظیمات
menu-btn-help = ❓ راهنما
menu-btn-admin = 🛡️ پنل مدیریت
menu-btn-home = 🏠 منوی اصلی
menu-btn-refresh = 🔄 به‌روزرسانی

## Help & about

help-title = ❓ راهنمای { $appName }
help-description =
    ۱. یک لینک بفرستید، یا نام آهنگ یا ویدیو را بنویسید.
    ۲. صدا یا کیفیت ویدیو را انتخاب کنید.
    ۳. فایل همین‌جا در چت برایتان ارسال می‌شود.

    سایت‌های پشتیبانی‌شده:
    • یوتیوب — ویدیو، Shorts و صدا
    • اسپاتیفای — تک‌آهنگ‌ها به‌صورت MP3
    • اینستاگرام — ریلز و ویدیوهای عمومی
    • ساندکلاد — آهنگ‌ها و مجموعه‌ها
    • تیک‌تاک، ایکس (توییتر)، ردیت — ویدیو و صدا
    • 🎵 شناسایی موزیک — ارسال ویس یا ویدیو برای تشخیص و دریافت آهنگ!

    دستورها:
    • جستجوی آهنگ و ویدیو: /search
    • دانلود لینک (در گروه‌ها در پاسخ به پیام لینک‌دار): /dl
    • دانلودهای اخیر: /history
    • دانلودهای در حال انجام: /status
    • لغو دانلود: /cancel
    • زبان و فرمت پیش‌فرض: /settings
    • تغییر زبان: /language
    • درباره ربات: /about
    
    در گروه‌ها: از /dl استفاده کنید، یا پیام را با @{ $botUsername } شروع کنید تا جستجو شود.

about-title = 🐰 درباره { $appName }
about-description =
    { $appName } یک ربات سریع برای دانلود مدیا با صف پردازش پس‌زمینه است.

    ساخته‌شده با:
    • grammY (تایپ‌اسکریپت)
    • BullMQ و Redis برای پردازش پس‌زمینه
    • PostgreSQL
    • yt-dlp و FFmpeg / FFprobe
    • محافظت در برابر SSRF و محدودیت تعداد درخواست

## Language

language-select-title = 🌐 Choose your language / زبان خود را انتخاب کنید:
language-updated = ✅ زبان به فارسی تغییر کرد.
language-btn-en = 🇬🇧 English
language-btn-fa = 🇮🇷 فارسی
language-name = فارسی

## Settings

settings-title = ⚙️ تنظیمات
settings-current-language = 🌐 زبان: { $language }
settings-tier = 👤 حساب: { $tier }
settings-tier-vip = ⭐ ویژه (VIP)
settings-tier-free = رایگان
settings-default-format = 📥 فرمت پیش‌فرض: { $format }
settings-format-hint = انتخاب کنید وقتی لینک می‌فرستید چه اتفاقی بیفتد:
settings-btn-change-language = 🌐 تغییر زبان
settings-format-ask = ❓ هر بار بپرس
settings-format-audio = 🎵 صدا (MP3)
settings-format-video-720p = 🎬 ویدیو 720p
settings-format-video-1080p = 🎬 ویدیو 1080p
settings-format-updated = ✅ فرمت پیش‌فرض ذخیره شد.

## Search

search-prompt-title = 🔎 جستجو
search-prompt-body =
    نام آهنگ، خواننده یا ویدیو را بنویسید و همین‌جا بفرستید.
    برای جستجو در هر چتی، دکمهٔ زیر را بزنید.
searching-query = 🔎 در حال جستجوی «{ $query }»…
search-results-title = 🔎 نتایج «{ $query }»
search-results-hint = برای صدا 🎵 و برای انتخاب کیفیت ویدیو 🎬 را بزنید.
search-no-results = 😕 چیزی برای «{ $query }» پیدا نشد. کلمات دیگری امتحان کنید یا لینک بفرستید.
search-usage = 🔎 نام را بعد از دستور بنویسید، مثلاً ‎/search Daft Punk‎ — یا فقط نام را همین‌جا بفرستید.
search-btn-audio = 🎵 { $index } · صدا
search-btn-video = 🎬 { $index } · ویدیو

inline-prompt = 🔎 نام آهنگ یا ویدیو را بنویسید…
inline-btn-download = ⬇️ دانلود با { $appName }

## History

history-title = 📜 دانلودهای اخیر شما
history-hint = برای دریافت دوباره، روی هر مورد بزنید.
history-empty = 📭 هنوز دانلودی ندارید. برای شروع، یک لینک یا نام آهنگ بفرستید.
history-btn-resend = 🔄 { $index }. { $title }

## Link preview & format picker

processing-link = 🔎 در حال بررسی لینک…
loading-formats = ⏳ در حال دریافت کیفیت‌های موجود…
media-preview-author = 👤 { $author }
media-preview-meta = ⏱ { $duration } · 🌐 { $platform }
download-select-format = 👇 فرمت را انتخاب کنید:

btn-audio = 🎵 صدا ({ $ext })
btn-audio-original = 🎧 صدا ({ $ext }) · بهترین کیفیت
btn-video = 🎬 ویدیو ({ $quality })
btn-cancel = ❌ لغو
btn-close = ✖️ بستن

## Download progress

download-queued = ⏳ در صف (نوبت { $position }). پیشرفت همین‌جا نمایش داده می‌شود.
download-stage-downloading = ⬇️ در حال دانلود…
download-stage-processing = ⚙️ در حال پردازش…
download-stage-uploading = 📤 در حال ارسال به تلگرام…
download-speed = 🚀 { $speed }
download-eta = ⏱ { $eta } مانده
download-completed = ✅ ارسال شد ({ $size })
download-completed-instant = ⚡ فوراً ارسال شد
download-cancelled = 🚫 دانلود لغو شد.

## Active downloads

no-active-jobs = 💤 در حال حاضر دانلود فعالی ندارید.
status-active-jobs = ⏳ دانلودهای فعال
status-queued = ⏳ در صف
status-processing = ⬇️ در حال دانلود
status-uploading = 📤 در حال ارسال
cancel-job-prompt = برای لغو هر دانلود، ❌ را بزنید.
job-cancelled-success = 🚫 لغو شد: { $title }

## Channel subscription

forcejoin-title = 📢 ابتدا در کانال ما عضو شوید
forcejoin-body = برای استفاده از ربات، در { $channel } عضو شوید و سپس «عضو شدم» را بزنید.
forcejoin-btn-join = 📢 عضویت در کانال
forcejoin-btn-verify = ✅ عضو شدم
forcejoin-verified = ✅ ممنون از عضویت شما! برای شروع، یک لینک یا نام آهنگ بفرستید.
forcejoin-verified-toast = ✅ عضویت شما تأیید شد!
forcejoin-not-joined = ⚠️ هنوز در کانال عضو نشده‌اید.

## Errors

error-invalid-url = ⚠️ این لینک درست به نظر نمی‌رسد. آن را بررسی کنید و دوباره بفرستید.
error-unsupported-platform = ⚠️ این سایت پشتیبانی نمی‌شود. لینکی از یوتیوب، اسپاتیفای، اینستاگرام، ساندکلاد، تیک‌تاک، ایکس یا ردیت بفرستید.
error-media-unavailable = ⚠️ این مدیا در دسترس نیست؛ ممکن است خصوصی یا حذف شده باشد.
error-unauthorized-content = 🔒 این محتوا خصوصی است، محدودیت سنی دارد یا نیاز به ورود دارد؛ بنابراین قابل دانلود نیست.
error-bot-verification = 🤖 یوتیوب فعلاً دانلود از این سرور را محدود کرده است. لطفاً کمی بعد دوباره امتحان کنید.
error-hint-admin-cookies = 🛠 مدیر: کوکی‌های تازهٔ یوتیوب را از /admin ← 🍪 کوکی‌های یوتیوب بارگذاری کنید.
error-drm-protected = 🔐 این ویدیو با DRM محافظت شده است (مثلاً فیلم خریداری‌شده یا اجاره‌ای) و قابل دانلود نیست.
error-live-stream = 📡 پخش زنده قابل دانلود نیست. بعد از پایان پخش دوباره امتحان کنید.
error-file-too-large = ⚠️ این فایل برای ارسال خیلی بزرگ است ({ $actualSize } مگابایت، سقف { $maxSize } مگابایت). صدا یا کیفیت پایین‌تر را امتحان کنید.
error-duration-exceeded = ⚠️ مدت این فایل بیشتر از سقف { $maxDuration } دقیقه است.
error-rate-limited = ⏳ درخواست‌ها زیاد است. { $seconds } ثانیه دیگر دوباره امتحان کنید.
error-concurrent-limit = ⚠️ هم‌اکنون { $limit } دانلود در حال انجام دارید. صبر کنید یکی تمام شود، یا از /status یکی را لغو کنید.
error-download-failed = ❌ دانلود ناموفق بود. لطفاً کمی بعد دوباره امتحان کنید.
error-processing-failed = ❌ پردازش این فایل ممکن نشد. فرمت دیگری را امتحان کنید.
error-delivery-failed = ❌ ارسال فایل به تلگرام ناموفق بود. لطفاً دوباره امتحان کنید.
error-job-not-found = ⚠️ این دانلود قبلاً تمام یا لغو شده است.
error-preview-expired = ⌛ این منو منقضی شده است. لینک را دوباره بفرستید.
error-admin-only = 🔒 این دستور فقط برای مدیران است.
error-generic = ❌ مشکلی پیش آمد. لطفاً دوباره امتحان کنید.
spotify-send-track = ℹ️ این ربات فعلاً نمی‌تواند آلبوم‌ها و پلی‌لیست‌های اسپاتیفای را فهرست کند. لینک یک تک‌آهنگ را بفرستید تا MP3 آن را دریافت کنید.

## Albums, playlists & groups

collection-meta = 👤 { $author } · 🌐 { $platform } · { $count } آهنگ
collection-hint = برای باز کردن هر آهنگ شماره‌اش را بزنید، یا همه را به‌صورت صوتی دانلود کنید.
collection-btn-all = ⬇️ دانلود همه به‌صورت صوتی ({ $count })
collection-btn-next = ⬇️ دانلود دستهٔ بعدی ({ $count } مانده)
collection-queued = ✅ { $count } مورد در صف قرار گرفت. هم‌زمان { $limit } دانلود مجاز است؛ بعد از تمام شدن این‌ها دوباره بزنید تا { $left } مورد باقی‌مانده هم دانلود شود.
collection-all-queued = ✅ { $count } مورد در صف قرار گرفت. همهٔ آهنگ‌ها اضافه شدند.
search-btn-more = بیشتر ➡️
dl-usage = ⬇️ دستور /dl را همراه لینک بفرستید، یا آن را در پاسخ به پیامی که لینک دارد بفرستید.
error-not-your-menu = 🙅 این منو متعلق به کاربر دیگری است. لینک یا جستجوی خودتان را بفرستید.

## Admin panel
## Values here contain HTML; params are escaped by the caller.

admin-btn-refresh = 🔄 به‌روزرسانی
admin-btn-users = 👥 کاربران، VIP و مسدودی
admin-btn-jobs = 📥 کارهای فعال و اخیر
admin-btn-maintenance = 🛠️ نگهداری و کش
admin-btn-cookies = 🍪 کوکی‌های یوتیوب
admin-btn-channel = 📢 کانال عضویت اجباری
admin-btn-broadcast = 📣 پیام همگانی
admin-btn-back-panel = 🔙 بازگشت به پنل
admin-btn-back-users = 🔙 بازگشت به کاربران
admin-btn-back-cookies = 🔙 بازگشت به کوکی‌ها
admin-btn-back-channel = 🔙 بازگشت به تنظیمات کانال
admin-btn-prev = ⬅️ قبلی
admin-btn-next = بعدی ➡️
admin-btn-cancel = ❌ لغو
admin-btn-kill = ❌ توقف { $job }
admin-btn-clean-temp = 🧹 پاک‌سازی فایل‌های موقت
admin-btn-clean-queue = 🗑️ پاک‌سازی تاریخچهٔ صف
admin-btn-flush-cache = ♻️ خالی کردن کش مدیا
admin-btn-cookies-upload = 📤 ارسال یا چسباندن cookies.txt
admin-btn-cookies-remove = 🗑️ حذف کوکی‌ها
admin-btn-channel-set = ✏️ تعیین کانال (@username)
admin-btn-channel-off = 🚫 خاموش کردن عضویت اجباری
admin-btn-promote = ⭐ ارتقا به VIP
admin-btn-demote = 👤 تبدیل به رایگان
admin-btn-ban = 🚫 مسدود کردن
admin-btn-unban = ✅ رفع مسدودی

admin-title = 🛡️ <b>پنل مدیریت { $appName }</b>
admin-section-users = <b>👥 کاربران</b>
admin-users-total = • کل کاربران: <b>{ $count }</b>
admin-users-active = • فعال (۲۴ ساعت اخیر): <b>{ $count }</b>
admin-users-vip-banned = • VIP: <b>{ $vip }</b> | مسدود: <b>{ $banned }</b>
admin-channel-line = • کانال عضویت اجباری: <b>{ $channel }</b>
admin-cookies-line = • کوکی‌های یوتیوب: <b>{ $status }</b>
admin-off = خاموش
admin-cookies-active = ✅ فعال
admin-cookies-missing = ⚠️ تنظیم نشده
admin-section-downloads = <b>📥 دانلودها</b>
admin-jobs-total = • کل کارها: <b>{ $count }</b>
admin-jobs-breakdown = • موفق: <b>{ $completed }</b> | ناموفق: <b>{ $failed }</b> | در حال انجام: <b>{ $active }</b>
admin-bandwidth = • حجم ارسال‌شده: <b>{ $size }</b>
admin-top-platforms = • پرکاربردترین سایت‌ها: { $platforms }
admin-none-yet = هنوز موردی نیست
admin-section-failures = <b>❌ خطاها (۲۴ ساعت اخیر)</b>
admin-failures-none = • خطایی نبوده 🎉
admin-failure-line = • { $reason }: <b>{ $count }</b>
admin-section-cache = <b>⚡ کش و صف</b>
admin-cache-line = • فایل‌های کش‌شده: <b>{ $count }</b> ({ $size })
admin-queue-line = • در انتظار: <b>{ $waiting }</b> | فعال: <b>{ $active }</b> | ناموفق: <b>{ $failed }</b>
admin-queue-unavailable = • صف: در دسترس نیست
admin-section-runtime = <b>🖥️ وضعیت سرور</b>
admin-runtime-line = • مدت فعالیت: <code>{ $uptime }</code> | حافظه: <code>{ $memory } MB</code>

admin-reason-error-download-failed = دانلود ناموفق
admin-reason-error-bot-verification = بررسی ربات یوتیوب (کوکی‌ها را تازه کنید)
admin-reason-error-unauthorized-content = خصوصی / نیاز به ورود
admin-reason-error-drm-protected = محافظت‌شده با DRM
admin-reason-error-live-stream = پخش زنده
admin-reason-error-media-unavailable = در دسترس نیست / حذف شده
admin-reason-error-file-too-large = فایل خیلی بزرگ
admin-reason-error-duration-exceeded = بیش از حد طولانی
admin-reason-error-processing-failed = پردازش ناموفق
admin-reason-error-delivery-failed = ارسال به تلگرام ناموفق
admin-reason-other = سایر / قدیمی

admin-access-denied = 🔒 دسترسی ندارید: این پنل فقط برای مدیران است.
admin-access-required = 🔒 دسترسی مدیر لازم است.
admin-upload-denied =
    🔒 <b>دسترسی ندارید:</b> فقط مدیران می‌توانند <code>cookies.txt</code> بارگذاری کنند.
    • شناسهٔ تلگرام شما: <code>{ $userId }</code>

admin-usage = نحوهٔ استفاده: <code>/{ $action } &lt;telegram_user_id&gt;</code>
admin-user-not-found = ⚠️ کاربر <code>{ $userId }</code> در پایگاه داده نیست.
admin-user-banned = 🚫 کاربر <code>{ $userId }</code> <b>مسدود</b> شد.
admin-user-unbanned = ✅ مسدودی کاربر <code>{ $userId }</code> <b>برداشته شد</b>.
admin-user-vip = ⭐ کاربر <code>{ $userId }</code> اکنون <b>VIP</b> است.
admin-user-free = 👤 کاربر <code>{ $userId }</code> اکنون در سطح <b>رایگان</b> است.

admin-users-title = 👥 <b>کاربران ({ $total })</b> — صفحهٔ { $page } از { $pages }
admin-users-hint = <i>برای تغییر سطح یا وضعیت مسدودی، روی کاربر بزنید.</i>
admin-users-empty = کاربری پیدا نشد.
admin-badge-banned = 🚫 مسدود
admin-badge-vip = ⭐ VIP
admin-badge-free = 👤 رایگان
admin-user-row-meta = شناسه: <code>{ $userId }</code> | زبان: <b>{ $lang }</b> | دانلودها: <b>{ $jobs }</b>

admin-user-detail-title = 👤 <b>پروفایل و دسترسی کاربر</b>
admin-user-name = • نام: <b>{ $name }</b>
admin-user-username = • نام کاربری: { $username }
admin-user-id = • شناسهٔ تلگرام: <code>{ $userId }</code>
admin-user-lang = • زبان: <b>{ $lang }</b>
admin-user-tier = • سطح: <b>{ $tier }</b>
admin-user-status = • وضعیت: <b>{ $status }</b>
admin-tier-vip = ⭐ VIP
admin-tier-free = 👤 رایگان
admin-status-banned = 🚫 مسدود
admin-status-active = ✅ فعال
admin-user-missing = ⚠️ کاربر پیدا نشد.
admin-na = ندارد

admin-jobs-title = 📥 <b>کارهای فعال و اخیر</b>
admin-jobs-active = <b>⚡ فعال ({ $count })</b>
admin-jobs-none-active = • در حال حاضر کاری در جریان نیست.
admin-job-row-meta = شناسه: <code>{ $jobId }</code> | کاربر: <code>{ $userId }</code> | <b>{ $status }</b> ({ $percent }٪)
admin-jobs-recent = <b>🕒 اخیر</b>
admin-jobs-none-recent = • هنوز کاری ثبت نشده.

admin-maint-cleaned-temp = ✅ <b>فایل‌های موقت پاک شدند.</b>
admin-maint-flushed = ✅ <b>{ $count } مورد از کش مدیا حذف شد.</b>
admin-maint-cleaned-queue = ✅ <b>کارهای تمام‌شده و ناموفق صف پاک شدند.</b>
admin-maint-queue-error = ⚠️ <b>پاک‌سازی صف ممکن نشد.</b>
admin-maint-title = 🛠️ <b>نگهداری و کش</b>
admin-maint-cache-section = <b>⚡ کش فایل تلگرام</b>
admin-maint-cache-entries = • تعداد: <b>{ $count }</b>
admin-maint-cache-size = • حجم کل: <b>{ $size }</b>
admin-maint-queue-section = <b>📊 صف</b>
admin-maint-queue-counts = • در انتظار: <b>{ $waiting }</b> | فعال: <b>{ $active }</b>
admin-maint-queue-retained = • نگه‌داشته‌شده — موفق: <b>{ $completed }</b> | ناموفق: <b>{ $failed }</b>

admin-cookies-title = 🍪 <b>کوکی‌های یوتیوب (<code>cookies.txt</code>)</b>
admin-cookies-status = • وضعیت: { $status }
admin-cookies-configured = ✅ تنظیم شده (<b>{ $count }</b> کوکی، ورود: { $auth })
admin-cookies-configured-simple = ✅ تنظیم شده
admin-cookies-auth-ok = ✅ معتبر
admin-cookies-auth-missing = ⚠️ کوکی‌های ورود موجود نیست
admin-cookies-path = • مسیر: <code>{ $path }</code>
admin-cookies-help =
    اگر یوتیوب سرور شما را با پیام <i>«Sign in to confirm you’re not a bot»</i> مسدود کند، معمولاً یک <code>cookies.txt</code> تازه مشکل را حل می‌کند.

    <b>روش گرفتن cookies.txt:</b>
    ۱. یک پنجرهٔ ناشناس (Incognito / Private) تازه باز کنید.
    ۲. به <code>youtube.com</code> بروید و وارد حساب شوید.
    ۳. با افزونهٔ <b>«Get cookies.txt LOCALLY»</b> (در فایرفاکس: <b>«cookies.txt»</b>) خروجی بگیرید.
    ۴. پنجرهٔ ناشناس را بدون خروج از حساب ببندید.
    ۵. فایل را همین‌جا بفرستید، یا محتوای آن را به‌صورت پیام بچسبانید.
admin-cookies-set-prompt =
    🍪 <b>ارسال cookies.txt یوتیوب</b>

    فایل را به‌صورت سند همین‌جا بفرستید، یا خطوط کوکی (Netscape یا JSON) را به‌صورت متن بچسبانید. برای بازگشت «لغو» را بزنید.
admin-cookies-none =
    ⚠️ <b>کوکی معتبری در پیام شما پیدا نشد.</b>

    کوکی‌های یوتیوب را با فرمت <b>Netscape</b> یا <b>JSON</b> خروجی بگیرید:
    • کروم / بریو / اج: <b>«Get cookies.txt LOCALLY»</b>
    • فایرفاکس: <b>«cookies.txt»</b>

    💡 قبل از خروجی گرفتن حتماً <b>وارد یوتیوب شده باشید</b>.
admin-cookies-saved = ✅ <b>کوکی‌های یوتیوب ذخیره شد.</b>
admin-cookies-saved-count = • کوکی‌های معتبر: <b>{ $total }</b> ({ $youtube } مورد یوتیوب/گوگل)
admin-cookies-auth-found = • نشست ورود: ✅ <b>پیدا شد</b> (<code>{ $names }</code>)
admin-cookies-auth-none =
    • نشست ورود: ⚠️ <b>کوکی ورود ندارد</b> (<code>LOGIN_INFO</code> / <code>SAPISID</code> / <code>__Secure-1PSID</code> موجود نیست).
    <i>بدون این‌ها ممکن است یوتیوب روی آی‌پی سرور همچنان تأیید ربات بخواهد. در حالت ورود به حساب دوباره خروجی بگیرید.</i>
admin-cookies-read-failed = ⚠️ <b>خواندن فایل ارسال‌شده ممکن نشد.</b>
admin-cookies-read-path = • مسیر Bot API: <code>{ $path }</code>
admin-cookies-read-detail = • جزئیات: <code>{ $detail }</code>
admin-cookies-read-fix =
    💡 <b>راه‌حل:</b>
    ۱. کانتینرها را دوباره بسازید و اجرا کنید تا دسترسی‌های پوشهٔ مشترک اعمال شود: <code>docker compose up -d --build</code>
    ۲. یا <code>cookies.txt</code> را در یک ویرایشگر متن باز کنید و محتوایش را همین‌جا به‌صورت پیام بچسبانید.

admin-channel-title = 📢 <b>کانال عضویت اجباری</b>
admin-channel-status = • وضعیت: { $status }
admin-channel-on = ✅ روشن (<code>{ $channel }</code>)
admin-channel-off = ❌ خاموش
admin-channel-help =
    وقتی روشن باشد، کاربران عادی برای دانلود باید در کانال شما عضو شوند.
    <i>ربات باید در آن کانال مدیر باشد تا بتواند عضویت را بررسی کند.</i>
admin-channel-set-prompt =
    📢 <b>تعیین کانال عضویت اجباری</b>

    نام کاربری کانال (مثلاً <code>@mychannel</code>) را همین‌جا بفرستید، یا «لغو» را بزنید.
admin-channel-updated = ✅ <b>کانال عضویت اجباری تنظیم شد:</b> <code>{ $channel }</code>

admin-broadcast-prompt =
    📣 <b>پیام همگانی به همهٔ کاربران</b>

    پیامی را که می‌خواهید برای همه ارسال شود همین‌جا بفرستید، یا «لغو» را بزنید.
admin-broadcast-sending = 📤 در حال ارسال به <b>{ $count }</b> کاربر…
admin-broadcast-done =
    ✅ <b>پیام همگانی ارسال شد.</b>

    • ارسال‌شده: <b>{ $sent }</b>
    • ناموفق / مسدود: <b>{ $failed }</b>

## Music Recognition (Shazam)

recognition-identifying = 🔎 در حال گوش دادن و شناسایی آهنگ…
recognition-no-match = 😕 آهنگی در این فایل صوتی شناسایی نشد. لطفاً از واضح بودن صدای موزیک مطمئن شده و مجدداً تلاش کنید.
recognition-found-title = 🎵 <b>{ $title }</b>
recognition-artist = 👤 خواننده / اثر: <b>{ $artist }</b>
recognition-album = 💿 آلبوم: { $album }
recognition-genre = 🏷️ سبک: { $genre }
recognition-released = 📅 سال انتشار: { $year }
recognition-btn-mp3 = 🎵 دانلود نسخه صوتی (MP3)
recognition-btn-video = 🎬 دانلود نسخه ویدیو
recognition-btn-search = 🔎 جستجوی نسخه‌های دیگر
recognition-btn-listen-apple = 🍎 اپل موزیک
recognition-btn-listen-shazam =  شازم
recognition-error-too-large = ⚠️ حجم فایل برای پردازش صوتی بیش از حد مجاز است. لطفاً فایل کوتاه‌تر یا ویس بفرستید (حداکثر ۲۵ مگابایت).
recognition-error-generic = ❌ خطایی در پردازش و شناسایی فایل صوتی رخ داد. لطفاً مجدداً تلاش فرمایید.

