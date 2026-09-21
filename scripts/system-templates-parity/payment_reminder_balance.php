<?php
// Parity: payment_reminder_balance — javavolcano-touroperator ReminderPayment command (H-7, 15:00).
// Copies $packageName, the due dates, $pickup and the message. The Xendit invoice creation is
// replaced by its result.

function build($value): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Console/Commands/ReminderPayment.php:59-61 ---
          $night = $value->package_duration > 1 ? $value->package_duration - 1 : $value->package_duration;

          $packageName = $value->bookingDetail[0]->package ? $value->bookingDetail[0]->package->name : $value->package_duration . " Days " . $night . " Nights Package";
// --- end verbatim ---
          $invoice_url = 'https://checkout.xendit.co/web/example-invoice-0003'; // replaced: $this->createXenditInvoice($xendit)
// --- verbatim: javavolcano-touroperator/app/Console/Commands/ReminderPayment.php:86-90 ---
          $card_due_date = date('d M Y', strtotime($value->travel_date_start . ' - 5 days'));
          $transfer_due_date = date('d M Y', strtotime($value->travel_date_start . ' - 3 days'));
          $pickup = $value->pickup_time != "" ? $value->pickup . " " . $value->pickup_time : $value->pickup;

          $dataSending["message"] = "*[JVTO] Payment Reminder — Balance Payment Required* ⏰\r\n\r\nHi _" . $value->user->name . "_, this is a reminder that your booking is confirmed and the *remaining balance* is still unpaid.\r\n\r\n*Booking Details*\r\n- *Booking ID:* " . $value->booking_code . "\r\n- *Tour Package:* " . $packageName . "\r\n- *Travel Dates:* " . date('d M Y', strtotime($value->travel_date_start)) . " - " . date('d M Y', strtotime($value->travel_date_end)) . "\r\n- *Trip Day 1:* " . date('d M Y', strtotime($value->travel_date_start)) . "\r\n- *Pickup Location:* " . $pickup . "\r\n- *Guests (Pax):* " . $value->total_pax . "\r\n- *Status:* Confirmed (Deposit Paid)\r\n\r\n*Payment Summary*\r\n- *Total Amount:* IDR " . number_format($value->grand_total + $value->book_add_on_total) . "\r\n- *Deposit Paid:* IDR " . number_format($value->payment) . "\r\n- *Outstanding Balance:* IDR " . number_format($value->balance) . "\r\n\r\n*Balance Payment Deadline*\r\n- *Card:* " . $card_due_date . " *(no later than 5 days before Day 1)*\r\n- *Bank Transfer / Wise:* " . $transfer_due_date . " *(no later than 3 days before Day 1)*\r\n\r\n*Pay the Balance*\r\n- *Card Payment:* 👉 " . $invoice_url . "\r\n- *Bank Transfer / Wise instructions:* 👉 https://javavolcano-touroperator.com/my-booking/" . $value->url . "\r\n\r\n*Notes*\r\n- Full payment is required before the trip so we can finalize all operational arrangements.\r\n- Please pay before the deadline to avoid disruptions.\r\n\r\n*Need help?* Reply to this chat or contact:\r\n- WhatsApp: +62 822-4478-8833\r\n- Email: hello@javavolcano-touroperator.com\r\n\r\n*Security:* JVTO will never ask for your OTP/PIN. Please use only official links shared by JVTO.\r\n\r\n— JVTO Team";
// --- end verbatim ---
    return $dataSending["message"];
}

$value = new stdClass();
$value->user = (object) ['name' => 'John Doe'];
$value->booking_code = 'JVTO-2026-0001';
$value->package_duration = 3;
$value->bookingDetail = [(object) ['package' => (object) ['name' => 'Bromo Ijen Tour 3 Days 2 Nights']]];
$value->travel_date_start = '2026-10-12';
$value->travel_date_end = '2026-10-14';
$value->pickup = 'Hotel Majapahit Surabaya';
$value->pickup_time = '08:00';
$value->total_pax = 2;
$value->grand_total = 4500000;
$value->book_add_on_total = 250000;
$value->payment = 1500000;
$value->balance = 3250000;
$value->url = 'a1b2c3d4-example';

echo json_encode([
    [
        'variables' => [
            'customer_name' => 'John Doe',
            'booking_code' => 'JVTO-2026-0001',
            'package_name' => 'Bromo Ijen Tour 3 Days 2 Nights',
            'travel_date_start' => '12 Oct 2026',
            'travel_date_end' => '14 Oct 2026',
            'pickup' => 'Hotel Majapahit Surabaya 08:00',
            'total_pax' => '2',
            'total_amount' => '4,750,000',
            'deposit_paid' => '1,500,000',
            'outstanding_balance' => '3,250,000',
            'card_due_date' => '07 Oct 2026',
            'transfer_due_date' => '09 Oct 2026',
            'card_payment_link' => 'https://checkout.xendit.co/web/example-invoice-0003',
            'booking_slug' => 'a1b2c3d4-example',
        ],
        'text' => build($value),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
