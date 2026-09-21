<?php
// Parity: payment_method_confirmed_card — javavolcano-touroperator frontend CheckoutController::setPaymentMethod,
// branch request->type == 'cc'. Only the lines that feed the message are copied; the Xendit
// invoice call and the $booking->save() calls around them are not needed for the text.

function build($booking): string
{
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/frontend/CheckoutController.php:1127-1130 ---
            $isBird = false;
            $payment_method = "";
            $paymentMethod = "";
            $payment_link = "*Payment information:* https://javavolcano-touroperator.com/payment-information";
// --- end verbatim ---
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/frontend/CheckoutController.php:1140-1141 ---
                $payment_method = "Credit Card";
                $paymentMethod = "Credit/Debit Card (XENDIT)";
// --- end verbatim ---
    $result = ['invoice_url' => 'https://checkout.xendit.co/web/example-invoice-0002']; // replaced: $apiInstance->createInvoice($create_invoice_request)
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/frontend/CheckoutController.php:1218-1218 ---
                $payment_link = "*Payment Link:* " . $result['invoice_url'];
// --- end verbatim ---
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/frontend/CheckoutController.php:1259-1259 ---
                $dataSending["message"] = "Dear " . $booking->user->name . ",\r\n\r\nThank you for confirming your payment method.\r\nYou have selected the following payment option for the remaining balance of your tour:\r\n\r\n🔹 *Payment Method:* " . $paymentMethod . "\r\n💰 *Remaining Balance:* IDR " . number_format($booking->balance, 0, ',', '.') . " \r\n🔗 " . $payment_link . "\r\n\r\nIf you have any questions or need assistance, we are happy to help.\r\n\r\nWarm regards,\r\nJVTO Team\r\n🌋 Explore Java’s Volcanoes with Us";
// --- end verbatim ---
    return $dataSending["message"];
}

$booking = new stdClass();
$booking->user = new stdClass();
$booking->user->name = 'John Doe';
$booking->balance = 3250000;

$variables = [
    'customer_name' => 'John Doe',
    'remaining_balance' => '3.250.000',
];
$variables['payment_link'] = 'https://checkout.xendit.co/web/example-invoice-0002';

echo json_encode([
    ['variables' => $variables, 'text' => build($booking)],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
