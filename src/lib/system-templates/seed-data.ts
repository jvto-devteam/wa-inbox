/**
 * The system templates, as first written — one per message that javavolcano-touroperator and
 * new-backoffice used to hardcode. Written to the database by scripts/seed-system-templates.ts,
 * which only CREATES missing keys: once a row exists, the operator's edits win and this file is
 * never applied over them.
 *
 * Every `body` must render byte-for-byte what its PHP original sent, for the same values. That
 * is checked mechanically, not by reading: scripts/check-system-template-parity.ts runs the
 * original PHP expression (scripts/system-templates-parity/<key>.php) and compares, and
 * seed-parity.test.ts replays the stored result on every `npm test`.
 */
import type { SystemTemplateVariable } from './types'

export type SystemTemplateSeed = {
  key: string
  name: string
  description: string
  audience: 'CUSTOMER' | 'INTERNAL'
  body: string
  imageUrl: string | null
  variables: SystemTemplateVariable[]
  /** Where the original text lived, file:line, for whoever migrates that send site. */
  source: string
}

const IMG = 'https://legacy.javavolcano-touroperator.com/assets/img'

function req(name: string, example: string, description: string): SystemTemplateVariable {
  return { name, required: true, example, description }
}

function opt(name: string, example: string, description: string): SystemTemplateVariable {
  return { name, required: false, example, description }
}

const customerName = req('customer_name', 'John Doe', 'Nama pelanggan (users.name).')
const bookingShort = req(
  'booking_short',
  'Ab3dE5fG7h',
  'Kolom bookings.url_short — segmen terakhir tautan https://jvto.me/b/<kode>.'
)
const bookingSlug = req(
  'booking_slug',
  'a1b2c3d4-example',
  'Kolom bookings.url — segmen terakhir tautan https://javavolcano-touroperator.com/my-booking/<slug>.'
)

const PAYMENT_METHOD_INTRO = `Dear {customer_name},

Thank you for confirming your payment method.
You have selected the following payment option for the remaining balance of your tour:
`

const PAYMENT_METHOD_OUTRO = `If you have any questions or need assistance, we are happy to help.

Warm regards,
JVTO Team
🌋 Explore Java’s Volcanoes with Us`

function paymentReceivedBody(pickupPrefix: string): string {
  return `*[JVTO] Booking Confirmed — Payment Received* ✅🎉

Hi _{customer_name}_, thank you for your payment. Your booking is now *confirmed*.

*Booking Details*
- *Booking ID:* {booking_code}
- *Tour Package:* {package_name}
- *Travel Dates:* {travel_date_start} - {travel_date_end}
${pickupPrefix} *Pickup Location:* {pickup}
- *Guests (Pax):* {total_pax}
- *Status:* Confirmed

*Payment Summary*
- *Payment Received:* IDR {payment_amount}
- *Payment Type:* {payment_type}
- *Payment Status:* {payment_status}

*Trip Dashboard* 📊
View your itinerary, pickup details, accommodation, and trip updates here:
👉 https://javavolcano-touroperator.com/my-booking/{booking_slug}

*Notes*
- Any confirmed updates will appear in the Trip Dashboard.
- If a remaining balance applies, we will share the payment link and deadline in a separate message.
- Please review the Trip Dashboard and tell us if any details need correction.

*Need help?* Reply to this chat or contact:
- WhatsApp: +62 822-4478-8833
- Email: hello@javavolcano-touroperator.com

*Security:* JVTO will never ask for your OTP/PIN. Please use only official links shared in this chat.

— JVTO Team`
}

function paymentReceivedVariables(paymentAmount: string, paymentTypes: string): SystemTemplateVariable[] {
  return [
    customerName,
    req('booking_code', 'JVTO-2026-0001', 'Kode booking (bookings.booking_code).'),
    req(
      'package_name',
      'Bromo Ijen Tour 3 Days 2 Nights',
      'Nama paket; kalau booking tanpa paket: "<durasi> Days <durasi-1> Nights Package".'
    ),
    req('travel_date_start', '12 October 2026', "Tanggal mulai, sudah diformat date('d F Y')."),
    req('travel_date_end', '14 October 2026', "Tanggal selesai, sudah diformat date('d F Y')."),
    req('pickup', 'Hotel Majapahit Surabaya 08:00', 'Lokasi jemput, diikuti spasi + jam jemput kalau pickup_time terisi.'),
    req('total_pax', '2', 'Jumlah peserta.'),
    req('payment_amount', paymentAmount, "Nominal yang diterima, sudah diformat number_format(x, 0, ',', '.')."),
    req('payment_type', paymentTypes.split(' / ')[0], `Salah satu dari: ${paymentTypes}.`),
    req('payment_status', 'Partially Paid', 'Fully Paid (sisa tagihan 0) atau Partially Paid.'),
    bookingSlug,
  ]
}

function backofficeConfirmedBody(middle: string, tail: string): string {
  return `✅ *Booking Confirmed – Java Volcano Tour Operator (JVTO)*
Thank you, {customer_name}, for completing your *booking*.

We’re pleased to confirm that your *tour booking is now secured*. 📩${middle}

If you have any questions or special requests, feel free to contact us via WhatsApp or email.${tail}

🙏 We truly appreciate your trust. We look forward to welcoming you on an unforgettable journey!

*JVTO Team*`
}

function baliTransportBody(title: string): string {
  return `${title}

🗓 Tanggal : {service_date}

🕤 Jam Pickup : {pickup_time}

👥 Tamu : {customer_name} ({total_pax} pax) 

🚗 Unit : {vehicle}

📍 Pickup : {pickup}

🏁 Drop : {drop}

✅ Tambahan : {extras}`
}

const baliTransportVariables: SystemTemplateVariable[] = [
  req('service_date', '12 October 2026', "Tanggal layanan, sudah diformat date('d F Y')."),
  req('pickup_time', '09:30', "Jam jemput date('H:i'), atau 'TO BE CONFIRMED'."),
  customerName,
  req('total_pax', '2', 'Jumlah peserta.'),
  req('vehicle', 'Avanza', 'Unit kendaraan (Avanza / Elf Short / Elf Long), dihitung pemanggil dari pax atau add-on.'),
  req('pickup', 'Kuta Beach Hotel', "Lokasi jemput, atau 'TO BE CONFIRMED'."),
  req('drop', 'Ketapang', 'Lokasi antar.'),
  req('extras', 'Porter x 1 & Ferry Ticket x 2', 'Layanan tambahan (porter, tiket ferry).'),
]

export const SYSTEM_TEMPLATE_SEEDS: SystemTemplateSeed[] = [
  {
    key: 'booking_pending_payment',
    name: 'Booking dibuat — menunggu pembayaran',
    description: 'Dikirim ke pelanggan saat checkout website membuat booking yang belum dibayar, berisi ringkasan booking dan tautan pembayaran.',
    audience: 'CUSTOMER',
    body: `*[JVTO] Booking Pending — Payment Required* ⏳

Hi _{customer_name}_, thank you for booking with *JVTO*. Your booking has been created and is currently *pending payment*.

*Booking Summary*
- *Booking ID:* {booking_id}
- *Tour Package:* {tour_package}
- *Travel Dates:* {travel_dates}
- *Guests (Pax):* {pax}
- *Status:* Pending (Awaiting Payment)

*Amount Due:* IDR {amount_due}
*Payment Type:* {payment_type}
*Payment Method:* {payment_method}

Please complete your payment using this official link:
👉 {payment_link}

*Payment deadline:* {payment_deadline}

*Notes*
- Your booking will be confirmed automatically once payment is successful.
- *Security:* JVTO will never ask for your OTP/PIN. Please pay only via the link above.

*Need help?* Reply to this chat or contact:
- WhatsApp: +62 822-4478-8833
- Email: hello@javavolcano-touroperator.com

— JVTO Team`,
    imageUrl: null,
    variables: [
      customerName,
      req('booking_id', 'JVTO-2026-0001', 'Kode booking.'),
      req('tour_package', 'Bromo Ijen Tour 3 Days 2 Nights', 'Nama paket tour.'),
      req('travel_dates', '12 October 2026 - 14 October 2026', 'Rentang tanggal perjalanan, sudah diformat.'),
      req('pax', '2', 'Jumlah peserta.'),
      req('amount_due', '1.500.000', 'Nominal yang harus dibayar, sudah diformat.'),
      req('payment_type', 'Deposit', 'Jenis pembayaran (mis. Deposit / Full Payment).'),
      req('payment_method', 'Credit/Debit Card (XENDIT)', 'Metode pembayaran yang dipilih.'),
      req('payment_link', 'https://checkout.xendit.co/web/example-invoice-0001', 'Tautan pembayaran resmi.'),
      req('payment_deadline', '05 October 2026 23:59 WIB', 'Batas waktu pembayaran, sudah diformat.'),
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/Api/Web/CheckoutController.php:345',
  },
  {
    key: 'payment_method_confirmed_cash',
    name: 'Metode pelunasan dipilih — Cash',
    description: 'Dikirim ke pelanggan saat ia memilih Cash sebagai metode pelunasan sisa tagihan (setPaymentMethod, type=cash).',
    audience: 'CUSTOMER',
    body: `${PAYMENT_METHOD_INTRO}
🔹 *Payment Method:* Cash
💰 *Remaining Balance:* IDR {remaining_balance} 
🔗 *Payment information:* https://javavolcano-touroperator.com/payment-information

${PAYMENT_METHOD_OUTRO}`,
    imageUrl: null,
    variables: [
      customerName,
      req('remaining_balance', '3.250.000', "Sisa tagihan (bookings.balance), sudah diformat number_format(x, 0, ',', '.')."),
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/frontend/CheckoutController.php:1259',
  },
  {
    key: 'payment_method_confirmed_card',
    name: 'Metode pelunasan dipilih — Kartu (Xendit)',
    description: 'Dikirim ke pelanggan saat ia memilih kartu kredit/debit (Xendit) untuk pelunasan; berisi tautan invoice Xendit yang baru dibuat (setPaymentMethod, type=cc).',
    audience: 'CUSTOMER',
    body: `${PAYMENT_METHOD_INTRO}
🔹 *Payment Method:* Credit/Debit Card (XENDIT)
💰 *Remaining Balance:* IDR {remaining_balance} 
🔗 *Payment Link:* {payment_link}

${PAYMENT_METHOD_OUTRO}`,
    imageUrl: null,
    variables: [
      customerName,
      req('remaining_balance', '3.250.000', "Sisa tagihan (bookings.balance), sudah diformat number_format(x, 0, ',', '.')."),
      req('payment_link', 'https://checkout.xendit.co/web/example-invoice-0002', 'invoice_url dari invoice Xendit pelunasan.'),
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/frontend/CheckoutController.php:1259',
  },
  {
    key: 'payment_method_confirmed_wise',
    name: 'Metode pelunasan dipilih — Wise',
    description: 'Dikirim ke pelanggan saat ia memilih Wise Transfer sebagai metode pelunasan sisa tagihan (setPaymentMethod, type=wise).',
    audience: 'CUSTOMER',
    body: `${PAYMENT_METHOD_INTRO}
🔹 *Payment Method:* Wise Transfer
💰 *Remaining Balance:* IDR {remaining_balance} 
🔗 *Payment information:* https://javavolcano-touroperator.com/payment-information

${PAYMENT_METHOD_OUTRO}`,
    imageUrl: null,
    variables: [
      customerName,
      req('remaining_balance', '3.250.000', "Sisa tagihan (bookings.balance), sudah diformat number_format(x, 0, ',', '.')."),
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/frontend/CheckoutController.php:1259',
  },
  {
    key: 'payment_received_first',
    name: 'Pembayaran pertama diterima — booking terkonfirmasi',
    description: 'Dikirim ke pelanggan (gambar + caption) saat webhook Xendit menerima pembayaran pertama (DP/penuh) dan booking menjadi booked. Teks yang sama juga diteruskan ke grup internal JVTO.',
    audience: 'CUSTOMER',
    body: paymentReceivedBody('--'),
    imageUrl: `${IMG}/message-template/booking-confirmed.jpg`,
    variables: paymentReceivedVariables('1.500.000', 'Deposit / Full Payment'),
    source: 'javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:294',
  },
  {
    key: 'payment_received_balance',
    name: 'Pelunasan diterima',
    description: 'Dikirim ke pelanggan (gambar + caption) saat webhook Xendit menerima pembayaran "#Outstanding Payment" (pelunasan sisa tagihan).',
    audience: 'CUSTOMER',
    body: paymentReceivedBody('-'),
    imageUrl: `${IMG}/message-template/payment-confirmed.jpg`,
    variables: paymentReceivedVariables('3.250.000', 'Balance Payment / Full Payment'),
    source: 'javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:450',
  },
  {
    key: 'booking_confirmed_backoffice_jvto',
    name: 'Booking dibuat dari backoffice — JVTO',
    description: 'Dikirim ke pelanggan (gambar + caption) saat admin membuat booking non-Klook di new-backoffice dengan opsi kirim WA aktif.',
    audience: 'CUSTOMER',
    body: backofficeConfirmedBody(
      `
Your *payment receipt, remaining balance, payment method*, and *tour itinerary* have all been sent to your registered email address.

Please kindly check your inbox (and spam folder just in case), or you can access it directly via the link below

🔗 https://javavolcano-touroperator.com/my-booking/{booking_slug}`,
      ''
    ),
    imageUrl: `${IMG}/banner.jpeg`,
    variables: [customerName, bookingSlug],
    source: 'new-backoffice/app/Http/Controllers/BookingController.php:681',
  },
  {
    key: 'booking_confirmed_backoffice_klook',
    name: 'Booking dibuat dari backoffice — Klook',
    description: 'Dikirim ke pelanggan (gambar + caption) saat admin membuat booking Klook (booking_category_id = 3) di new-backoffice dengan opsi kirim WA aktif.',
    audience: 'CUSTOMER',
    body: backofficeConfirmedBody(
      '',
      `

For detailed trip information, you can check directly at the following link: https://javavolcano-touroperator.com/my-booking/{booking_slug}`
    ),
    imageUrl: `${IMG}/banner.jpeg`,
    variables: [customerName, bookingSlug],
    source: 'new-backoffice/app/Http/Controllers/BookingController.php:681',
  },
  {
    key: 'booking_confirmed_klook_email',
    name: 'Booking Klook dari email terkonfirmasi',
    description: 'Dikirim ke pelanggan (gambar + caption) saat booking Klook dibuat otomatis dari email Klook yang diekstrak.',
    audience: 'CUSTOMER',
    body: `*Booking Confirmed!* ✅🎉

Dear {customer_name},

We're thrilled to confirm your booking! 🎉 Below are the details of your upcoming trip:

*Your Booking Details*

- *Tour Package*: {package_name}
- *Number of Pax*: {total_pax} Pax

*Access Your Personalized Trip Dashboard* 📊
https://javavolcano-touroperator.com/my-booking/{booking_slug}

*What's Next?*
- Your booking is confirmed, you can check your trip detail through Trip Dasbboard.

*Need Help?*
Contact us:
- WhatsApp: +62 822-4478-8833
- Email: hello@javavolcano-touroperator.com

Let's Get Ready to Explore! 🎉
We're looking forward to helping you create unforgettable memories!

Best regards,
JVTO Team 🚐`,
    imageUrl: `${IMG}/banner.jpeg`,
    variables: [
      customerName,
      req('package_name', 'Bromo Ijen Tour 3 Days 2 Nights', 'Nama paket.'),
      req('total_pax', '2', 'Jumlah peserta.'),
      bookingSlug,
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/KlookEmailExtractorController.php:643',
  },
  {
    key: 'payment_reminder_balance',
    name: 'Pengingat pelunasan H-7',
    description: 'Dikirim ke pelanggan pukul 15:00 tujuh hari sebelum trip bila masih ada sisa tagihan (non-Klook), berisi tautan invoice Xendit baru dan tenggat pelunasan.',
    audience: 'CUSTOMER',
    body: `*[JVTO] Payment Reminder — Balance Payment Required* ⏰

Hi _{customer_name}_, this is a reminder that your booking is confirmed and the *remaining balance* is still unpaid.

*Booking Details*
- *Booking ID:* {booking_code}
- *Tour Package:* {package_name}
- *Travel Dates:* {travel_date_start} - {travel_date_end}
- *Trip Day 1:* {travel_date_start}
- *Pickup Location:* {pickup}
- *Guests (Pax):* {total_pax}
- *Status:* Confirmed (Deposit Paid)

*Payment Summary*
- *Total Amount:* IDR {total_amount}
- *Deposit Paid:* IDR {deposit_paid}
- *Outstanding Balance:* IDR {outstanding_balance}

*Balance Payment Deadline*
- *Card:* {card_due_date} *(no later than 5 days before Day 1)*
- *Bank Transfer / Wise:* {transfer_due_date} *(no later than 3 days before Day 1)*

*Pay the Balance*
- *Card Payment:* 👉 {card_payment_link}
- *Bank Transfer / Wise instructions:* 👉 https://javavolcano-touroperator.com/my-booking/{booking_slug}

*Notes*
- Full payment is required before the trip so we can finalize all operational arrangements.
- Please pay before the deadline to avoid disruptions.

*Need help?* Reply to this chat or contact:
- WhatsApp: +62 822-4478-8833
- Email: hello@javavolcano-touroperator.com

*Security:* JVTO will never ask for your OTP/PIN. Please use only official links shared by JVTO.

— JVTO Team`,
    imageUrl: null,
    variables: [
      customerName,
      req('booking_code', 'JVTO-2026-0001', 'Kode booking.'),
      req('package_name', 'Bromo Ijen Tour 3 Days 2 Nights', 'Nama paket; tanpa paket: "<durasi> Days <durasi-1> Nights Package".'),
      req('travel_date_start', '12 Oct 2026', "Tanggal mulai, date('d M Y'). Dipakai dua kali (Travel Dates dan Trip Day 1)."),
      req('travel_date_end', '14 Oct 2026', "Tanggal selesai, date('d M Y')."),
      req('pickup', 'Hotel Majapahit Surabaya 08:00', 'Lokasi jemput, diikuti spasi + jam jemput kalau pickup_time terisi.'),
      req('total_pax', '2', 'Jumlah peserta.'),
      req('total_amount', '4,750,000', 'grand_total + book_add_on_total, number_format(x) — pemisah ribuan KOMA, bukan titik.'),
      req('deposit_paid', '1,500,000', 'bookings.payment, number_format(x) — pemisah ribuan koma.'),
      req('outstanding_balance', '3,250,000', 'bookings.balance, number_format(x) — pemisah ribuan koma.'),
      req('card_due_date', '07 Oct 2026', "travel_date_start - 5 hari, date('d M Y')."),
      req('transfer_due_date', '09 Oct 2026', "travel_date_start - 3 hari, date('d M Y')."),
      req('card_payment_link', 'https://checkout.xendit.co/web/example-invoice-0003', 'invoice_url invoice Xendit pelunasan yang dibuat saat pengingat dikirim.'),
      bookingSlug,
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/ReminderPayment.php:90',
  },
  {
    key: 'trip_information',
    name: 'Informasi trip (jadwal jemput)',
    description: 'Dikirim ke pelanggan (gambar + caption) pada jadwal wa_schedule_trip_information sebelum trip, berisi jam dan lokasi jemput.',
    audience: 'CUSTOMER',
    body: `🌄 *Let's Explore!*

Dear {customer_name},

*Get ready for an adventure!*

*Logistical Details* 📍
- Pickup Time: {pickup_time}
- Pickup Location: {pickup}

*Important Reminders* ⚡
- Arrive 10 minutes prior to pickup time
- Bring necessary documents and gear

*Your Adventure Awaits!* 💥
Access your trip details and documents:

*Unified Portal*: https://javavolcano-touroperator.com/my-booking/{booking_slug}

*Need Help?*
Contact us:
- WhatsApp: +62 822-4478-8833
- Email: hello@javavolcano-touroperator.com

Best regards,
JVTO Team`,
    imageUrl: `${IMG}/message-template/trip-reminder.jpg`,
    variables: [
      customerName,
      req('pickup_time', '08:00', 'bookings.pickup_time apa adanya (tidak diformat ulang).'),
      req('pickup', 'Hotel Majapahit Surabaya', 'Lokasi jemput (bookings.pickup).'),
      bookingSlug,
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripInformation.php:59',
  },
  {
    key: 'trip_information_airport',
    name: 'Informasi trip — jemput di bandara',
    description: 'Dikirim ke pelanggan pada jadwal wa_schedule_trip_information bila lokasi jemput adalah bandara. Gambar: pickup sign bernama tamu (imageUrl per kiriman).',
    audience: 'CUSTOMER',
    body: `🌄 *[TRIP INFO] Get ready for your adventure!*

Dear _{customer_name}_, here are your pickup details:

📅 *Date:* {trip_date}
⏰ *Pickup Time:* \`{pickup_time}\`
📍 *Pickup Point:* {pickup}

⚡ *Important reminders*
- Meet us in the *arrival hall*, 10 minutes after you collect your luggage
- Send us your *flight number* now, and tell us right away if it is delayed
- Keep your phone on after landing — our driver calls if the hall is crowded

🪧 *How to find us*
Our team will be waiting in the arrival hall holding a *pickup sign with your name*, exactly like the picture above.

💬 *Need help?* Reply to this chat, WhatsApp +62 822-4478-8833 or email hello@javavolcano-touroperator.com

👉 *Open your trip details and documents:*
https://jvto.me/b/{booking_short}

_Your adventure awaits! Best regards, JVTO Team_`,
    imageUrl: `${IMG}/message-template/trip-reminder.jpg`,
    variables: [
      customerName,
      req('trip_date', 'Friday, 26 September 2026', "bookings.travel_date_start, date('l, j F Y')."),
      req('pickup_time', '08:00', 'bookings.pickup_time apa adanya (tidak diformat ulang).'),
      req('pickup', 'Surabaya Airport', 'Lokasi jemput (bookings.pickup).'),
      bookingShort,
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripInformation.php:57 (varian per tipe jemput, 2026-09-23)',
  },
  {
    key: 'trip_information_station',
    name: 'Informasi trip — jemput di stasiun',
    description: 'Dikirim ke pelanggan pada jadwal wa_schedule_trip_information bila lokasi jemput adalah stasiun. Gambar: pickup sign bernama tamu (imageUrl per kiriman).',
    audience: 'CUSTOMER',
    body: `🌄 *[TRIP INFO] Get ready for your adventure!*

Dear _{customer_name}_, here are your pickup details:

📅 *Date:* {trip_date}
⏰ *Pickup Time:* \`{pickup_time}\`
📍 *Pickup Point:* {pickup}

⚡ *Important reminders*
- Meet us at the *main station exit*, 10 minutes after your train arrives
- Send us your *train name and number* now, and tell us right away if it is delayed
- Keep your phone on — our driver calls if the exit is crowded

🪧 *How to find us*
Our team will be waiting at the main station exit holding a *pickup sign with your name*, exactly like the picture above.

💬 *Need help?* Reply to this chat, WhatsApp +62 822-4478-8833 or email hello@javavolcano-touroperator.com

👉 *Open your trip details and documents:*
https://jvto.me/b/{booking_short}

_Your adventure awaits! Best regards, JVTO Team_`,
    imageUrl: `${IMG}/message-template/trip-reminder.jpg`,
    variables: [
      customerName,
      req('trip_date', 'Friday, 26 September 2026', "bookings.travel_date_start, date('l, j F Y')."),
      req('pickup_time', '08:00', 'bookings.pickup_time apa adanya (tidak diformat ulang).'),
      req('pickup', 'Surabaya Gubeng Station', 'Lokasi jemput (bookings.pickup).'),
      bookingShort,
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripInformation.php:57 (varian per tipe jemput, 2026-09-23)',
  },
  {
    key: 'trip_information_hotel',
    name: 'Informasi trip — jemput di hotel',
    description: 'Dikirim ke pelanggan pada jadwal wa_schedule_trip_information bila lokasi jemput adalah hotel. Gambar: pickup sign bernama tamu (imageUrl per kiriman).',
    audience: 'CUSTOMER',
    body: `🌄 *[TRIP INFO] Get ready for your adventure!*

Dear _{customer_name}_, here are your pickup details:

📅 *Date:* {trip_date}
⏰ *Pickup Time:* \`{pickup_time}\`
📍 *Pickup Point:* {pickup}

⚡ *Important reminders*
- Wait in the *hotel lobby* 10 minutes before pickup time
- Settle your bill and check out before pickup time if this is your last night
- Tell us if your room is booked under a different name

🪧 *How to find us*
Our team will be waiting in the hotel lobby holding a *pickup sign with your name*, exactly like the picture above.

💬 *Need help?* Reply to this chat, WhatsApp +62 822-4478-8833 or email hello@javavolcano-touroperator.com

👉 *Open your trip details and documents:*
https://jvto.me/b/{booking_short}

_Your adventure awaits! Best regards, JVTO Team_`,
    imageUrl: `${IMG}/message-template/trip-reminder.jpg`,
    variables: [
      customerName,
      req('trip_date', 'Friday, 26 September 2026', "bookings.travel_date_start, date('l, j F Y')."),
      req('pickup_time', '08:00', 'bookings.pickup_time apa adanya (tidak diformat ulang).'),
      req('pickup', 'Hotel Majapahit Surabaya', 'Lokasi jemput (bookings.pickup).'),
      bookingShort,
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripInformation.php:57 (varian per tipe jemput, 2026-09-23)',
  },
  {
    key: 'trip_payment_arrangement',
    name: 'Pengaturan pembayaran trip',
    description: 'Dikirim ke pelanggan (gambar + caption) tepat setelah informasi trip, hanya bila admin mengisi wa_schedule_payment_content.',
    audience: 'CUSTOMER',
    body: `*Hello {customer_name},*

We would like to kindly request for your attention to the following payment arrangement for This Trip is : *{grand_total} IDR*

{payment_content}
And our team will be happy to assist you with the payment process.
Looking forward to meet you 😊

📞 +62 822-4478-8833
🏢 https://maps.app.goo.gl/TLgNey9iqSCM3QYh7

Best Regards,
*JAVA VOLCANO TOUR OPERATOR*`,
    imageUrl: `${IMG}/payment.png`,
    variables: [
      customerName,
      req('grand_total', '4.500.000', "bookings.grand_total, number_format(x, 0, ',', '.')."),
      req(
        'payment_content',
        'Deposit paid: 1.500.000 IDR\nRemaining balance: 3.000.000 IDR\n\nPlease settle the remaining balance in cash to our guide on Day 1.',
        'Teks bebas admin (wa_schedule_payment_content) dengan setiap "{br}" diganti baris baru.'
      ),
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripInformation.php:114',
  },
  {
    key: 'trip_concluded',
    name: 'Trip selesai — foto & ulasan',
    description: 'Dikirim ke pelanggan pada jadwal wa_schedule_trip_media setelah trip: ucapan terima kasih, tautan foto di dashboard, dan ajakan memberi ulasan.',
    audience: 'CUSTOMER',
    body: `Hello {customer_name} 🌟

*Your Journey with JVTO Concludes!* 🏜

Thank you so much for choosing *Java Volcano Tour Operator* for your adventure!
We truly hope you had a fun and unforgettable trip in Indonesia.

📸 Your Trip Memories:
All the fantastic pictures from your trip are ready for you to view and download! Access them directly on your personalized trip dashboard:
🌐 https://javavolcano-touroperator.com/my-booking/{booking_slug}

✍ Share Your Experience:
Your feedback is invaluable to us and incredibly helpful to future travelers. Please take a moment to leave a review on Google or Trustpilot (link also available on portal).

We hope to welcome you on another adventure soon!

Many thanks,
The JVTO Team`,
    imageUrl: null,
    variables: [customerName, bookingSlug],
    source: 'javavolcano-touroperator/app/Console/Commands/TripMedia.php:54',
  },
  {
    key: 'hotel_room_reservation',
    name: 'Reservasi kamar hotel',
    description: 'Dikirim ke grup WhatsApp hotel (hotels.group_wa_id) untuk setiap malam menginap saat pembayaran pertama booking website diterima.',
    audience: 'INTERNAL',
    body: `*📩 Room Reservation {hotel_name}*

🗓 Check In : {check_in_date}

🛫Check Out : {check_out_date}

👥 Guest : {guest}

🛏 Rooms : {rooms}

{meals}

Cek detail Reservasi ⬇️⬇️
https://partner.javavolcano-touroperator.com/reservation/{hotel_slug}

Terima kasih`,
    imageUrl: null,
    variables: [
      req('hotel_name', 'Hotel Example Bromo', 'Nama hotel.'),
      req('check_in_date', '13 October 2026', "Tanggal check-in, date('d F Y')."),
      req('check_out_date', '14 October 2026', "Tanggal check-out, date('d F Y')."),
      req('guest', 'John Doe (2 PAX)', 'Nama tamu diikuti " (<pax> PAX)".'),
      req('rooms', 'Deluxe Double x 1 + Standard Twin x 1', 'Daftar kamar "<nama kamar> x <qty>" dipisah " + ".'),
      opt(
        'meals',
        'Include Dinner & Lunch 2 pax',
        'Makan yang termasuk: "Include Dinner & Lunch <pax> pax" / "Include Dinner <pax> pax" / "Include Lunch <pax> pax". Kosong = tidak ada makan, barisnya hilang.'
      ),
      req('hotel_slug', 'hotel-example-bromo', 'hotels.slug untuk tautan partner portal.'),
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:252',
  },
  {
    key: 'internal_new_booking',
    name: 'Notifikasi booking baru dari website',
    description: 'Dikirim ke tim JVTO saat ada booking baru dari website (checkout, dan saat webhook Xendit menerima pembayaran pertama).',
    audience: 'INTERNAL',
    body: `*New Booking from Website*

*Name:* {customer_name}
*Package:* {package_url}
*Participants:* {total_pax} pax
*Trip Date:* {trip_date}
*Pickup:* {pickup}
*Drop:* {drop}

*Special Requirements:* {special_requirements}
*Payment Method:* {payment_method}`,
    imageUrl: null,
    variables: [
      customerName,
      req('package_url', 'https://javavolcano-touroperator.com/bromo-ijen-tour-3d2n', 'Tautan halaman paket.'),
      req('total_pax', '2', 'Jumlah peserta.'),
      req('trip_date', '12 October 2026', "Tanggal mulai trip, date('d F Y')."),
      req('pickup', 'Hotel Majapahit Surabaya 08:00', 'Lokasi jemput, diikuti spasi + jam jemput kalau pickup_time terisi.'),
      opt('drop', 'Ketapang Harbour', 'Lokasi antar. Kosong = baris Drop hilang.'),
      opt('special_requirements', 'Vegetarian meals for 1 guest', 'Permintaan khusus. Kosong = baris Special Requirements hilang.'),
      req('payment_method', 'Xendit', 'Nama metode pembayaran.'),
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:534',
  },
  {
    key: 'internal_bali_transport',
    name: 'Order transport Bali',
    description: 'Dikirim ke vendor transport Bali saat pembayaran pertama diterima untuk paket yang mulai dari Bali, atau yang punya add-on transport.',
    audience: 'INTERNAL',
    body: baliTransportBody('*Transport Service Bali*'),
    imageUrl: null,
    variables: baliTransportVariables,
    source: 'javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:499',
  },
  {
    key: 'internal_bali_transport_reminder',
    name: 'Pengingat transport Bali H-1',
    description: 'Dikirim ke vendor transport Bali pukul 15:15 sehari sebelum jemput (trip mulai dari Bali, atau add-on transport di hari terakhir).',
    audience: 'INTERNAL',
    body: baliTransportBody('*Reminder Transport Service Bali*'),
    imageUrl: null,
    variables: baliTransportVariables,
    source: 'javavolcano-touroperator/app/Console/Commands/ReminderBali.php:106',
  },
  {
    key: 'crew_trip_media',
    name: 'Tautan media trip ke grup crew',
    description: 'Dikirim ke grup WhatsApp crew (gambar + caption) pada jadwal wa_schedule_trip_media_crew, berisi tautan media trip dan daftar crew.',
    audience: 'INTERNAL',
    body: `*Trip Media {customer_name},*
\\🌐 {media_link}

🧗‍♂️ *CREW:*
{crew_list}`,
    imageUrl: `${IMG}/banner.jpeg`,
    variables: [
      customerName,
      req('media_link', 'https://drive.google.com/drive/folders/example-trip-media', 'bookings.media_link.'),
      req(
        'crew_list',
        '*1. Budi Example*\n*2. Agus Example (Ijen Guide)*',
        'Satu baris per crew: "*<no>. <nama>*", dengan " (Ijen Guide)" sebelum bintang penutup untuk guide Ijen.'
      ),
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripMediaCrew.php:57',
  },
  {
    key: 'crew_reminder_personal',
    name: 'Pengingat jadwal ke crew',
    description: 'Dikirim ke setiap crew (guide/driver) yang punya nomor, pada jadwal wa_schedule_reminder_crew sehari sebelum trip.',
    audience: 'INTERNAL',
    body: `*Hello {crew_name}*,
Please prepare for your schedule tomorrow.

*Customer Name:* {customer_name}
*Pickup Location:* {pickup}
*Pickup Time:* {pickup_time}

📱 You can check more details at:
https://crew-portal.javavolcano-touroperator.com/`,
    imageUrl: null,
    variables: [
      req('crew_name', 'Budi Example', 'Nama crew penerima.'),
      customerName,
      req('pickup', 'Hotel Majapahit Surabaya', 'Lokasi jemput (bookings.pickup).'),
      req('pickup_time', '08:00', 'bookings.pickup_time apa adanya.'),
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripReminderCrew.php:56',
  },
  {
    key: 'crew_reminder_group',
    name: 'Pengingat jadwal ke grup crew',
    description: 'Dikirim ke grup WhatsApp crew sehari sebelum trip, hanya untuk booking agent_id = 1.',
    audience: 'INTERNAL',
    body: `*Reminder for tomorrow’s schedule*.

*Customer Name:* {customer_name}
*Pickup Location:* {pickup}
*Pickup Time:* {pickup_time}
*Crews:* {crew_list}

📱 Check more details at:
https://crew-portal.javavolcano-touroperator.com/`,
    imageUrl: null,
    variables: [
      customerName,
      req('pickup', 'Hotel Majapahit Surabaya', 'Lokasi jemput (bookings.pickup).'),
      req('pickup_time', '08:00', 'bookings.pickup_time apa adanya.'),
      req('crew_list', 'Budi Example, Agus Example (Ijen Guide)', 'Nama crew dipisah ", ", dengan " (Ijen Guide)" untuk guide Ijen.'),
    ],
    source: 'javavolcano-touroperator/app/Console/Commands/TripReminderCrew.php:82',
  },
  {
    key: 'trip_daily_itinerary',
    name: 'Itinerary harian ke pelanggan',
    description:
      'Dikirim ke pelanggan setiap malam selama trip (jadwal dari new-backoffice, tabel WaItinerary) lewat /backoffice/send-wa/test di javavolcano-touroperator.',
    audience: 'CUSTOMER',
    body: `*Hello {customer_name}.*
{itinerary}`,
    imageUrl: null,
    variables: [
      req('customer_name', 'John Doe', 'Nama pelanggan (user booking).'),
      req(
        'itinerary',
        '*Day 1 - Ijen Crater*\nMidnight hike to the blue fire.',
        "Isi WaItinerary.message dengan setiap {br} diganti baris baru."
      ),
    ],
    source: 'javavolcano-touroperator/app/Http/Controllers/Backoffice/SendWaController.php:57',
  },
  {
    key: 'internal_consent_completed',
    name: 'Form consent selesai diisi',
    description: 'Dikirim ke nomor internal JVTO saat webhook Typeform menerima form consent yang sudah diisi pelanggan.',
    audience: 'INTERNAL',
    body: '{customer_name} has completed the consent form input',
    imageUrl: null,
    variables: [req('customer_name', 'John Doe', 'Isi field "Full Name" pada jawaban Typeform.')],
    source: 'javavolcano-touroperator/app/Http/Controllers/thirdParty/TypeformController.php:29',
  },
  {
    key: 'vendor_tshirt_size_update',
    name: 'Update ukuran kaos ke vendor',
    description: 'Dikirim ke vendor kaos saat rincian ukuran kaos sebuah booking berubah di new-backoffice.',
    audience: 'INTERNAL',
    body: `*🎽 Update Size T-Shirt*

Nama Customer: {customer_name}
Tanggal Trip: {trip_date}
Channel: {channel}
Size: {sizes}`,
    imageUrl: null,
    variables: [
      req('customer_name', 'John Doe', "Nama pelanggan, atau '-' kalau kosong."),
      req('trip_date', '12 Oct 2026', "travel_date_start dengan date('d M Y'), atau '-'."),
      req('channel', 'JVTO', "TWT / KLOOK / JVTO, atau '-'."),
      req('sizes', 'S x 1; M x 2; XL x 1', "Ukuran berjumlah > 0 sebagai \"<UKURAN> x <qty>\" dipisah \"; \", atau '-' kalau semuanya nol."),
    ],
    source: 'new-backoffice/app/Http/Controllers/BookingController.php:2826',
  },
]
