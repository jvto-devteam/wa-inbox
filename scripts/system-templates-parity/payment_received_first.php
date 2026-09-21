<?php
// Parity: payment_received_first — javavolcano-touroperator XenditController::invoiceSuccess, first
// payment (booking not yet 'booked'). Copies the lines that build $packageName/$paymentType/
// $paymentStatus/$pickup and the message itself.

function makeBook(float $payment, float $balance, bool $withPackage, string $pickupTime)
{
    $book = new stdClass();
    $book->user = (object) ['name' => 'John Doe'];
    $book->booking_code = 'JVTO-2026-0001';
    $book->package_duration = 3;
    $book->bookingDetail = [(object) ['package' => $withPackage ? (object) ['name' => 'Bromo Ijen Tour 3 Days 2 Nights'] : null]];
    $book->travel_date_start = '2026-10-12';
    $book->travel_date_end = '2026-10-14';
    $book->pickup = 'Hotel Majapahit Surabaya';
    $book->pickup_time = $pickupTime;
    $book->total_pax = 2;
    $book->payment = $payment;
    $book->balance = $balance;
    $book->url = 'a1b2c3d4-example';
    $book->is_next = '1';
    return $book;
}

function build($book): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:285-294 ---
                    $night = $book->package_duration > 1 ? $book->package_duration - 1 : $book->package_duration;

                    $packageName = $book->bookingDetail[0]->package ? $book->bookingDetail[0]->package->name : $book->package_duration . " Days " . $night . " Nights Package";
                    $urlCustomer = $book->is_next == '1' ? 'my-booking/' . $book->url : '/bookings/details/' . $book->url;

                    $paymentType = $book->balance == 0 ? 'Full Payment' : 'Deposit';
                    $paymentStatus = $book->balance == 0 ? 'Fully Paid' : 'Partially Paid';
                    $pickup = $book->pickup_time != "" ? $book->pickup . " " . $book->pickup_time : $book->pickup;

                    $dataSending["message"] = "*[JVTO] Booking Confirmed — Payment Received* ✅🎉\r\n\r\nHi _" . $book->user->name . "_, thank you for your payment. Your booking is now *confirmed*.\r\n\r\n*Booking Details*\r\n- *Booking ID:* " . $book->booking_code . "\r\n- *Tour Package:* " . $packageName . "\r\n- *Travel Dates:* " . date('d F Y', strtotime($book->travel_date_start)) . " - " . date('d F Y', strtotime($book->travel_date_end)) . "\r\n-- *Pickup Location:* " . $pickup . "\r\n- *Guests (Pax):* " . $book->total_pax . "\r\n- *Status:* Confirmed\r\n\r\n*Payment Summary*\r\n- *Payment Received:* IDR " . number_format($book->payment, 0, ',', '.') . "\r\n- *Payment Type:* " . $paymentType . "\r\n- *Payment Status:* " . $paymentStatus . "\r\n\r\n*Trip Dashboard* 📊\r\nView your itinerary, pickup details, accommodation, and trip updates here:\r\n👉 https://javavolcano-touroperator.com/my-booking/" . $book->url . "\r\n\r\n*Notes*\r\n- Any confirmed updates will appear in the Trip Dashboard.\r\n- If a remaining balance applies, we will share the payment link and deadline in a separate message.\r\n- Please review the Trip Dashboard and tell us if any details need correction.\r\n\r\n*Need help?* Reply to this chat or contact:\r\n- WhatsApp: +62 822-4478-8833\r\n- Email: hello@javavolcano-touroperator.com\r\n\r\n*Security:* JVTO will never ask for your OTP/PIN. Please use only official links shared in this chat.\r\n\r\n— JVTO Team";
// --- end verbatim ---
    return $dataSending["message"];
}

$base = [
    'customer_name' => 'John Doe',
    'booking_code' => 'JVTO-2026-0001',
    'package_name' => 'Bromo Ijen Tour 3 Days 2 Nights',
    'travel_date_start' => '12 October 2026',
    'travel_date_end' => '14 October 2026',
    'pickup' => 'Hotel Majapahit Surabaya 08:00',
    'total_pax' => '2',
    'booking_slug' => 'a1b2c3d4-example',
];

echo json_encode([
    [
        'variables' => $base + ['payment_amount' => '1.500.000', 'payment_type' => 'Deposit', 'payment_status' => 'Partially Paid'],
        'text' => build(makeBook(1500000, 3250000, true, '08:00')),
    ],
    [
        'variables' => array_merge($base, ['package_name' => '3 Days 2 Nights Package', 'pickup' => 'Hotel Majapahit Surabaya', 'payment_amount' => '4.750.000', 'payment_type' => 'Full Payment', 'payment_status' => 'Fully Paid']),
        'text' => build(makeBook(4750000, 0, false, '')),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
