<?php
// Parity: booking_pending_payment — javavolcano-touroperator CheckoutController::sendWaCheckout (Api/Web).
// Sets the original $data array, runs the original message line verbatim, prints the cases.

function build(array $data): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/Api/Web/CheckoutController.php:345-345 ---
            $dataSending["message"] = "*[JVTO] Booking Pending — Payment Required* ⏳\r\n\r\nHi _$data[customer_name]_, thank you for booking with *JVTO*. Your booking has been created and is currently *pending payment*.\r\n\r\n*Booking Summary*\r\n- *Booking ID:* $data[booking_id]\r\n- *Tour Package:* $data[tour_package]\r\n- *Travel Dates:* $data[travel_dates]\r\n- *Guests (Pax):* $data[pax]\r\n- *Status:* Pending (Awaiting Payment)\r\n\r\n*Amount Due:* IDR $data[amount_due]\r\n*Payment Type:* $data[payment_type]\r\n*Payment Method:* $data[payment_method]\r\n\r\nPlease complete your payment using this official link:\r\n👉 $data[payment_link]\r\n\r\n*Payment deadline:* $data[payment_deadline]\r\n\r\n*Notes*\r\n- Your booking will be confirmed automatically once payment is successful.\r\n- *Security:* JVTO will never ask for your OTP/PIN. Please pay only via the link above.\r\n\r\n*Need help?* Reply to this chat or contact:\r\n- WhatsApp: +62 822-4478-8833\r\n- Email: hello@javavolcano-touroperator.com\r\n\r\n— JVTO Team";            
// --- end verbatim ---
    return $dataSending["message"];
}

$variables = [
    'customer_name' => 'John Doe',
    'booking_id' => 'JVTO-2026-0001',
    'tour_package' => 'Bromo Ijen Tour 3 Days 2 Nights',
    'travel_dates' => '12 October 2026 - 14 October 2026',
    'pax' => '2',
    'amount_due' => '1.500.000',
    'payment_type' => 'Deposit',
    'payment_method' => 'Credit/Debit Card (XENDIT)',
    'payment_link' => 'https://checkout.xendit.co/web/example-invoice-0001',
    'payment_deadline' => '05 October 2026 23:59 WIB',
];
$data = $variables;
$data['phone_no'] = '6282143403501';

echo json_encode([
    ['variables' => $variables, 'text' => build($data)],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
