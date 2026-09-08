import { AppRail } from '@/components/AppRail'
import { NotificationListener } from '@/components/NotificationListener'

// Route group (parentheses => it contributes nothing to the URL) covering every page
// src/middleware.ts protects. `/login` and `/` are deliberately outside it.
//
// NotificationListener used to sit in the root layout, so it mounted on the login screen
// too. `/api/sse` is not in middleware's PUBLIC_PATHS, so its EventSource got a 401 there
// and — having no `onerror` handler — the browser's built-in reconnect loop retried an
// endpoint that cannot succeed until the user signs in. It also fired
// Notification.requestPermission() at someone who had not logged in yet.
//
// Gating on the pathname inside the component would have fixed the symptom in fewer lines,
// but it would have made "which pages are authenticated?" a string comparison duplicated
// away from middleware, drifting the moment a route is added. A route group makes the same
// boundary structural: anything that needs a session goes in here and gets the listener,
// anything public stays out and cannot get it by accident. It also mounts cleanly on the
// client-side navigation login does (router.push('/dashboard')), which a pathname read
// inside a mount-once effect would have missed entirely until a hard reload.
//
// It is also where the global nav shell lives, for the same structural reason: "has a session"
// and "has the seven top-level menus" are the same set of pages, so the group defines both at
// once instead of every page remembering to render its own navigation.
//
// This file stays a SERVER component. The rail needs usePathname() and two client fetches, but
// putting 'use client' here would make every page under the group a client boundary's child —
// harmless today (they are all 'use client' already) but a constraint the layout has no reason
// to impose on future server pages. Only <AppRail> is a client component.
//
// GEOMETRI CANGKANG (load-bearing, bukan dekorasi)
//
// `h-screen` di pembungkus luar: cangkang yang memiliki tinggi viewport, bukan dokumen yang
// tumbuh melewatinya. Tanpa itu, /inbox (tiga kolom setinggi penuh) membuat dokumen setinggi
// nav + 100vh dan navigasinya ikut tergulung keluar layar.
//
// `flex-col-reverse md:flex-row`: SATU susunan DOM untuk dua bentuk. Rail ditulis lebih dulu
// (navigasi mendahului konten untuk pembaca layar di kedua bentuk), lalu:
//   - di bawah md, flex-col-reverse menempatkan anak pertama di BAWAH  -> bar bawah;
//   - dari md ke atas, flex-row menempatkannya di KIRI                 -> rail.
// Ini sengaja bukan `position: fixed`: bar yang fixed harus dibayar dengan padding-bottom di
// area konten yang nilainya wajib sama persis dengan tinggi bar, dan angka kembar seperti itu
// selalu berpisah suatu hari.
//
// Area konten `min-h-0 min-w-0 flex-1 overflow-y-auto`. `min-h-0`/`min-w-0` wajib — default
// min-size:auto pada flex item menolak menyusut di bawah kontennya, yang akan mendorong
// overflow-nya balik ke dokumen. `overflow-y-auto` melayani dua jenis halaman sekaligus:
//   - halaman biasa (18 dari 19) lebih tinggi dari layar dan menggulung di sini;
//   - halaman setinggi penuh (/inbox, dan apa pun yang menyusul di Tahap 1C) memakai `h-full`
//     plus scroller-nya sendiri di dalam. Tingginya lalu persis sama dengan kotak ini, jadi
//     scroller luar tidak pernah aktif dan tidak ada gulungan ganda. Yang TIDAK boleh dilakukan
//     halaman semacam itu adalah memakai `h-screen`: itu mengabaikan rail dan meluber.
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col-reverse md:flex-row">
      <AppRail />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      <NotificationListener />
    </div>
  )
}
