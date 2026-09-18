import type { MetadataRoute } from 'next'

// Konvensi file Next.js -- ini otomatis dilayani sebagai /manifest.webmanifest dan
// tertaut sendiri lewat <link rel="manifest">, tidak perlu ditambahkan manual di layout.
//
// Sebatas "installable": tidak ada service worker, tidak ada cache/offline. App ini selalu
// terhubung live ke server (SSE untuk pesan masuk real-time), jadi mode offline bukan sesuatu
// yang masuk akal untuk dijanjikan -- yang dibutuhkan cuma bisa di-add-to-homescreen dan
// dibuka sebagai app standalone tanpa address bar browser.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'wa-inbox — JVTO',
    short_name: 'wa-inbox',
    description: 'Inbox WhatsApp dan chatbot internal Java Volcano Tour Operator.',
    start_url: '/',
    display: 'standalone',
    // Sama dengan --color-canvas di globals.css -- latar splash screen saat app dibuka,
    // sebelum konten sungguhan sempat dirender.
    background_color: '#f6f8fa',
    // Sama dengan --color-ink -- warna navy yang sama dengan AppRail, supaya status bar
    // OS/splash screen terasa satu identitas dengan rail navigasi di dalam app.
    theme_color: '#0b1b3d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
