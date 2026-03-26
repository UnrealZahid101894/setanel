# Setanel — Anti-Piracy Video Security SDK

Protects EdTech course videos from account sharing, screen recording, and piracy. Drop-in SDK — no changes to your existing login system or design required.

**Live:** https://setanel.vercel.app/

---

## Install

```bash
npm install setanel-sdk
```
or CDN:
```html
<script src="https://setanel.vercel.app//setanel-sdk.js"></script>
```

---

## Quick Start

```html
<div id="secure-player"></div>

<script src="https://setanel.vercel.app/setanel-sdk.js"></script>
<script>
  Setanel.init({
    supabaseUrl:  'https://your-project.supabase.co',
    supabaseKey:  'your-anon-key',
    userId:       currentStudent.id,
    userEmail:    currentStudent.email,
    videoUrl:     'https://your-cdn.com/lecture.m3u8',
    container:    '#secure-player',
    deviceLimit:  1,
    onRevoke: () => { window.location.href = '/login' }
  })
</script>
```

Call on logout:
```js
Setanel.destroy()
```

---

## Config

| Option | Type | Required | Description |
|---|---|---|---|
| `supabaseUrl` | string | yes | Supabase project URL |
| `supabaseKey` | string | yes | Supabase anon key |
| `userId` | string | yes | Student ID from your auth system |
| `userEmail` | string | no | Student email — shown in dashboard |
| `videoUrl` | string | yes | HLS `.m3u8` stream URL |
| `container` | string | yes | CSS selector for player div |
| `deviceLimit` | number | no | Max devices. Default: 1 |
| `onRevoke` | function | no | Called when session is killed |

---

## Supabase Setup

Create these 4 tables with RLS disabled:

```
active_sessions  — id, user_id, device_id, last_seen, platform, email, forensic_id
banned_users     — id, user_id, email, reason, banned_at
piracy_events    — id, event_type, user_id, email, detail, created_at
login_attempts   — id, user_id, attempted_at
```

All columns are text or timestamptz except `id` (int8, primary key, auto-increment).

Create an admin user in Supabase Auth → use those credentials to log into the dashboard.

---

## What It Does

- **Kill switch** — detects same account on 2+ devices, revokes within 30s
- **Forensic watermark** — encrypted 8-char ID on every session, traces leaks to exact account
- **Rate limiting** — blocks accounts with 10+ attempts per hour
- **HLS streaming** — encrypted video chunks, no downloadable file
- **Admin dashboard** — live sessions, suspicious users, ban/kick management, monthly analytics

---

## What It Can't Do

- Stop OS-level screen recording (no browser SDK can)
- Truly invisible steganographic watermarking (requires server-side video processing)
- Prevent downloads from tools like IDM if the HLS URL is exposed

---

## Stack

Vanilla JS · Supabase · HLS.js · Vercel

---

## Contributing

What's actually needed:
- Multi-tenant isolation (urgent for multiple clients)
- Signed/expiring HLS URLs
- React/Vue wrapper
- TypeScript rewrite

Fork → branch → PR. Test locally with `setanel-week1.html`.

---

## License

MIT
