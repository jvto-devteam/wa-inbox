<?php
// Parity: booking_confirmed_backoffice_klook — new-backoffice BookingController::store, the
// is_send_wa message, with booking_category_id = 3 (3 = Klook; anything else takes the JVTO paragraph).

function build($booking, $user): string
{
    $dataSending = array();
// --- verbatim: new-backoffice/app/Http/Controllers/BookingController.php:678-681 ---
            $isJvto = $booking->booking_category_id != 3 ? "\r\nYour *payment receipt, remaining balance, payment method*, and *tour itinerary* have all been sent to your registered email address.\r\n\r\nPlease kindly check your inbox (and spam folder just in case), or you can access it directly via the link below\r\n\r\n🔗 https://javavolcano-touroperator.com/my-booking/".$booking->url : '';
            $isKlook = $booking->booking_category_id == 3 ? "\r\n\r\nFor detailed trip information, you can check directly at the following link: https://javavolcano-touroperator.com/my-booking/".$booking->url : '';
                
            $dataSending["message"] = "✅ *Booking Confirmed – Java Volcano Tour Operator (JVTO)*\r\nThank you, ".$user->name.", for completing your *booking*.\r\n\r\nWe’re pleased to confirm that your *tour booking is now secured*. 📩".$isJvto."\r\n\r\nIf you have any questions or special requests, feel free to contact us via WhatsApp or email.".$isKlook."\r\n\r\n🙏 We truly appreciate your trust. We look forward to welcoming you on an unforgettable journey!\r\n\r\n*JVTO Team*";
// --- end verbatim ---
    return $dataSending["message"];
}

$booking = (object) ['booking_category_id' => 3, 'url' => 'a1b2c3d4-example'];
$user = (object) ['name' => 'John Doe'];

echo json_encode([
    ['variables' => ['customer_name' => 'John Doe', 'booking_slug' => 'a1b2c3d4-example'], 'text' => build($booking, $user)],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
